import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SF_IS_MAC } from '../display/sf-kbd.component';
import { SfMenuComponent } from './sf-menu.component';
import { SfMenuItem, toAriaKeyShortcuts } from './sf-menu-item';

const archive = vi.fn();
const items: SfMenuItem[] = [
  { id: 'cut', label: 'Cut', shortcut: 'Mod+X', group: 'Edit' },
  { id: 'copy', label: 'Copy', shortcut: 'Mod+C', group: 'Edit' },
  { id: 'paste', label: 'Paste', disabledReason: 'The clipboard is empty', group: 'Edit' },
  {
    id: 'move',
    label: 'Move to',
    group: 'Organise',
    children: [
      { id: 'archive', label: 'Archive', action: archive },
      { id: 'blog', label: 'Blog' },
    ],
  },
  { id: 'rename', label: 'Rename', shortcut: 'F2', group: 'Organise' },
  { id: 'delete', label: 'Delete', icon: 'delete', danger: true, separatorBefore: true },
];

/** Renders a menu button with the rich items and opens it; the first item has focus. */
async function openMenu() {
  archive.mockClear();
  const itemSelected = vi.fn();
  const result = await render(SfMenuComponent, {
    inputs: { items, label: 'Node actions' },
    on: { itemSelected },
    providers: [{ provide: SF_IS_MAC, useValue: false }],
  });
  const trigger = screen.getByRole('button', { name: 'Node actions' });
  fireEvent.click(trigger);
  const menu = await screen.findByRole('menu', { name: 'Node actions' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Cut' })));
  return { ...result, trigger, menu, itemSelected };
}

const focusedName = () => document.activeElement?.querySelector('.sf-menu__label')?.textContent;

describe('SfMenuPanelComponent (through sf-menu)', () => {
  it('renders groups as named role=group with a visible heading, separated from each other', async () => {
    const { menu } = await openMenu();

    const groups = within(menu).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Edit', 'Organise']);
    expect(within(groups[0]).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      expect.stringContaining('Cut'),
      expect.stringContaining('Copy'),
      expect.stringContaining('Paste'),
    ]);
    expect(groups[0].querySelector('.sf-menu__group-label')).toHaveTextContent('Edit');
    expect(groups[0].querySelector('.sf-menu__group-label')).toHaveAttribute('aria-hidden', 'true');
    // One between the two groups, one above Delete.
    expect(within(menu).getAllByRole('separator')).toHaveLength(2);
  });

  it('moves across groups with wrapping arrows, Home, End and type-ahead', async () => {
    const { menu } = await openMenu();

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(focusedName()).toBe('Delete');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(focusedName()).toBe('Cut');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(focusedName()).toBe('Delete');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(focusedName()).toBe('Cut');
    // Type-ahead covers every item of the panel, across groups (and reaches disabled ones).
    fireEvent.keyDown(menu, { key: 'p' });
    expect(focusedName()).toBe('Paste');
    fireEvent.keyDown(menu, { key: 'a' });
    expect(focusedName()).toBe('Paste');
  });

  it('shows a shortcut hint hidden from the name, exposed as aria-keyshortcuts', async () => {
    await openMenu();

    const copy = screen.getByRole('menuitem', { name: 'Copy' });
    expect(copy).toHaveAttribute('aria-keyshortcuts', 'Control+C');
    const hint = copy.querySelector('sf-kbd')!;
    expect(hint).toHaveAttribute('aria-hidden', 'true');
    expect(hint.textContent).toContain('Ctrl');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveAttribute('aria-keyshortcuts', 'F2');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('keeps a disabled item reachable, announces its reason and shows it as a tooltip', async () => {
    const { menu, itemSelected } = await openMenu();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const paste = screen.getByRole('menuitem', { name: 'Paste' });
    expect(document.activeElement).toBe(paste);
    expect(paste).toHaveAttribute('aria-disabled', 'true');
    expect(paste).toHaveAccessibleDescription('Unavailable: The clipboard is empty');

    fireEvent.click(paste);
    expect(itemSelected).not.toHaveBeenCalled();
    expect(menu).toBeInTheDocument();

    fireEvent.mouseEnter(paste);
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent('The clipboard is empty');
  });

  it('opens a submenu with → on its first item and closes it with ← back to the parent item', async () => {
    const { menu } = await openMenu();

    fireEvent.keyDown(menu, { key: 'm' });
    const parent = screen.getByRole('menuitem', { name: 'Move to' });
    expect(document.activeElement).toBe(parent);
    expect(parent).toHaveAttribute('aria-haspopup', 'menu');
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    expect(parent.querySelector('.sf-menu__chevron')).not.toBeNull();

    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    const submenu = screen.getByRole('menu', { name: 'Move to' });
    expect(document.activeElement).toBe(within(submenu).getByRole('menuitem', { name: 'Archive' }));
    expect(parent).toHaveAttribute('aria-expanded', 'true');
    expect(parent).toHaveAttribute('aria-controls', submenu.id);

    fireEvent.keyDown(submenu, { key: 'ArrowDown' });
    expect(focusedName()).toBe('Blog');
    fireEvent.keyDown(submenu, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Move to' })).toBeNull();
    expect(document.activeElement).toBe(parent);
    expect(parent).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toBeInTheDocument();
  });

  it('opens a submenu with Enter and Space; Escape closes only the submenu', async () => {
    const { menu } = await openMenu();
    fireEvent.keyDown(menu, { key: 'm' });
    const parent = screen.getByRole('menuitem', { name: 'Move to' });

    fireEvent.keyDown(menu, { key: 'Enter' });
    let submenu = screen.getByRole('menu', { name: 'Move to' });
    expect(focusedName()).toBe('Archive');
    fireEvent.keyDown(submenu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Move to' })).toBeNull();
    expect(document.activeElement).toBe(parent);
    expect(screen.getByRole('menu', { name: 'Node actions' })).toBeInTheDocument();

    fireEvent.keyDown(menu, { key: ' ' });
    submenu = screen.getByRole('menu', { name: 'Move to' });
    expect(focusedName()).toBe('Archive');
  });

  it('chooses a submenu item: emits it, runs its action and closes every level', async () => {
    const { menu, trigger, itemSelected, fixture } = await openMenu();
    fireEvent.keyDown(menu, { key: 'm' });
    fireEvent.keyDown(menu, { key: 'ArrowRight' });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await fixture.whenStable();

    expect(itemSelected).toHaveBeenCalledWith(expect.objectContaining({ id: 'archive' }));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens a submenu on hover without moving focus into it, and closes it when another item is hovered', async () => {
    await openMenu();
    const parent = screen.getByRole('menuitem', { name: 'Move to' });

    fireEvent.mouseEnter(parent);
    const submenu = screen.getByRole('menu', { name: 'Move to' });
    expect(document.activeElement).toBe(parent);
    expect(within(submenu).getAllByRole('menuitem')).toHaveLength(2);

    // Moving into the submenu keeps it open.
    fireEvent.pointerDown(within(submenu).getByRole('menuitem', { name: 'Blog' }));
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.queryByRole('menu', { name: 'Move to' })).toBeNull();
    expect(focusedName()).toBe('Rename');
  });

  it('closes every level on Tab from a submenu, focus back on the trigger', async () => {
    const { menu, trigger, fixture } = await openMenu();
    fireEvent.keyDown(menu, { key: 'm' });
    fireEvent.keyDown(menu, { key: 'ArrowRight' });

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Move to' }), { key: 'Tab' });
    await fixture.whenStable();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes every level on a click outside', async () => {
    const { menu, fixture } = await openMenu();
    fireEvent.keyDown(menu, { key: 'm' });
    fireEvent.keyDown(menu, { key: 'ArrowRight' });

    fireEvent.pointerDown(document.body);
    await fixture.whenStable();

    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('toAriaKeyShortcuts', () => {
  it('maps sf-kbd names to aria-keyshortcuts values', () => {
    expect(toAriaKeyShortcuts('Mod+Shift+k', false)).toBe('Control+Shift+K');
    expect(toAriaKeyShortcuts('Mod+Alt+ArrowUp', true)).toBe('Meta+Alt+ArrowUp');
    expect(toAriaKeyShortcuts('Del', false)).toBe('Delete');
    expect(toAriaKeyShortcuts('Mod++', false)).toBe('Control+Plus');
  });

  it('has no value for a sequence or nothing', () => {
    expect(toAriaKeyShortcuts('g p', false)).toBeNull();
    expect(toAriaKeyShortcuts(undefined, false)).toBeNull();
  });
});
