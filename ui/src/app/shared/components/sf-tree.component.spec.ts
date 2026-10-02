import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuService } from '../services/context-menu.service';
import { TreeClipboardService } from '../services/tree-clipboard.service';
import { SfVirtualScrollDirective } from '../virtual/virtual-window';
import { ConfirmService } from './dialog/confirm.service';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeDeleteRequest,
  SfTreeLoader,
  SfTreeMoveRequest,
  SfTreeNode,
} from './sf-tree.component';

const folder = (id: string, label = id, extra: Partial<SfTreeNode> = {}): SfTreeNode => ({
  id,
  label,
  hasChildren: true,
  icon: 'folder',
  ...extra,
});
const leaf = (id: string, label = id, extra: Partial<SfTreeNode> = {}): SfTreeNode => ({ id, label, ...extra });

const DATA: Record<string, SfTreeNode[]> = {
  '': [folder('beta', 'Beta'), leaf('gamma', 'Gamma'), folder('alpha', 'alpha')],
  alpha: [leaf('a1', 'Apple'), leaf('a2', 'Avocado')],
  beta: [leaf('b1', 'Banana'), folder('b2', 'Blueberries')],
  b2: [leaf('b2x', 'Bilberry')],
};

const ALL_ACTIONS: SfTreeAction[] = ['rename', 'delete', 'move', 'copy', 'create'];

interface SetupOptions {
  inputs?: Record<string, unknown>;
  expanded?: string[];
  expandedByProject?: Record<string, string[]>;
  confirm?: boolean;
  loader?: SfTreeLoader;
}

