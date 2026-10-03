import { ApplicationRef, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenuItem, ContextMenuService } from '../services/context-menu.service';
import { SfContextMenuComponent } from './sf-context-menu.component';

const rename = vi.fn();
const archive = vi.fn();

@Component({
  standalone: true,
  imports: [SfContextMenuComponent],
  template: `
    <button type="button" (contextmenu)="openMenu($event)">Home page</button>
    <button type="button">Elsewhere</button>
    <sf-context-menu />
  `,
})
class HostComponent {
  private readonly menu = inject(ContextMenuService);

  openMenu(event: MouseEvent): void {
    const items: ContextMenuItem[] = [
      { label: 'Rename', shortcut: 'F2', action: rename },
      { label: 'Move to', children: [{ label: 'Archive', action: archive }] },
      { label: '', separator: true },
      { label: 'Delete', danger: true, disabledReason: 'The page is published' },
    ];
    this.menu.open(event, items);
  }
}

async function setup() {
  rename.mockClear();
  archive.mockClear();
  const result = await render(HostComponent);
  const node = screen.getByRole('button', { name: 'Home page' });
  // jsdom has no layout: the node sits at (40, 200), 160×30.
  node.getBoundingClientRect = () =>
    ({ left: 40, top: 200, right: 200, bottom: 230, width: 160, height: 30, x: 40, y: 200 }) as DOMRect;
  node.focus();
  return { ...result, node };
}

async function findMenu() {
  const menu = await screen.findByRole('menu', { name: 'Actions' });
  await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Rename' })));
  return menu;
}

describe('SfContextMenuComponent', () => {
  it('opens at the pointer on a right click, focus on the first item', async () => {
    const { node } = await setup();

    fireEvent.contextMenu(node, { clientX: 120, clientY: 80 });
    const menu = await findMenu();

    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.top).toBe('80px');
    expect(menu.style.left).toBe('120px');
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
  });

  it('opens below the focused element on a keyboard contextmenu (Shift+F10, the ContextMenu key)', async () => {
    const { node } = await setup();

    // Fired by the browser on the focused element, at the viewport origin (no pointer).
    fireEvent.contextMenu(node);
    const menu = await findMenu();

    expect(menu.style.top).toBe(`${230 + 4}px`);
    expect(menu.style.left).toBe('40px');
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const { node, fixture } = await setup();
    fireEvent.contextMenu(node);
    const menu = await findMenu();

    fireEvent.keyDown(menu, { key: 'Escape' });
    await fixture.whenStable();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(node);
  });

  it('runs the chosen action after closing, focus back on the opener', async () => {
    const { node, fixture } = await setup();
    fireEvent.contextMenu(node, { clientX: 120, clientY: 80 });
    await findMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await fixture.whenStable();

    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(node);
  });

  it('runs a submenu action chosen from the keyboard', async () => {
    const { node, fixture } = await setup();
    fireEvent.contextMenu(node);
    const menu = await findMenu();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    const submenu = screen.getByRole('menu', { name: 'Move to' });
    expect(document.activeElement).toBe(within(submenu).getByRole('menuitem', { name: 'Archive' }));
    fireEvent.click(document.activeElement!);
    await fixture.whenStable();

    expect(archive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps a disabled item reachable with its reason, and does not run it', async () => {
    const { node } = await setup();
    fireEvent.contextMenu(node);
    const menu = await findMenu();

    fireEvent.keyDown(menu, { key: 'End' });
    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    expect(document.activeElement).toBe(remove);
    expect(remove).toHaveAccessibleDescription('Unavailable: The page is published');
    fireEvent.click(remove);
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument();
  });

  it('closes on a click outside, on Tab and when the window loses focus', async () => {
    const { node, fixture } = await setup();

    fireEvent.contextMenu(node, { clientX: 120, clientY: 80 });
    await findMenu();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    await fixture.whenStable();
    expect(screen.queryByRole('menu')).toBeNull();

    node.focus(); // jsdom doesn't move focus on pointerdown
    fireEvent.contextMenu(node);
    const menu = await findMenu();
    fireEvent.keyDown(menu, { key: 'Tab' });
    await fixture.whenStable();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(node);

    fireEvent.contextMenu(node);
    await findMenu();
    fireEvent.blur(window);
    await fixture.whenStable();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens below an element passed directly (a keyboard shortcut handler)', async () => {
    const { node, fixture } = await setup();

    TestBed.inject(ContextMenuService).open(node, [{ label: 'Rename' }]);
    fixture.detectChanges();
    const menu = await findMenu();

    expect(menu.style.top).toBe('234px');
  });

  it('replaces an open menu by the next one without a DOM error (a second right click while the first menu is open)', async () => {
    const { node } = await setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    fireEvent.contextMenu(node, { clientX: 120, clientY: 80 });
    await findMenu();
    // The page closes the open menu on pointerdown and the next contextmenu opens a new one in the same tick.
    // Plain dispatch: no change detection between the two events, as in the browser.
    node.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    TestBed.inject(ApplicationRef).tick();

    await waitFor(() => expect(screen.getAllByRole('menu', { name: 'Actions' })).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Actions' }).style.left).toBe('300px'));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
