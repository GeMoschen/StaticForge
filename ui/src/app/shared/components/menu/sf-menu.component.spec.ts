import { provideRouter } from '@angular/router';
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfMenuComponent, SfMenuItem } from './sf-menu.component';

const items: SfMenuItem[] = [
  { id: 'rename', label: 'Rename', icon: 'edit' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'move', label: 'Move', disabled: true },
  { id: 'delete', label: 'Delete', icon: 'delete', danger: true, separatorBefore: true },
];

async function setup() {
  const itemSelected = vi.fn();
  const result = await render(SfMenuComponent, {
    inputs: { items, label: 'Page actions' },
    on: { itemSelected },
  });
  const trigger = screen.getByRole('button', { name: 'Page actions' });
  return { ...result, trigger, itemSelected };
}

async function openWith(trigger: HTMLElement, key?: string) {
  if (key) {
    fireEvent.keyDown(trigger, { key });
  } else {
    fireEvent.click(trigger);
  }
  const menu = await screen.findByRole('menu', { name: 'Page actions' });
  // The first item is focused after the menu's render.
  await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
  return menu;
}

describe('SfMenuComponent', () => {
  it('is an icon-only menu button with aria-haspopup and aria-expanded', async () => {
    const { trigger } = await setup();

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on click with focus on the first item and links the trigger to the menu', async () => {
    const { trigger } = await setup();

    const menu = await openWith(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('opens on ArrowUp with focus on the last item', async () => {
    const { trigger } = await setup();

    await openWith(trigger, 'ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
  });

  it('moves with the arrow keys (wrapping), Home and End, and reaches disabled items', async () => {
    const { trigger } = await setup();
    const menu = await openWith(trigger, 'ArrowDown');
    const focused = () => document.activeElement?.textContent?.trim();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(focused()).toBe('Duplicate');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(focused()).toBe('Move');
    expect(document.activeElement).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(focused()).toBe('deleteDelete');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(focused()).toBe('editRename');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(focused()).toBe('deleteDelete');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(focused()).toBe('editRename');
  });

  it('jumps by type-ahead', async () => {
    const { trigger } = await setup();
    const menu = await openWith(trigger);

    fireEvent.keyDown(menu, { key: 'd' });
    expect(document.activeElement?.textContent).toContain('Duplicate');
    fireEvent.keyDown(menu, { key: 'd' });
    expect(document.activeElement?.textContent).toContain('Delete');
  });

  it('emits the chosen item, closes and returns focus to the trigger', async () => {
    const { trigger, itemSelected, fixture } = await setup();
    await openWith(trigger);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await fixture.whenStable();

    expect(itemSelected).toHaveBeenCalledWith(items[1]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not choose a disabled item', async () => {
    const { trigger, itemSelected } = await setup();
    await openWith(trigger);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move' }));
    expect(itemSelected).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape with focus back on the trigger', async () => {
    const { trigger, fixture } = await setup();
    const menu = await openWith(trigger);

    fireEvent.keyDown(menu, { key: 'Escape' });
    await fixture.whenStable();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click outside', async () => {
    const { trigger, fixture } = await setup();
    await openWith(trigger);

    fireEvent.pointerDown(document.body);
    await fixture.whenStable();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('activates a link item with Space', async () => {
    const itemSelected = vi.fn();
    await render(SfMenuComponent, {
      inputs: { items: [{ id: 'members', label: 'Members', link: '/members' }], label: 'More tabs' },
      on: { itemSelected },
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    fireEvent.click(screen.getByRole('button', { name: 'More tabs' }));
    const item = await screen.findByRole('menuitem', { name: 'Members' });
    await waitFor(() => expect(document.activeElement).toBe(item));

    const space = createEvent.keyDown(item, { key: ' ' });
    fireEvent(item, space);
    expect(space.defaultPrevented).toBe(true);
    expect(itemSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'members' }));
  });

  it('shows a labelled trigger with text', async () => {
    await render(SfMenuComponent, { inputs: { items, label: 'Actions', text: 'Actions' } });

    expect(screen.getByRole('button', { name: 'Actions' }).textContent).toContain('Actions');
  });
});