async function setup(options: SetupOptions = {}) {
  const loader = vi.fn(options.loader ?? ((parent: SfTreeNode | null) => DATA[parent?.id ?? ''] ?? []));
  const prefs = {
    loaded: signal(true),
    treeExpansion: vi.fn((projectKey: string) => options.expandedByProject?.[projectKey] ?? options.expanded ?? []),
    setTreeExpansion: vi.fn(),
  };
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  const outputs = {
    open: vi.fn(),
    rename: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    moveTo: vi.fn(),
    reorder: vi.fn(),
  };
  const result = await render(SfTreeComponent, {
    inputs: {
      label: 'Pages',
      loadChildren: loader,
      actions: ALL_ACTIONS,
      projectKey: 'p1',
      treeId: 'pages',
      ...options.inputs,
    },
    on: outputs,
    providers: [
      { provide: PreferencesService, useValue: prefs },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  return { ...result, loader, prefs, confirm, ...outputs, tree: result.fixture.componentInstance };
}

const item = (name: string | RegExp) => screen.getByRole('treeitem', { name });
/** A row by its visible name (a highlighted name is split into several elements). */
const rowNamed = (name: string) => {
  const row = Array.from(document.querySelectorAll('[role="treeitem"]')).find((r) => nameOf(r) === name);
  if (!row) {
    throw new Error(`No row named ${name}`);
  }
  return row as HTMLElement;
};
const nameOf = (row: Element) => row.querySelector('.sf-tree__name')?.textContent?.trim();
const names = () => screen.queryAllByRole('treeitem').map(nameOf);
const key = (keyName: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key: keyName, ...init });

/** Focuses a row the way a click would, without the click's selection/open side effects. */
function focus(name: string | RegExp): HTMLElement {
  const row = item(name);
  row.focus();
  fireEvent.focusIn(row);
  return row;
}

describe('SfTreeComponent', () => {
  describe('rendering and ARIA', () => {
    it('renders a flat tree of treeitems sorted by name, with level, set size, position and expansion', async () => {
      await setup();
      const tree = screen.getByRole('tree', { name: 'Pages' });
      expect(tree).toHaveAttribute('aria-multiselectable', 'true');
      expect(names()).toEqual(['alpha', 'Beta', 'Gamma']);

      const alpha = item('alpha');
      expect(alpha).toHaveAttribute('aria-level', '1');
      expect(alpha).toHaveAttribute('aria-setsize', '3');
      expect(alpha).toHaveAttribute('aria-posinset', '1');
      expect(alpha).toHaveAttribute('aria-expanded', 'false');
      expect(alpha).toHaveAttribute('aria-selected', 'false');
      expect(item('Gamma')).not.toHaveAttribute('aria-expanded');
      // Roving tabindex: one tab stop.
      expect(alpha).toHaveAttribute('tabindex', '0');
      expect(item('Gamma')).toHaveAttribute('tabindex', '-1');
    });

    it('keeps the source order with sort="none"', async () => {
      await setup({ inputs: { sort: 'none' } });
      expect(names()).toEqual(['Beta', 'Gamma', 'alpha']);
    });

    it('shows secondary text and badges only when given', async () => {
      await setup({
        loader: () => [
          leaf('p', 'Home', { secondary: 'home_uid', badges: [{ label: 'Draft', tone: 'warning' }] }),
          leaf('q', 'About', { badges: [{ label: '3', kind: 'badge' }] }),
        ],
      });
      const home = screen.getAllByRole('treeitem')[1];
      expect(within(home).getByText('home_uid')).toHaveClass('sf-tree__secondary');
      expect(within(home).getByText('Draft')).toBeInTheDocument();
      const about = screen.getAllByRole('treeitem')[0];
      expect(about.querySelector('.sf-tree__secondary')).toBeNull();
      expect(about.querySelector('sf-badge')).not.toBeNull();
    });
  });

  describe('lazy loading', () => {
    it('shows a skeleton for the root and a loading row for children, calling the loader with the parent', async () => {
      let resolveRoot!: (nodes: SfTreeNode[]) => void;
      let resolveChildren!: (nodes: SfTreeNode[]) => void;
      const { loader } = await setup({
        loader: (parent) =>
          new Promise<SfTreeNode[]>((resolve) => (parent ? (resolveChildren = resolve) : (resolveRoot = resolve))),
      });
      expect(screen.getByRole('status')).toHaveTextContent('Loading…');

      resolveRoot([folder('f', 'Folder')]);
      await screen.findByRole('treeitem', { name: 'Folder' });
      expect(screen.queryByRole('status')).toBeNull();

      focus('Folder');
      key('ArrowRight');
      await waitFor(() => expect(item('Folder')).toHaveAttribute('aria-busy', 'true'));
      expect(document.querySelector('.sf-tree__row--loading')).not.toBeNull();
      expect(loader).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'f' }));

      resolveChildren([leaf('c', 'Child')]);
      await screen.findByRole('treeitem', { name: 'Child' });
      expect(item('Child')).toHaveAttribute('aria-level', '2');
      expect(document.querySelector('.sf-tree__row--loading')).toBeNull();
    });

    it('refresh() reloads a level without losing the expansion', async () => {
      const data: Record<string, SfTreeNode[]> = { ...DATA, beta: [...DATA['beta']] };
      const { tree } = await setup({ loader: (parent) => data[parent?.id ?? ''] ?? [] });
      await tree.expand('beta');
      await waitFor(() => expect(item('Banana')).toBeInTheDocument());
      data['beta'] = [leaf('b0', 'Bean'), ...data['beta']];

      await tree.refresh('beta');
      await waitFor(() => expect(names()).toEqual(['alpha', 'Beta', 'Banana', 'Bean', 'Blueberries', 'Gamma']));
      expect(item('Beta')).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('keyboard', () => {
    it('moves with ↑/↓, Home/End, and expands/collapses with →/←', async () => {
      await setup();
      focus('alpha');

      key('ArrowDown');
      expect(document.activeElement).toBe(item('Beta'));
      key('End');
      expect(document.activeElement).toBe(item('Gamma'));
      key('Home');
      expect(document.activeElement).toBe(item('alpha'));
      key('ArrowUp');
      expect(document.activeElement).toBe(item('alpha'));

      key('ArrowRight');
      await waitFor(() => expect(item('alpha')).toHaveAttribute('aria-expanded', 'true'));
      expect(item('Apple')).toHaveAttribute('aria-level', '2');
      key('ArrowRight');
      expect(document.activeElement).toBe(item('Apple'));
      key('ArrowLeft');
      expect(document.activeElement).toBe(item('alpha'));
      key('ArrowLeft');
      await waitFor(() => expect(item('alpha')).toHaveAttribute('aria-expanded', 'false'));
      expect(screen.queryByRole('treeitem', { name: 'Apple' })).toBeNull();
    });

    it('keeps the focused row as the only tab stop', async () => {
      await setup();
      focus('alpha');
      key('ArrowDown');
      expect(item('Beta')).toHaveAttribute('tabindex', '0');
      expect(item('alpha')).toHaveAttribute('tabindex', '-1');
    });

    it('expands all siblings with *', async () => {
      await setup();
      focus('Gamma');
      key('*');
      await waitFor(() => expect(item('alpha')).toHaveAttribute('aria-expanded', 'true'));
      expect(item('Beta')).toHaveAttribute('aria-expanded', 'true');
    });

    it('type-ahead focuses the next node whose name starts with the typed text', async () => {
      await setup();
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
      focus('alpha');
      key('g');
      expect(document.activeElement).toBe(item('Gamma'));
      now.mockReturnValue(10_000); // a pause: a new search
      key('b');
      expect(document.activeElement).toBe(item('Beta'));
      now.mockRestore();
    });

    it('opens with Enter, and with a plain click', async () => {
      const { open } = await setup();
      focus('Beta');
      key('Enter');
      expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'beta' }));

      fireEvent.click(item('Gamma'));
      expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'gamma' }));
      expect(document.activeElement).toBe(item('Gamma'));
    });
  });

  describe('selection', () => {
    it('selects with Space, extends with Shift+arrows and toggles with Ctrl+Space', async () => {
      const { tree } = await setup();
      focus('alpha');

      key(' ');
      expect(item('alpha')).toHaveAttribute('aria-selected', 'true');
      key('ArrowDown', { shiftKey: true });
      key('ArrowDown', { shiftKey: true });
      expect(screen.getAllByRole('treeitem', { selected: true }).map(nameOf)).toEqual([
        'alpha',
        'Beta',
        'Gamma',
      ]);
      key('ArrowUp', { ctrlKey: true });
      key(' ', { ctrlKey: true });
      expect(item('Beta')).toHaveAttribute('aria-selected', 'false');
      expect(tree.selection()).toEqual(['alpha', 'gamma']);
    });

    it('Ctrl+click toggles, Shift+click selects a range, Ctrl+A selects all', async () => {
      const { open } = await setup();
      fireEvent.click(item('alpha'));
      fireEvent.click(item('Gamma'), { ctrlKey: true });
      expect(screen.getAllByRole('treeitem', { selected: true })).toHaveLength(2);
      expect(open).toHaveBeenCalledTimes(1);

      fireEvent.click(item('alpha'));
      fireEvent.click(item('Beta'), { shiftKey: true });
      expect(screen.getAllByRole('treeitem', { selected: true }).map(nameOf)).toEqual([
        'alpha',
        'Beta',
      ]);

      key('a', { ctrlKey: true });
      expect(screen.getAllByRole('treeitem', { selected: true })).toHaveLength(3);
    });

    it('selects one at a time when not multiselect', async () => {
      await setup({ inputs: { multiselect: false } });
      expect(screen.getByRole('tree')).not.toHaveAttribute('aria-multiselectable');
      fireEvent.click(item('alpha'));
      fireEvent.click(item('Gamma'), { ctrlKey: true });
      expect(screen.getAllByRole('treeitem', { selected: true }).map(nameOf)).toEqual(['Gamma']);
    });
  });

  describe('persisted expansion', () => {
    it('restores the saved expansion, loading the expanded branches level by level', async () => {
      const { prefs, loader } = await setup({ expanded: ['beta', 'b2'] });
      expect(prefs.treeExpansion).toHaveBeenCalledWith('p1', 'pages');
      await waitFor(() => expect(item('Bilberry')).toHaveAttribute('aria-level', '3'));
      expect(loader).toHaveBeenCalledTimes(3);
      expect(prefs.setTreeExpansion).not.toHaveBeenCalled();
    });

    it('saves the expansion when the user expands or collapses, and with expand all / collapse all', async () => {
      const { prefs } = await setup({ expanded: ['beta'] });
      focus('alpha');
      key('ArrowRight');
      expect(prefs.setTreeExpansion).toHaveBeenLastCalledWith('p1', 'pages', ['alpha', 'beta']);

      fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
      expect(prefs.setTreeExpansion).toHaveBeenLastCalledWith('p1', 'pages', []);
      expect(names()).toEqual(['alpha', 'Beta', 'Gamma']);

      fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
      await waitFor(() => expect(item('Bilberry')).toBeInTheDocument());
      expect(prefs.setTreeExpansion).toHaveBeenLastCalledWith(
        'p1',
        'pages',
        expect.arrayContaining(['alpha', 'beta', 'b2']),
      );
    });
  });

  describe('clipboard', () => {
    it('cuts with Ctrl+X and pastes into a folder with Ctrl+V as a move request', async () => {
      const { move } = await setup();
      focus('Gamma');
      key('x', { ctrlKey: true });
      expect(item('Gamma').closest('.sf-tree__row')).toHaveClass('is-cut');
      expect(TestBed.inject(TreeClipboardService).nodes()).toMatchObject({ mode: 'cut', scope: 'p1:pages' });

      key('Home');
      key('v', { ctrlKey: true });
      const request: SfTreeMoveRequest = move.mock.calls[0][0];
      expect(request).toMatchObject({ copy: false, via: 'paste', target: { id: 'alpha' } });
      expect(request.nodes.map((n) => n.id)).toEqual(['gamma']);
      expect(TestBed.inject(TreeClipboardService).nodes()).toBeNull();
    });

    it('copies with Ctrl+C; a paste onto a leaf goes next to it; a paste into its own subtree is refused', async () => {
      const { move } = await setup({ inputs: { rootDroppable: true } });
      focus('Beta');
      key('c', { ctrlKey: true });
      key('v', { ctrlKey: true }); // into itself
      expect(move).not.toHaveBeenCalled();
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Can’t move here');

      key('End');
      key('v', { ctrlKey: true }); // Gamma is a leaf at the root: paste into the root
      expect(move).toHaveBeenCalledWith(expect.objectContaining({ copy: true, target: null }));
      // A copy stays on the clipboard.
      expect(TestBed.inject(TreeClipboardService).nodes()).toMatchObject({ mode: 'copy' });
    });

    it('ignores what another tree scope put on the clipboard', async () => {
      const { move } = await setup();
      TestBed.inject(TreeClipboardService).cutNodes('media', [leaf('m', 'Image')]);
      focus('alpha');
      key('v', { ctrlKey: true });
      expect(move).not.toHaveBeenCalled();
    });
  });

  describe('drag and drop', () => {
    function dataTransfer() {
      return { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' };
    }

    it('accepts a valid target with feedback and emits a move request on drop', async () => {
      const { move } = await setup();
      const transfer = dataTransfer();
      expect(item('Gamma')).toHaveAttribute('draggable', 'true');
      fireEvent.dragStart(item('Gamma'), { dataTransfer: transfer });
      expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'Gamma');

      const allowed = fireEvent.dragOver(item('alpha'), { dataTransfer: transfer });
      expect(allowed).toBe(false); // preventDefault: the drop is allowed
      expect(transfer.dropEffect).toBe('move');
      expect(item('alpha').closest('.sf-tree__row')).toHaveClass('is-drop-target');
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Move into alpha');

      fireEvent.drop(item('alpha'), { dataTransfer: transfer });
      expect(move).toHaveBeenCalledWith(
        expect.objectContaining({ via: 'drag', copy: false, target: expect.objectContaining({ id: 'alpha' }) }),
      );
      expect(item('alpha').closest('.sf-tree__row')).not.toHaveClass('is-drop-target');
    });

    it('refuses targets canDrop rejects, leaves and their own subtree', async () => {
      const canDrop = vi.fn((_dragged: readonly SfTreeNode[], target: SfTreeNode | null) => target?.id !== 'beta');
      const { move } = await setup({ inputs: { canDrop } });
      const transfer = dataTransfer();
      fireEvent.dragStart(item('alpha'), { dataTransfer: transfer });

      expect(fireEvent.dragOver(item('Beta'), { dataTransfer: transfer })).toBe(true);
      expect(transfer.dropEffect).toBe('none');
      expect(item('Beta').closest('.sf-tree__row')).toHaveClass('is-drop-invalid');
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Can’t move here');
      expect(canDrop).toHaveBeenCalledWith([expect.objectContaining({ id: 'alpha' })], expect.objectContaining({ id: 'beta' }));

      expect(fireEvent.dragOver(item('Gamma'), { dataTransfer: transfer })).toBe(true); // a leaf
      expect(fireEvent.dragOver(item('alpha'), { dataTransfer: transfer })).toBe(true); // itself
      fireEvent.drop(item('Gamma'), { dataTransfer: transfer });
      expect(move).not.toHaveBeenCalled();
    });

    it('is not draggable without the move action', async () => {
      await setup({ inputs: { actions: [] } });
      expect(item('Gamma')).not.toHaveAttribute('draggable');
    });
  });

  describe('reorder', () => {
    const REORDER = { reorderable: true, sort: 'none' } as const; // root order: Beta, Gamma, alpha
    const transfer = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' });
    /** Fires a dragover / drop at a pointer height (jsdom has no DragEvent, so `clientY` is set by hand). */
    const at = (type: 'dragOver' | 'drop', element: HTMLElement, data: object, clientY: number) => {
      const event = createEvent[type](element, { dataTransfer: data });
      Object.defineProperty(event, 'clientY', { value: clientY });
      return fireEvent(element, event);
    };
    /** Every row 40px tall, the first at the top. */
    const layOut = () =>
      screen.getAllByRole('treeitem').forEach((row, index) => {
        row.getBoundingClientRect = () => ({ top: index * 40, height: 40, bottom: index * 40 + 40 }) as DOMRect;
      });
    const rowOf = (name: string) => item(name).closest('.sf-tree__row');

    it('drops before, inside or after a row by the pointer height (quarters), with an indicator and announcement', async () => {
      const { reorder, move, fixture } = await setup({ inputs: REORDER });
      layOut();
      const data = transfer();
      fireEvent.dragStart(item('alpha'), { dataTransfer: data });

      // Upper quarter of Beta (row 0, 0–40): before it.
      expect(at('dragOver', item('Beta'), data, 5)).toBe(false);
      fixture.detectChanges();
      expect(rowOf('Beta')).toHaveClass('is-drop-before');
      expect(rowOf('Beta')).not.toHaveClass('is-drop-target');
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Move before Beta');

      // The middle of a droppable row: inside, as before. Same row: not announced again.
      at('dragOver', item('Beta'), data, 20);
      fixture.detectChanges();
      expect(rowOf('Beta')).toHaveClass('is-drop-target');
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Move before Beta');

      // Lower quarter of Gamma (row 1, 40–80): after it — where alpha already is: no indicator, not allowed.
      expect(at('dragOver', item('Gamma'), data, 75)).toBe(true);
      fixture.detectChanges();
      expect(rowOf('Gamma')).toHaveClass('is-drop-invalid');

      // The middle of a leaf picks the nearer edge: the upper half of Gamma is before it.
      expect(at('dragOver', item('Gamma'), data, 55)).toBe(false);
      fixture.detectChanges();
      expect(rowOf('Gamma')).toHaveClass('is-drop-before');
      at('drop', item('Gamma'), data, 55);
      expect(reorder).toHaveBeenCalledWith(
        expect.objectContaining({ node: expect.objectContaining({ id: 'alpha' }), parent: null, index: 1, via: 'drag' }),
      );
      expect(move).not.toHaveBeenCalled();
      expect(rowOf('Gamma')).not.toHaveClass('is-drop-before');
    });

    it('announces a drag per target row, not per zone within it', async () => {
      const { fixture } = await setup({ inputs: REORDER });
      layOut();
      const live = document.querySelector('[aria-live]')!;
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((delivered) => records.push(...delivered));
      observer.observe(live, { characterData: true, characterDataOldValue: true, childList: true, subtree: true });
      const data = transfer();
      fireEvent.dragStart(item('Beta'), { dataTransfer: data });

      at('dragOver', item('alpha'), data, 85); // before
      at('dragOver', item('alpha'), data, 100); // inside
      at('dragOver', item('alpha'), data, 115); // after
      fixture.detectChanges();
      expect(rowOf('alpha')).toHaveClass('is-drop-after');
      at('dragOver', item('Gamma'), data, 75); // another row
      fixture.detectChanges();

      // Every text the region showed.
      const shown = [...[...records, ...observer.takeRecords()].map((record) => record.oldValue?.trim() ?? ''), live.textContent!.trim()];
      observer.disconnect();
      expect(shown.filter(Boolean)).toEqual(['Move before alpha', 'Move after Gamma']);
    });

    it('keeps the whole row as the drop zone when several nodes are dragged', async () => {
      const { reorder, move, fixture } = await setup({ inputs: REORDER });
      layOut();
      fireEvent.click(item('Gamma'));
      fireEvent.click(item('Beta'), { ctrlKey: true });
      const data = transfer();
      fireEvent.dragStart(item('Gamma'), { dataTransfer: data });

      // Upper quarter of alpha (row 2, 80–120): inside, not before.
      expect(at('dragOver', item('alpha'), data, 82)).toBe(false);
      fixture.detectChanges();
      expect(rowOf('alpha')).toHaveClass('is-drop-target');
      at('drop', item('alpha'), data, 82);
      expect(reorder).not.toHaveBeenCalled();
      expect(move).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ id: 'beta' }), expect.objectContaining({ id: 'gamma' })]),
          target: expect.objectContaining({ id: 'alpha' }),
        }),
      );
    });

    it('drops "after" an expanded folder as its first child, where the line is drawn', async () => {
      const { reorder, fixture } = await setup({ inputs: REORDER, expanded: ['beta'] });
      await waitFor(() => expect(names()).toEqual(['Beta', 'Banana', 'Blueberries', 'Gamma', 'alpha']));
      layOut();
      const data = transfer();
      fireEvent.dragStart(item('alpha'), { dataTransfer: data });

      expect(at('dragOver', item('Beta'), data, 35)).toBe(false); // lower quarter of Beta (row 0)
      fixture.detectChanges();
      expect(rowOf('Beta')).toHaveClass('is-drop-after');
      at('drop', item('Beta'), data, 35);
      expect(reorder).toHaveBeenCalledWith(
        expect.objectContaining({ parent: expect.objectContaining({ id: 'beta' }), index: 0, via: 'drag' }),
      );
    });

    it('drops after a row as the index after the move, and inside a folder as a move', async () => {
      const { reorder, move } = await setup({ inputs: REORDER });
      layOut();
      const data = transfer();
      fireEvent.dragStart(item('Beta'), { dataTransfer: data });
      at('drop', item('alpha'), data, 115); // lower quarter of row 2
      expect(reorder).toHaveBeenCalledWith(expect.objectContaining({ parent: null, index: 2 }));

      fireEvent.dragStart(item('Gamma'), { dataTransfer: data });
      at('drop', item('alpha'), data, 100); // middle of row 2
      expect(move).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ id: 'alpha' }) }));
    });

    it('only reorders with sort="none": a sorted tree drops inside wherever the pointer is', async () => {
      const { reorder, move, fixture } = await setup({ inputs: { reorderable: true } });
      layOut();
      const data = transfer();
      fireEvent.dragStart(item('Gamma'), { dataTransfer: data });
      at('dragOver', item('alpha'), data, 1);
      fixture.detectChanges();
      expect(rowOf('alpha')).toHaveClass('is-drop-target');
      at('drop', item('alpha'), data, 1);
      expect(move).toHaveBeenCalled();
      expect(reorder).not.toHaveBeenCalled();

      focus('Gamma');
      key('ArrowUp', { altKey: true });
      expect(reorder).not.toHaveBeenCalled();
      expect(item('Beta')).toHaveFocus(); // a plain ArrowUp
    });

    it('moves the focused node among its siblings with Alt+↑/↓ and says so at the ends', async () => {
      const { reorder } = await setup({ inputs: REORDER });
      expect(item('Gamma')).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      focus('Gamma');
      key('ArrowUp', { altKey: true });
      expect(reorder).toHaveBeenLastCalledWith(
        expect.objectContaining({ node: expect.objectContaining({ id: 'gamma' }), parent: null, index: 0, via: 'keyboard' }),
      );
      key('ArrowDown', { altKey: true });
      expect(reorder).toHaveBeenLastCalledWith(expect.objectContaining({ index: 2 }));
      expect(reorder).toHaveBeenCalledTimes(2);

      focus('Beta');
      key('ArrowUp', { altKey: true });
      expect(document.querySelector('[aria-live]')).toHaveTextContent('“Beta” is already first');
      focus('alpha');
      key('ArrowDown', { altKey: true });
      expect(document.querySelector('[aria-live]')).toHaveTextContent('“alpha” is already last');
      expect(reorder).toHaveBeenCalledTimes(2);
    });

    it('does not reorder without the move action', async () => {
      const { reorder } = await setup({ inputs: { ...REORDER, actions: [] } });
      expect(item('Gamma')).not.toHaveAttribute('aria-keyshortcuts');
      focus('Gamma');
      key('ArrowUp', { altKey: true });
      expect(reorder).not.toHaveBeenCalled();
    });

    it('announces the completed reorder and offers Undo', async () => {
      const { reorder } = await setup({ inputs: REORDER });
      const toasts = TestBed.inject(ToastService);
      const undoToast = vi.spyOn(toasts, 'undo');
      focus('Gamma');
      key('ArrowUp', { altKey: true });
      const undo = vi.fn();
      reorder.mock.calls[0][0].completed(undo);
      expect(undoToast).toHaveBeenCalledWith('Moved “Gamma” to position 1 of 3', undo);
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Moved “Gamma” to position 1 of 3');
    });
  });

  describe('inline rename and create', () => {
    it('renames with F2, showing the host validation error inline', async () => {
      const validateName = vi.fn((name: string) => (name === 'Taken' ? 'That name is taken' : null));
      const { rename } = await setup({ inputs: { validateName } });
      focus('Gamma');
      key('F2');
      const input = screen.getByRole('textbox', { name: 'Rename' });
      expect(document.activeElement).toBe(input);
      expect(input).toHaveValue('Gamma');

      fireEvent.input(input, { target: { value: '  ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
      expect(input).toHaveAccessibleDescription('A name is required');

      fireEvent.input(input, { target: { value: 'Taken' } });
      expect(input).not.toHaveAttribute('aria-invalid');
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(input).toHaveAccessibleDescription('That name is taken'));
      expect(validateName).toHaveBeenCalledWith('Taken', expect.objectContaining({ mode: 'rename', parent: null }));
      expect(rename).not.toHaveBeenCalled();

      fireEvent.input(input, { target: { value: 'Delta' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(rename).toHaveBeenCalledWith({ node: expect.objectContaining({ id: 'gamma' }), name: 'Delta' }));
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(document.activeElement).toBe(item('Gamma'));
    });

    it('cancels a rename with Escape', async () => {
      const { rename } = await setup();
      focus('Gamma');
      key('F2');
      const input = screen.getByRole('textbox', { name: 'Rename' });
      fireEvent.input(input, { target: { value: 'Other' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(rename).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(item('Gamma'));
    });

    it('does not rename without the rename action', async () => {
      await setup({ inputs: { actions: ['delete'] } });
      focus('Gamma');
      key('F2');
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('creates inline under a parent: Enter commits, Escape cancels', async () => {
      const { tree, create } = await setup();
      await tree.startCreate('alpha', 'folder');
      const input = await screen.findByRole('textbox', { name: 'New folder' });
      expect(document.activeElement).toBe(input);
      expect(input.closest('[role="treeitem"]')).toHaveAttribute('aria-level', '2');
      expect(item('alpha')).toHaveAttribute('aria-expanded', 'true');

      fireEvent.input(input, { target: { value: 'Docs' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(create).toHaveBeenCalledWith({ parent: expect.objectContaining({ id: 'alpha' }), kind: 'folder', name: 'Docs' }),
      );
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(document.activeElement).toBe(item('alpha'));

      await tree.startCreate(null, 'item');
      const second = await screen.findByRole('textbox', { name: 'New item' });
      fireEvent.keyDown(second, { key: 'Escape' });
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('confirms, emits a delete request and offers Undo once the host completed it', async () => {
      const { confirm, delete: deleted } = await setup();
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      fireEvent.click(item('alpha'));
      fireEvent.click(item('Gamma'), { ctrlKey: true });
      key('Delete');

      await waitFor(() => expect(deleted).toHaveBeenCalled());
      expect(confirm.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete 2 items?', confirmLabel: 'Delete 2 items', tone: 'danger' }),
      );
      const request: SfTreeDeleteRequest = deleted.mock.calls[0][0];
      expect(request.nodes.map((n) => n.id)).toEqual(['alpha', 'gamma']);

      const restore = vi.fn();
      request.completed(restore);
      expect(undo).toHaveBeenCalledWith('Deleted 2 items', restore);
      await waitFor(() => expect(document.querySelector('[aria-live]')).toHaveTextContent('Deleted 2 items'));
    });

    it('asks the host instead of its own confirmation when the host brings one (confirmDelete)', async () => {
      const confirmDelete = vi.fn().mockResolvedValue(true);
      const { confirm, delete: deleted } = await setup({ inputs: { confirmDelete } });
      focus('Gamma');
      key('Delete');
      await waitFor(() => expect(deleted).toHaveBeenCalled());
      expect(confirmDelete).toHaveBeenCalledWith([expect.objectContaining({ id: 'gamma' })]);
      expect(confirm.confirm).not.toHaveBeenCalled();
    });

    it('does not delete when the host declines', async () => {
      const confirmDelete = vi.fn().mockResolvedValue(false);
      const { delete: deleted } = await setup({ inputs: { confirmDelete } });
      focus('Gamma');
      key('Delete');
      await waitFor(() => expect(confirmDelete).toHaveBeenCalled());
      await Promise.resolve();
      expect(deleted).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is declined', async () => {
      const { confirm, delete: deleted } = await setup({ confirm: false });
      focus('Gamma');
      key('Delete');
      await waitFor(() => expect(confirm.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete “Gamma”?' })));
      await Promise.resolve();
      expect(deleted).not.toHaveBeenCalled();
    });
  });

  describe('menus', () => {
    it('opens the context menu below the row with Shift+F10', async () => {
      await setup({ inputs: { menuItems: () => [{ label: 'Preview', action: vi.fn() }] } });
      focus('Beta');
      key('F10', { shiftKey: true });
      const state = TestBed.inject(ContextMenuService).state();
      expect(state?.anchor).toEqual({ kind: 'element', element: item('Beta') });
      expect(state?.items.map((i) => i.label)).toEqual([
        'New folder',
        'New item',
        'Rename',
        'Cut',
        'Copy',
        'Paste',
        'Move to…',
        'Preview',
        'Delete',
      ]);
      expect(state?.items.find((i) => i.label === 'Paste')?.disabled).toBe(true);
      expect(state?.items.find((i) => i.label === 'Delete')).toMatchObject({ danger: true, separatorBefore: true });
    });

    it('opens the context menu with the ContextMenu key, and "Move to…" asks the host', async () => {
      const { moveTo } = await setup();
      focus('Gamma');
      key('ContextMenu');
      const state = TestBed.inject(ContextMenuService).state();
      state?.items.find((i) => i.label === 'Move to…')?.action?.();
      expect(moveTo).toHaveBeenCalledWith([expect.objectContaining({ id: 'gamma' })]);
    });

    it('shows a ⋮ menu button for the hovered row', async () => {
      await setup();
      expect(screen.queryByRole('button', { name: 'Actions for Gamma' })).toBeNull();
      fireEvent.mouseEnter(item('Gamma').closest('.sf-tree__row') as Element);
      const button = await screen.findByRole('button', { name: 'Actions for Gamma' });
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
      fireEvent.click(button);
      expect(await screen.findByRole('menuitem', { name: /Rename/ })).toBeInTheDocument();
    });

    it('has no menus in a read-only tree', async () => {
      await setup({ inputs: { actions: [] } });
      fireEvent.mouseEnter(item('Gamma').closest('.sf-tree__row') as Element);
      expect(screen.queryByRole('button', { name: 'Actions for Gamma' })).toBeNull();
    });
  });

  describe('filter', () => {
    it('highlights client-side matches, auto-expands to them and shows "no results"', async () => {
      const { tree, prefs } = await setup();
      await tree.expandAll();
      tree.collapseAll();
      prefs.setTreeExpansion.mockClear();

      const box = screen.getByRole('searchbox', { name: 'Filter Pages' });
      fireEvent.input(box, { target: { value: 'berr' } });
      await waitFor(() => expect(names()).toEqual(['Beta', 'Blueberries', 'Bilberry']));
      expect(item('Beta')).toHaveAttribute('aria-expanded', 'true');
      expect(rowNamed('Bilberry').querySelector('mark')).toHaveTextContent('berr');
      expect(prefs.setTreeExpansion).not.toHaveBeenCalled();

      fireEvent.input(box, { target: { value: 'zzz' } });
      expect(await screen.findByRole('heading', { name: 'No matches' })).toBeInTheDocument();

      fireEvent.input(box, { target: { value: '' } });
      await waitFor(() => expect(names()).toEqual(['alpha', 'Beta', 'Gamma']));
    });

    it('asks the server for matching paths in server mode and loads them', async () => {
      const search = vi.fn(async () => [['beta', 'b2', 'b2x']]);
      await setup({ inputs: { filterMode: 'server', search } });
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'bil' } });
      await waitFor(() => expect(names()).toEqual(['Beta', 'Blueberries', 'Bilberry']));
      expect(search).toHaveBeenCalledWith('bil');
      expect(rowNamed('Bilberry').querySelector('mark')).toHaveTextContent('Bil');
    });
  });

  describe('review fixes', () => {
    it('defaults the clipboard scope to project and tree, so another project does not paste it', async () => {
      const first = await setup();
      focus('Gamma');
      key('x', { ctrlKey: true });
      expect(TestBed.inject(TreeClipboardService).nodes()?.scope).toBe('p1:pages');
      first.fixture.componentRef.setInput('projectKey', 'p2');
      first.fixture.detectChanges();
      focus('alpha');
      key('v', { ctrlKey: true });
      expect(first.move).not.toHaveBeenCalled();
    });

    it('shows an error state with Retry when the root fails to load', async () => {
      let fail = true;
      await setup({
        loader: (parent) => (fail ? Promise.reject(new Error('down')) : (DATA[parent?.id ?? ''] ?? [])),
      });
      const retry = await screen.findByRole('button', { name: 'Retry' });
      expect(screen.getByRole('heading', { name: 'Couldn’t load this tree' })).toBeInTheDocument();
      fail = false;
      fireEvent.click(retry);
      await waitFor(() => expect(names()).toEqual(['alpha', 'Beta', 'Gamma']));
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('collapses a node whose children fail to load and offers Retry on a toast', async () => {
      let fail = true;
      await setup({
        loader: (parent) =>
          parent?.id === 'alpha' && fail ? Promise.reject(new Error('down')) : (DATA[parent?.id ?? ''] ?? []),
      });
      const toasts = TestBed.inject(ToastService);
      focus('alpha');
      key('ArrowRight');
      await waitFor(() => expect(toasts.toasts().length).toBe(1));
      const toast = toasts.toasts()[0];
      expect(toast).toMatchObject({ kind: 'error', message: 'Couldn’t load the contents of “alpha”' });
      expect(toast.action).toMatchObject({ label: 'shared.tree.retry', translate: true });
      await waitFor(() => expect(item('alpha')).toHaveAttribute('aria-expanded', 'false'));

      fail = false;
      toasts.runAction(toast.id);
      await waitFor(() => expect(item('Apple')).toBeInTheDocument());
      expect(item('alpha')).toHaveAttribute('aria-expanded', 'true');
    });

    it('restores the new key on a project change, never writing the old ids into it, and prunes collapsed ids', async () => {
      const { fixture, prefs } = await setup({ expandedByProject: { p1: [], p2: ['beta'] } });
      focus('alpha');
      key('ArrowRight');
      await waitFor(() => expect(item('Apple')).toBeInTheDocument());
      expect(prefs.setTreeExpansion).toHaveBeenLastCalledWith('p1', 'pages', ['alpha']);
      prefs.setTreeExpansion.mockClear();

      fixture.componentRef.setInput('projectKey', 'p2');
      fixture.detectChanges();
      await waitFor(() => expect(item('Beta')).toHaveAttribute('aria-expanded', 'true'));
      expect(item('alpha')).toHaveAttribute('aria-expanded', 'false');
      expect(prefs.setTreeExpansion).not.toHaveBeenCalled();

      // b2 expanded under beta, then beta collapsed: b2 is no longer reachable and is not saved.
      await fixture.componentInstance.expand('b2');
      fixture.componentInstance.collapse('beta');
      expect(prefs.setTreeExpansion).toHaveBeenLastCalledWith('p2', 'pages', []);
    });

    it('extends a Shift+Arrow range from the focused row even when nothing was clicked', async () => {
      const { tree } = await setup();
      focus('alpha');
      key('ArrowDown', { shiftKey: true });
      expect(tree.selection()).toEqual(['alpha', 'beta']);
    });

    it('clears a drag when it ends anywhere in the document, so a later external drag emits nothing', async () => {
      const { move } = await setup();
      const transfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: 'all', dropEffect: 'none' };
      fireEvent.dragStart(item('Gamma'), { dataTransfer: transfer });
      fireEvent.dragOver(item('alpha'), { dataTransfer: transfer });
      // The source row left the window: no dragend on it, only on the document.
      document.dispatchEvent(new Event('dragend'));
      await waitFor(() => expect(item('alpha').closest('.sf-tree__row')).not.toHaveClass('is-drop-target'));

      expect(fireEvent.dragOver(item('alpha'), { dataTransfer: transfer })).toBe(true);
      fireEvent.drop(item('alpha'), { dataTransfer: transfer });
      expect(move).not.toHaveBeenCalled();
    });
  });

  describe('virtual window', () => {
    /** Gives the tree's scroller a 280px viewport and 28px rows (jsdom has no layout). */
    function withLayout(): () => void {
      const height = vi
        .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
        .mockImplementation(function (this: HTMLElement) {
          return this.getAttribute('role') === 'tree' ? 280 : 0;
        });
      const style = window.getComputedStyle.bind(window);
      const computed = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const declaration = style(element, pseudo);
        if ((element as Element).getAttribute('role') !== 'tree') {
          return declaration;
        }
        return new Proxy(declaration, {
          get: (target, prop) =>
            prop === 'getPropertyValue'
              ? (name: string) => (name === '--sf-row-height' ? '28px' : target.getPropertyValue(name))
              : Reflect.get(target, prop),
        });
      });
      return () => {
        height.mockRestore();
        computed.mockRestore();
      };
    }

    const many = (count: number, prefix = 'n') =>
      Array.from({ length: count }, (_, i) => leaf(`${prefix}${i}`, `Node ${String(i).padStart(4, '0')}`));
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const viewport = () => document.querySelector('[role="tree"]') as HTMLElement;
    function scrollTo(top: number): void {
      viewport().scrollTop = top;
      fireEvent.scroll(viewport());
    }

    it('renders only a window of a 5,000-node tree once the viewport has a height', async () => {
      const restore = withLayout();
      try {
        const nodes = many(5000);
        const { fixture } = await setup({ loader: () => nodes });
        fireEvent.scroll(viewport());
        fixture.detectChanges();

        expect(rows().length).toBeGreaterThan(0);
        expect(rows().length).toBeLessThan(40);
        expect(rows()[0]).toHaveAttribute('aria-setsize', '5000');
        expect(rows()[0]).toHaveAttribute('aria-posinset', '1');

        // Moving with the keyboard keeps the focused row rendered and focused.
        rows()[0].focus();
        fireEvent.focusIn(rows()[0]);
        key('End');
        expect(document.activeElement).toHaveAttribute('aria-posinset', '5000');
        expect(nameOf(document.activeElement as Element)).toBe('Node 4999');
        expect(rows().length).toBeLessThan(40);
      } finally {
        restore();
      }
    });

    it('renders a grown branch before scrolling to a revealed row', async () => {
      const restore = withLayout();
      try {
        const children = many(3000, 'c');
        const { tree, fixture } = await setup({
          loader: (parent) => (parent ? children : [folder('big', 'Big'), leaf('z', 'Zed')]),
        });
        await tree.expand('big');
        tree.collapse('big');
        fixture.detectChanges();
        const directive = fixture.debugElement
          .query((el) => el.nativeElement === viewport())
          .injector.get(SfVirtualScrollDirective);
        const counts: number[] = [];
        const original = directive.scrollToIndex.bind(directive);
        vi.spyOn(directive, 'scrollToIndex').mockImplementation((index, align) => {
          counts.push(directive.count());
          original(index, align);
        });

        await tree.reveal(['big', 'c2999']);
        expect(counts.at(-1)).toBe(3002);
        expect(nameOf(document.activeElement as Element)).toBe('Node 2999');
      } finally {
        restore();
      }
    });

    it('parks focus on the scroller when the focused row scrolls away, and keeps the keys working', async () => {
      const restore = withLayout();
      try {
        await setup({ loader: () => many(2000) });
        fireEvent.scroll(viewport());
        rows()[0].focus();
        fireEvent.focusIn(rows()[0]);

        scrollTo(28 * 1000);
        expect(rows().some((row) => nameOf(row) === 'Node 0000')).toBe(false);
        expect(document.activeElement).toBe(viewport());
        expect(viewport()).toHaveAttribute('tabindex', '-1');

        // Scrolling back re-focuses the row.
        scrollTo(0);
        expect(nameOf(document.activeElement as Element)).toBe('Node 0000');

        scrollTo(28 * 1000);
        expect(document.activeElement).toBe(viewport());
        key('ArrowDown');
        expect(nameOf(document.activeElement as Element)).toBe('Node 0001');
      } finally {
        restore();
      }
    });

    it('keeps an open editor’s text when it scrolls out of the window and back', async () => {
      const restore = withLayout();
      try {
        await setup({ loader: () => many(2000) });
        fireEvent.scroll(viewport());
        rows()[0].focus();
        fireEvent.focusIn(rows()[0]);
        key('F2');
        const input = screen.getByRole('textbox', { name: 'Rename' });
        fireEvent.input(input, { target: { value: 'Renamed' } });

        scrollTo(28 * 1000);
        await Promise.resolve();
        expect(screen.queryByRole('textbox')).toBeNull();
        scrollTo(0);
        const again = screen.getByRole('textbox', { name: 'Rename' });
        expect(again).toHaveValue('Renamed');
        expect(document.activeElement).toBe(again);
      } finally {
        restore();
      }
    });
  });
});
