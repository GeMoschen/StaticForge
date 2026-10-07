import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { ContextMenuService } from '../../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../../shared/services/tree-clipboard.service';
import { SampleState } from '../sample-state';
import { SampleMediaAreaComponent } from './sample-media-area.component';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleMediaAreaComponent, {
    providers: [
      SampleState,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  TestBed.inject(SampleState).devMode.set(true);
  await screen.findAllByRole('treeitem');
  result.fixture.detectChanges();
  return result;
}

const library = () => screen.getByRole('grid', { name: /^Files in/ });
const cards = () => within(library()).getAllByRole('gridcell');
const card = (name: string) => cards().find((c) => c.getAttribute('aria-label')?.startsWith(name))!;
const selected = () => cards().filter((c) => c.getAttribute('aria-selected') === 'true');
const names = (list: HTMLElement[]) => list.map((c) => c.getAttribute('aria-label')!.split(',')[0]);
const menu = () => TestBed.inject(ContextMenuService).state()?.items ?? [];
const labels = () => menu().map((item) => item.label);
/** Chooses an entry of the open context menu. */
const pick = (label: string) => {
  const item = menu().find((entry) => entry.label === label);
  expect(item, label).toBeTruthy();
  item!.action?.();
};
const bulk = () => screen.queryByRole('group', { name: /bulk/i });
const FILE = 'latte-art-rosetta.jpg';

describe('media sample: Explorer-style grid, menus and clipboard', () => {
  afterEach(() => {
    TestBed.inject(TreeClipboardService).clear();
    vi.restoreAllMocks();
  });

  describe('folders inline', () => {
    it('shows the open folder’s folders first, with the folder icon, a menu button and a checkbox', async () => {
      await setup();
      const folder = cards()[0];

      expect(folder).toHaveAttribute('aria-label', 'Single origins');
      expect(folder.querySelector('sf-icon.card__folder-icon')).not.toBeNull();
      expect(within(folder).getByRole('button', { name: 'Actions for Single origins' })).toBeInTheDocument();
      expect(within(folder).getByRole('checkbox', { name: 'Select Single origins' })).toBeInTheDocument();
      expect(within(folder).getByText('Folder')).toBeInTheDocument();
    });

    it('enters a folder on a double click and on Enter', async () => {
      await setup();
      fireEvent.dblClick(card('Single origins'));
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Single origins'));
      expect(cards().every((c) => !c.hasAttribute('data-folder'))).toBe(true);
    });

    it('opens the folder on Enter and renames it with F2 (the rename dialog)', async () => {
      await setup();
      const folder = card('Single origins');
      folder.focus();
      fireEvent.keyDown(folder, { key: 'F2' });
      expect(await screen.findByRole('dialog', { name: 'Rename “Single origins”' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      fireEvent.keyDown(folder, { key: 'Enter' });
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Single origins'));
    });

    it('lists the folders first in the list, with the folder type and no Actions column', async () => {
      await setup({ media: 'list' });
      const table = screen.getByRole('grid', { name: 'Files in Products' });
      const rows = within(table).getAllByRole('row');

      // Header row, then the folder, then the files.
      expect(rows[1]).toHaveTextContent('Single origins');
      expect(rows[1]).toHaveTextContent('Folder');
      expect(rows[2]).toHaveTextContent('.jpg');
      expect(within(table).queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    });
  });

  describe('selection like the Explorer', () => {
    it('a click selects only that card and does not open the file', async () => {
      await setup();
      fireEvent.click(card(FILE));
      fireEvent.click(card('cold-brew-bottle.jpg'));

      expect(names(selected())).toEqual(['cold-brew-bottle.jpg']);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Ctrl toggles, Shift selects the range from the anchor, folders and files alike', async () => {
      await setup();
      const all = cards();
      fireEvent.click(all[0]);
      fireEvent.click(all[1], { ctrlKey: true });
      expect(names(selected())).toEqual([names(all)[0], names(all)[1]]);
      fireEvent.click(all[1], { ctrlKey: true });
      expect(names(selected())).toEqual([names(all)[0]]);

      // The anchor is the card last clicked (all[1]): the range replaces the selection.
      fireEvent.click(all[3], { shiftKey: true });
      expect(names(selected())).toEqual(names(all).slice(1, 4));
      expect(within(bulk()!).getByText('3 selected')).toBeInTheDocument();
    });

    it('a double click opens the file’s detail', async () => {
      await setup();
      fireEvent.dblClick(card(FILE));
      expect(await screen.findByRole('dialog', { name: FILE })).toBeInTheDocument();
    });

    it('a click on empty space clears the selection', async () => {
      await setup({ selected: '3' });
      expect(selected()).toHaveLength(3);

      const host = library().closest('sf-sample-media-grid')!;
      fireEvent.mouseDown(host, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.mouseUp(document);

      await waitFor(() => expect(selected()).toHaveLength(0));
      expect(bulk()).toBeNull();
    });

    it('a rubber band selects the cards it touches; Ctrl keeps the selection', async () => {
      await setup();
      const host = library().closest('sf-sample-media-grid') as HTMLElement;
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 400 } as DOMRect);
      cards().forEach((c, i) =>
        vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({ left: i * 100, top: 0, width: 90, height: 90 } as DOMRect),
      );

      fireEvent.mouseDown(host, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(document, { clientX: 250, clientY: 50 });
      fireEvent.mouseUp(document);
      expect(selected()).toHaveLength(3);

      // Ctrl keeps what is selected and adds the next band.
      fireEvent.mouseDown(host, { button: 0, ctrlKey: true, clientX: 500, clientY: 0 });
      fireEvent.mouseMove(document, { clientX: 650, clientY: 50 });
      fireEvent.mouseUp(document);
      expect(selected().length).toBeGreaterThan(3);
      expect(selected().slice(0, 3)).toHaveLength(3);
    });

    it('Ctrl+A selects everything, Escape clears', async () => {
      await setup();
      const first = cards()[0];
      first.focus();
      fireEvent.keyDown(first, { key: 'a', ctrlKey: true });
      expect(selected()).toHaveLength(cards().length);
      expect(within(bulk()!).getByText('9 selected')).toBeInTheDocument();

      fireEvent.keyDown(first, { key: 'Escape' });
      expect(selected()).toHaveLength(0);
    });

    it('a right click on an unselected card selects it first; inside a selection the selection stays', async () => {
      await setup();
      fireEvent.click(card(FILE));
      fireEvent.contextMenu(card('cold-brew-bottle.jpg'), { clientX: 10, clientY: 10 });

      expect(names(selected())).toEqual(['cold-brew-bottle.jpg']);
      expect(labels()).toContain('Rename…');

      fireEvent.click(card(FILE));
      fireEvent.click(card('cold-brew-bottle.jpg'), { ctrlKey: true });
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      expect(selected()).toHaveLength(2);
      expect(labels()).toContain('Delete 2 files…');
    });
  });

  describe('menus', () => {
    it('file menu: the app’s entries in order, separators before Cut and Delete', async () => {
      await setup();
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });

      expect(labels()).toEqual([
        'Rename…',
        'Move…',
        'Cut',
        'Copy',
        'Duplicate',
        'Download',
        'Copy link',
        `Add “${FILE}” to favorites`,
        'Release…',
        'Delete…',
      ]);
      const separated = menu().filter((item) => item.separatorBefore).map((item) => item.label);
      expect(separated).toEqual(['Cut', 'Delete…']);
      expect(menu().every((item) => !item.disabled)).toBe(true);
    });

    it('folder menu: New folder, Rename, Cut, Paste (disabled), Move to, Upload, favorite, Release, Delete', async () => {
      await setup();
      fireEvent.contextMenu(card('Single origins'), { clientX: 10, clientY: 10 });

      expect(labels()).toEqual([
        'New folder',
        'Rename folder…',
        'Cut',
        'Paste',
        'Move to…',
        'Upload',
        'Add “Single origins” to favorites',
        'Release…',
        'Delete folder…',
      ]);
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBe(true);
      expect(menu().filter((item) => item.separatorBefore).map((item) => item.label)).toEqual(['Cut', 'Upload', 'Delete folder…']);
    });

    it('multi-selection menu with counts; Cut is for files only', async () => {
      await setup();
      fireEvent.click(card('Single origins'));
      fireEvent.click(card(FILE), { ctrlKey: true });
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });

      expect(labels()).toEqual([
        'Move 2 items…',
        'Copy 1 file',
        'Duplicate 1 file',
        'Download',
        'Release 2 items…',
        'Delete 2 items…',
      ]);

      TestBed.inject(ContextMenuService).close();
      fireEvent.click(card(FILE));
      fireEvent.click(card('cold-brew-bottle.jpg'), { ctrlKey: true });
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      expect(labels()).toEqual([
        'Move 2 files…',
        'Cut 2 files',
        'Copy 2 files',
        'Duplicate 2 files',
        'Download 2 files as ZIP',
        'Release 2 items…',
        'Delete 2 files…',
      ]);
    });

    it('empty space: Upload, New folder, Paste (disabled with an empty clipboard); the selection stays', async () => {
      await setup({ selected: '2' });
      const host = library().closest('sf-sample-media-grid')!;

      fireEvent.contextMenu(host, { clientX: 5, clientY: 5 });

      expect(labels()).toEqual(['Upload', 'New folder', 'Paste']);
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBe(true);
      expect(selected()).toHaveLength(2);
    });

    it('the list uses the same menus for its rows and its empty space', async () => {
      await setup({ media: 'list' });
      const table = screen.getByRole('grid', { name: 'Files in Products' });
      const folderRow = (await within(table).findByText('Single origins')).closest('tr')!;

      fireEvent.contextMenu(folderRow, { clientX: 10, clientY: 10 });
      expect(labels()[0]).toBe('New folder');
      expect(labels()).toContain('Delete folder…');

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(table, { clientX: 5, clientY: 5 });
      expect(labels()).toEqual(['Upload', 'New folder', 'Paste']);
    });

    it('a read-only project keeps what only reads', async () => {
      await setup({ readonly: '1' });

      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      expect(labels()).toEqual(['Download', 'Copy link', `Add “${FILE}” to favorites`]);

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(card('Single origins'), { clientX: 10, clientY: 10 });
      expect(labels()).toEqual(['Add “Single origins” to favorites']);

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(library().closest('sf-sample-media-grid')!, { clientX: 5, clientY: 5 });
      expect(menu()).toHaveLength(0);
    });

    it('opens the menu below the folder card on Shift+F10', async () => {
      await setup();
      const folder = card('Single origins');
      folder.focus();
      fireEvent.keyDown(folder, { key: 'F10', shiftKey: true });

      expect(labels()).toContain('New folder');
      expect(TestBed.inject(ContextMenuService).state()?.anchor.kind).toBe('element');
    });
  });

  describe('announced actions', () => {
    it('toggles the favorite and says so', async () => {
      await setup();
      const toasts = vi.spyOn(TestBed.inject(ToastService), 'show');
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      pick(`Add “${FILE}” to favorites`);
      expect(toasts).toHaveBeenCalledWith(`“${FILE}” added to your favorites.`, 'info');

      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      expect(labels()).toContain(`Remove “${FILE}” from favorites`);
    });

    it('Release with nothing pending is enabled and says so; with changes it announces them', async () => {
      await setup({ folder: 'm-downloads' });
      const toasts = vi.spyOn(TestBed.inject(ToastService), 'show');
      fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
      pick('Release…');
      expect(toasts).toHaveBeenLastCalledWith('Nothing here is waiting to be released.', 'info');

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^Products/ }), { clientX: 10, clientY: 10 });
      pick('Release…');
      expect(toasts).toHaveBeenLastCalledWith(expect.stringMatching(/^Releasing \d+ files? \(prototype/), 'info');
    });

    it('Cut puts the file on the clipboard, Paste on a folder card moves it (with Undo)', async () => {
      await setup();
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      pick('Cut');
      TestBed.inject(ContextMenuService).close();

      fireEvent.contextMenu(card('Single origins'), { clientX: 10, clientY: 10 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBeFalsy();
      pick('Paste');

      await waitFor(() => expect(cards()).toHaveLength(8));
      expect(undo).toHaveBeenCalledWith(`Moved “${FILE}” to Single origins`, expect.any(Function));
      undo.mock.lastCall![1]();
      await waitFor(() => expect(cards()).toHaveLength(9));
    });

    it('a cut file cannot be pasted into the folder it is in; a copied one can (empty-space Paste)', async () => {
      await setup();
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      pick('Cut');
      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(library().closest('sf-sample-media-grid')!, { clientX: 5, clientY: 5 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBe(true);

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      pick('Copy');
      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(library().closest('sf-sample-media-grid')!, { clientX: 5, clientY: 5 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBeFalsy();
      pick('Paste');

      await waitFor(() => expect(cards()).toHaveLength(10));
      expect(card('latte-art-rosetta-2.jpg')).toBeTruthy();
    });

    it('Duplicate adds a draft copy next to the file, with Undo', async () => {
      await setup();
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      pick('Duplicate');

      await waitFor(() => expect(cards()).toHaveLength(10));
      expect(card('latte-art-rosetta-2.jpg')).toBeTruthy();
      expect(undo).toHaveBeenCalledWith(`Duplicated “${FILE}”`, expect.any(Function));
      undo.mock.lastCall![1]();
      await waitFor(() => expect(cards()).toHaveLength(9));
    });

    it('a folder Cut on its tile is a cut of the tree: Paste is refused into itself and offered on another folder', async () => {
      await setup();
      fireEvent.contextMenu(card('Single origins'), { clientX: 10, clientY: 10 });
      pick('Cut');
      TestBed.inject(ContextMenuService).close();

      fireEvent.contextMenu(card('Single origins'), { clientX: 10, clientY: 10 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBe(true);
      TestBed.inject(ContextMenuService).close();

      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^Brand/ }), { clientX: 10, clientY: 10 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBeFalsy();
    });

    it('bulk bar buttons match the multi-selection menu', async () => {
      await setup({ selected: '2' });

      const expected = ['Move', 'Cut', 'Copy', 'Duplicate', 'Download', 'Release…', 'Delete', 'Clear selection'];
      expect(within(bulk()!).getAllByRole('button')).toHaveLength(expected.length);
      for (const name of expected) {
        expect(within(bulk()!).getByRole('button', { name })).toBeInTheDocument();
      }
    });
  });

  describe('folder tree', () => {
    it('is a multi-select tree and offers New folder, Rename, Cut, Paste, Move to, then Upload, favorite, Release, Delete on a folder', async () => {
      await setup();
      const item = screen.getByRole('treeitem', { name: /^Products/ });
      expect(screen.getByRole('tree')).toHaveAttribute('aria-multiselectable', 'true');

      fireEvent.contextMenu(item, { clientX: 10, clientY: 10 });
      const shown = labels();

      expect(shown.slice(0, 5)).toEqual(['New folder', 'Rename', 'Cut', 'Paste', 'Move to…']);
      expect(shown.slice(5, 8)).toEqual(['Upload', 'Add “Products” to favorites', 'Release…']);
      expect(shown.at(-1)).toMatch(/^Delete/);
      // One Rename only: the inline one.
      expect(shown.filter((label) => label.startsWith('Rename'))).toEqual(['Rename']);
    });

    it('pastes cut files from the grid with a “Paste N files” entry', async () => {
      await setup();
      fireEvent.click(card(FILE));
      fireEvent.click(card('cold-brew-bottle.jpg'), { ctrlKey: true });
      fireEvent.contextMenu(card(FILE), { clientX: 10, clientY: 10 });
      pick('Cut 2 files');
      TestBed.inject(ContextMenuService).close();

      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^Brand/ }), { clientX: 10, clientY: 10 });
      expect(labels()).toContain('Paste 2 files');
      pick('Paste 2 files');
      await waitFor(() => expect(cards()).toHaveLength(7));
    });

    it('right click on empty space: Upload and New folder; left click opens the root', async () => {
      await setup({ folder: 'm-origins' });
      const viewport = document.querySelector<HTMLElement>('.sf-tree__viewport')!;

      fireEvent.contextMenu(viewport, { clientX: 5, clientY: 5 });
      expect(labels()).toEqual(['Upload', 'New folder']);

      fireEvent.click(viewport);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Products'));
    });

    it('a read-only project has no tree editing', async () => {
      await setup({ readonly: '1' });
      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^Products/ }), { clientX: 10, clientY: 10 });
      expect(labels()).toEqual(['Add “Products” to favorites']);
    });
  });
});
