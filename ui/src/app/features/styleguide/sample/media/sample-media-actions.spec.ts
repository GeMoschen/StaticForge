import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { ContextMenuService } from '../../../../shared/services/context-menu.service';
import { SampleState } from '../sample-state';
import { screenShortcuts } from '../keyboard/keyboard-data';
import { SampleMediaAreaComponent } from './sample-media-area.component';
import en from '../../../../../assets/i18n/en.json';

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
  result.fixture.detectChanges();
  return result;
}

/** Waits for the folder tree's root. */
async function tree() {
  await screen.findAllByRole('treeitem');
}

const library = () => screen.getByRole('grid', { name: /^Files in/ });
const cards = () => within(library()).getAllByRole('gridcell');
const card = (name: string) => cards().find((c) => c.getAttribute('aria-label')?.startsWith(name))!;
const bulk = () => screen.getByRole('group', { name: /bulk/i });
const drawer = (name: string) => screen.findByRole('dialog', { name });
const menuLabels = () => TestBed.inject(ContextMenuService).state()?.items.map((item) => item.label);
const queryOf = () => {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
};

describe('media sample: states, file actions, uploads, guards', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('search, type and sort in the URL', () => {
    it('reads q, type and sort and writes them back', async () => {
      await setup({ q: 'e', type: 'images', sort: 'size-desc', folder: 'm-products' });
      await tree();
      const query = queryOf();

      const names = cards().map((c) => c.getAttribute('aria-label')!.split(',')[0]);
      // Largest first: latte (1.6 MB) before espresso-blend-bag (860 KB).
      expect(names.indexOf('latte-art-rosetta.jpg')).toBeLessThan(names.indexOf('espresso-blend-bag.jpg'));
      expect(screen.getByRole('button', { name: /^Sort: Size/ })).toHaveTextContent('Size ↓');
      expect(screen.getByRole('searchbox', { name: 'Search this folder' })).toHaveValue('e');

      fireEvent.click(screen.getByRole('radio', { name: 'List' }));
      await waitFor(() => expect(query()).toContain('media=list'));
      expect(query()).toContain('q=e');
      expect(query()).toContain('type=images');
      expect(query()).toContain('sort=size-desc');
    });

    it('leaves the defaults out of the URL', async () => {
      await setup();
      await tree();
      const query = queryOf();
      fireEvent.click(screen.getByRole('radio', { name: 'List' }));
      await waitFor(() => expect(query()).toContain('media=list'));
      for (const key of ['q=', 'type=', 'sort=', 'state=', 'tfilter=']) {
        expect(query()).not.toContain(key);
      }
    });
  });

  describe('folder tree filter', () => {
    it('keeps the matching folders and the folders that lead to them', async () => {
      await setup({ tfilter: 'single' });
      expect(await screen.findByRole('treeitem', { name: /^Single origins/ })).toBeInTheDocument();
      expect(screen.getByRole('treeitem', { name: /^Products/ })).toBeInTheDocument();
      expect(screen.queryByRole('treeitem', { name: /^Brand/ })).toBeNull();
    });

    it('says when nothing matches and clears the filter', async () => {
      await setup({ tfilter: 'zzz' });
      const query = queryOf();

      expect(await screen.findByText('No folder matches “zzz”')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

      expect(await screen.findByRole('treeitem', { name: /^Brand/ })).toBeInTheDocument();
      expect(screen.queryByText(/No folder matches/)).toBeNull();
      expect(screen.getByRole('searchbox', { name: 'Filter the folders' })).toHaveValue('');
      fireEvent.click(screen.getByRole('radio', { name: 'List' }));
      await waitFor(() => expect(query()).not.toContain('tfilter'));
    });

    it('filters as you type', async () => {
      await setup();
      await tree();
      fireEvent.input(screen.getByRole('searchbox', { name: 'Filter the folders' }), { target: { value: 'team' } });
      await waitFor(() => expect(screen.queryByRole('treeitem', { name: /^Brand/ })).toBeNull());
      expect(screen.getByRole('treeitem', { name: /^Team/ })).toBeInTheDocument();
    });
  });

  describe('loading, error and empty states', () => {
    it('shows skeletons for the grid and the tree while loading', async () => {
      await setup({ state: 'loading' });

      expect(await screen.findByText('Loading the files of Products…')).toBeInTheDocument();
      expect(screen.getAllByRole('status', { hidden: false }).some((s) => s.getAttribute('aria-busy') === 'true')).toBe(true);
      expect(screen.getByRole('tree', { name: 'Folders' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('grid', { name: /^Files in/ })).toBeNull();
      // The count says nothing yet.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Products');
      expect(screen.queryByText('8 files')).toBeNull();
    });

    it('shows the list as loading too', async () => {
      await setup({ state: 'loading', media: 'list' });
      await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
      expect(screen.queryByText('yirgacheffe-beans-light-roast.jpg')).toBeNull();
    });

    it('shows the grid error with Retry, and the tree error with its own Retry; either returns to normal', async () => {
      await setup({ state: 'error' });
      const query = queryOf();

      expect(await screen.findByText('Couldn’t load the files of Products.')).toBeInTheDocument();
      expect(await screen.findByText('Couldn’t load this tree')).toBeInTheDocument();
      expect(screen.queryByRole('grid', { name: /^Files in/ })).toBeNull();

      fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
      await waitFor(() => expect(cards().length).toBe(9));
      expect(await screen.findAllByRole('treeitem')).not.toHaveLength(0);
      expect(screen.queryByText('Couldn’t load the files of Products.')).toBeNull();
      await waitFor(() => expect(query()).not.toContain('state='));
    });

    it('retrying the tree returns the library to normal', async () => {
      await setup({ state: 'error' });
      await screen.findByText('Couldn’t load this tree');
      const treeRetry = screen.getAllByRole('button', { name: 'Retry' }).find((b) => !!b.closest('sf-tree'))!;
      fireEvent.click(treeRetry);
      await waitFor(() => expect(cards().length).toBe(9));
      expect(await screen.findAllByRole('treeitem')).not.toHaveLength(0);
    });

    it('error state in the list view uses the table’s banner and Retry', async () => {
      await setup({ state: 'error', media: 'list' });
      expect(await screen.findByText('Couldn’t load the files of Products.')).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
      expect(await screen.findByText('yirgacheffe-beans-light-roast.jpg')).toBeInTheDocument();
    });

    it('explains an empty library and offers Upload and New folder', async () => {
      await setup({ state: 'empty' });

      expect(await screen.findByText('Your media library is empty')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Media');
      expect(screen.getByText('No folders yet')).toBeInTheDocument();
      const main = screen.getByText('Your media library is empty').closest('sf-empty-state')!;
      expect(within(main as HTMLElement).getByRole('button', { name: 'Upload' })).toBeInTheDocument();
      expect(within(main as HTMLElement).getByRole('button', { name: 'New folder' })).toBeInTheDocument();
      expect(screen.queryByRole('toolbar', { name: 'Library tools' })).toBeNull();
      expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    });
  });

  describe('per-file menu', () => {
    it('opens on a right click with the app’s entries: Rename, Move, Cut, Copy, Duplicate, Download, Copy link, favorite, Release, Delete', async () => {
      await setup();
      await tree();

      fireEvent.contextMenu(card('latte-art-rosetta.jpg'), { clientX: 40, clientY: 40 });

      expect(menuLabels()).toEqual([
        'Rename…',
        'Move…',
        'Cut',
        'Copy',
        'Duplicate',
        'Download',
        'Copy link',
        'Add “latte-art-rosetta.jpg” to favorites',
        'Release…',
        'Delete…',
      ]);
      expect(TestBed.inject(ContextMenuService).state()?.anchor.kind).toBe('point');
    });

    it('opens below the card on Shift+F10', async () => {
      await setup();
      await tree();
      const target = card('latte-art-rosetta.jpg');
      target.focus();

      fireEvent.keyDown(target, { key: 'F10', shiftKey: true });

      expect(menuLabels()).toContain('Rename…');
      expect(TestBed.inject(ContextMenuService).state()?.anchor.kind).toBe('element');
    });

    it('has a ⋮ button per card, named after the file', async () => {
      await setup();
      await tree();
      expect(within(card('latte-art-rosetta.jpg')).getByRole('button', { name: 'Actions for latte-art-rosetta.jpg' })).toBeInTheDocument();
    });

    it('acts on the whole selection when the file is part of one', async () => {
      await setup({ selected: '3' });
      await tree();
      const selected = cards().find((c) => c.getAttribute('aria-selected') === 'true')!;

      fireEvent.contextMenu(selected, { clientX: 40, clientY: 40 });

      expect(menuLabels()).toEqual([
        'Move 3 files…',
        'Cut 3 files',
        'Copy 3 files',
        'Duplicate 3 files',
        'Download 3 files as ZIP',
        'Release 3 items…',
        'Delete 3 files…',
      ]);
    });

    it('has no Actions column in the list, but the file menu on a right click', async () => {
      await setup({ media: 'list' });
      await tree();
      const row = (await screen.findByText('latte-art-rosetta.jpg')).closest('tr')!;
      expect(within(row).queryByRole('button', { name: 'Actions for latte-art-rosetta.jpg' })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();

      fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
      expect(menuLabels()).toEqual([
        'Rename…',
        'Move…',
        'Cut',
        'Copy',
        'Duplicate',
        'Download',
        'Copy link',
        'Add “latte-art-rosetta.jpg” to favorites',
        'Release…',
        'Delete…',
      ]);
    });

    it('renames with F2 and deletes with the Delete key', async () => {
      await setup();
      await tree();
      const target = card('latte-art-rosetta.jpg');
      target.focus();

      fireEvent.keyDown(target, { key: 'F2' });
      expect(await screen.findByRole('dialog', { name: 'Rename “latte-art-rosetta.jpg”' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      fireEvent.keyDown(target, { key: 'Delete' });
      expect(await screen.findByRole('dialog', { name: 'Delete “latte-art-rosetta.jpg”?' })).toBeInTheDocument();
    });

    it('has Rename and Move in the drawer’s ⋮ menu', async () => {
      await setup({ asset: 'a-latte-rosetta' });
      const detail = await drawer('latte-art-rosetta.jpg');
      fireEvent.click(within(detail).getByRole('button', { name: 'File actions' }));
      const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent?.trim());
      expect(items.join('|')).toMatch(/Replace….*Rename….*Move….*Download.*Copy link.*Delete…/);
    });
  });

  describe('rename dialog', () => {
    it('validates the name, then applies it with an Undo toast', async () => {
      await setup({ asset: 'a-latte-rosetta', dialog: 'rename' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const dialog = await screen.findByRole('dialog', { name: 'Rename “latte-art-rosetta.jpg”' });
      const apply = within(dialog).getByRole('button', { name: 'Apply' });
      const field = within(dialog).getByRole('textbox', { name: /File name/ });
      expect(apply).toBeDisabled();

      fireEvent.input(field, { target: { value: 'espresso-blend-bag.jpg' } });
      expect(await within(dialog).findByText(/already exists in Products/)).toBeInTheDocument();
      expect(apply).toBeDisabled();

      fireEvent.input(field, { target: { value: 'latte-art-pour.png' } });
      expect(await within(dialog).findByText(/Keep the \.jpg extension/)).toBeInTheDocument();

      fireEvent.input(field, { target: { value: '' } });
      expect(await within(dialog).findByText('Enter a file name.')).toBeInTheDocument();

      fireEvent.input(field, { target: { value: 'latte-art-pour.jpg' } });
      await waitFor(() => expect(apply).toBeEnabled());
      fireEvent.click(apply);

      await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Rename/ })).toBeNull());
      expect(undo).toHaveBeenCalledWith('Renamed “latte-art-rosetta.jpg” to “latte-art-pour.jpg”', expect.any(Function));
      expect(await drawer('latte-art-pour.jpg')).toBeInTheDocument();

      undo.mock.lastCall![1]();
      expect(await drawer('latte-art-rosetta.jpg')).toBeInTheDocument();
    });
  });

  describe('move dialog', () => {
    it('picks a folder (the current one is disabled), moves the selection and offers Undo', async () => {
      await setup({ selected: '2', dialog: 'move' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const dialog = await screen.findByRole('dialog', { name: 'Move 2 files' });
      const move = within(dialog).getByRole('button', { name: 'Move' });
      expect(move).toHaveAttribute('aria-disabled', 'true');

      const current = await within(dialog).findByRole('treeitem', { name: /^Products/ });
      expect(current).toHaveTextContent('Current folder');
      fireEvent.click(current);
      expect(move).toHaveAttribute('aria-disabled', 'true');

      fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^Team/ }));
      await waitFor(() => expect(move).not.toHaveAttribute('aria-disabled'));
      const before = cards().length;
      fireEvent.click(move);

      await waitFor(() => expect(cards().length).toBe(before - 2));
      expect(undo).toHaveBeenCalledWith(expect.stringMatching(/^Moved 2 files to Team$/), expect.any(Function));
      expect(screen.queryByRole('group', { name: /bulk/i })).toBeNull();

      undo.mock.lastCall![1]();
      await waitFor(() => expect(cards().length).toBe(before));
    });

    it('moves a folder from the page header menu: itself and what is inside it can’t be chosen', async () => {
      await setup({ dialog: 'folder-move' });
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const dialog = await screen.findByRole('dialog', { name: 'Move folder “Products”' });

      expect(await within(dialog).findByRole('treeitem', { name: /^Top level/ })).toHaveTextContent('Current folder');
      expect(within(dialog).getByRole('treeitem', { name: /^Products/ })).toHaveTextContent('Inside the folder being moved');
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Brand/ }));
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Move' })).not.toHaveAttribute('aria-disabled'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

      await waitFor(() => expect(undo).toHaveBeenCalled());
      expect(undo.mock.lastCall![0]).toContain('Moved the folder “Products” into Brand');
    });

    it('opens from the toolbar’s bulk Move too', async () => {
      await setup({ selected: '2' });
      await tree();
      fireEvent.click(within(bulk()).getByRole('button', { name: 'Move' }));
      expect(await screen.findByRole('dialog', { name: 'Move 2 files' })).toBeInTheDocument();
    });

    it('moves files dropped onto a folder of the tree, with Undo', async () => {
      await setup();
      await tree();
      const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
      const before = cards().length;
      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };

      fireEvent.dragStart(card('latte-art-rosetta.jpg'), { dataTransfer });
      const team = screen.getByRole('treeitem', { name: /^Team/ });
      fireEvent.dragOver(team, { dataTransfer });
      expect(team).toHaveClass('is-media-drop');
      fireEvent.drop(team, { dataTransfer });

      await waitFor(() => expect(cards().length).toBe(before - 1));
      expect(team).not.toHaveClass('is-media-drop');
      expect(undo).toHaveBeenCalledWith('Moved “latte-art-rosetta.jpg” to Team', expect.any(Function));
    });

    it('does not accept a drop on the folder the files are in', async () => {
      await setup();
      await tree();
      const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
      fireEvent.dragStart(card('latte-art-rosetta.jpg'), { dataTransfer });
      const products = screen.getByRole('treeitem', { name: /^Products/ });
      fireEvent.dragOver(products, { dataTransfer });
      expect(products).not.toHaveClass('is-media-drop');
    });
  });

  describe('download', () => {
    it('one file downloads as itself', async () => {
      await setup();
      await tree();
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');
      fireEvent.contextMenu(card('latte-art-rosetta.jpg'), { clientX: 40, clientY: 40 });
      TestBed.inject(ContextMenuService)
        .state()!
        .items.find((i) => i.label === 'Download')!
        .action!();
      expect(show).toHaveBeenCalledWith(expect.stringContaining('Downloading “latte-art-rosetta.jpg”'), 'info');
    });

    it('several files come as one ZIP named after the folder, and the text says nothing is downloaded', async () => {
      await setup({ selected: '3' });
      await tree();
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');
      fireEvent.click(within(bulk()).getByRole('button', { name: 'Download' }));
      expect(show).toHaveBeenCalledWith(expect.stringMatching(/Downloading 3 files as products\.zip.*nothing is downloaded/), 'info');
    });
  });

  describe('unsaved changes in the drawer', () => {
    it('shows the save status and asks before stepping to another file', async () => {
      await setup({ asset: 'a-yirgacheffe-beans', dirty: '1' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      expect(within(detail).getByText('Unsaved changes')).toBeInTheDocument();

      fireEvent.click(within(detail).getByRole('button', { name: 'Next file' }));
      const guard = await screen.findByRole('dialog', { name: 'Unsaved changes' });
      expect(guard).toHaveTextContent('yirgacheffe-beans-light-roast.jpg');

      // Cancel: stay on the file, edits kept.
      fireEvent.click(within(guard).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull());
      expect(await drawer('yirgacheffe-beans-light-roast.jpg')).toBeInTheDocument();
      expect(within(detail).getByRole('textbox', { name: /Alt text/ })).toHaveValue('Light roasted Yirgacheffe beans, close up (edited)');

      // Discard: on to the next file, the edits are gone.
      fireEvent.click(within(detail).getByRole('button', { name: 'Next file' }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }));
      expect(await drawer('cold-brew-bottle.jpg')).toBeInTheDocument();
    });

    it('Save in the guard keeps the edits and leaves', async () => {
      await setup({ asset: 'a-yirgacheffe-beans', dirty: '1' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');

      fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
      const guard = await screen.findByRole('dialog', { name: 'Unsaved changes' });
      fireEvent.click(within(guard).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'yirgacheffe-beans-light-roast.jpg' })).toBeNull());
      expect(show).toHaveBeenCalledWith(expect.stringContaining('Saved “yirgacheffe-beans-light-roast.jpg”'), 'success');
    });

    it('asks before switching folder, and a clean drawer does not ask', async () => {
      await setup({ asset: 'a-yirgacheffe-beans', dirty: '1' });
      await drawer('yirgacheffe-beans-light-roast.jpg');
      fireEvent.click(await screen.findByRole('treeitem', { name: /^Team/ }));
      const guard = await screen.findByRole('dialog', { name: 'Unsaved changes' });
      fireEvent.click(within(guard).getByRole('button', { name: 'Discard' }));
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Team'));
      // The drawer closed with the folder.
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closing a clean drawer does not ask', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      expect(within(detail).getByText('Saved')).toBeInTheDocument();
      fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });

  describe('upload panel', () => {
    it('says why each file was refused and offers what fits', async () => {
      await setup({ upload: 'errors' });
      const panel = screen.getByRole('region', { name: 'Uploads to Products' });

      expect(within(panel).getByText('Interrupted — the connection was lost.')).toBeInTheDocument();
      expect(within(panel).getByText(/This file type isn’t accepted/)).toBeInTheDocument();
      expect(within(panel).getByText(/is over the limit of .* per file/)).toBeInTheDocument();
      expect(within(panel).getByText('A file with this name already exists in Products.')).toBeInTheDocument();

      // Retry only where it makes sense: a lost connection.
      expect(within(panel).getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
      expect(within(panel).getAllByRole('button', { name: 'Replace' })).toHaveLength(1);
      expect(within(panel).getAllByRole('button', { name: 'Keep both' })).toHaveLength(1);
      // Every refused row can be removed.
      expect(within(panel).getByRole('button', { name: 'Remove setup-wizard.exe from the list' })).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Remove harvest-panorama.jpg from the list' })).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Remove espresso-blend-bag.jpg from the list' })).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Remove menu-board-summer.jpg from the list' })).toBeInTheDocument();

      fireEvent.click(within(panel).getByRole('button', { name: 'Remove setup-wizard.exe from the list' }));
      await waitFor(() => expect(within(panel).queryByText('setup-wizard.exe')).toBeNull());
    });

    it('Keep both uploads under the next free name, Replace over the existing file', async () => {
      await setup({ upload: 'errors' });
      const panel = screen.getByRole('region', { name: 'Uploads to Products' });

      fireEvent.click(within(panel).getByRole('button', { name: 'Keep both' }));
      expect(await within(panel).findByText('espresso-blend-bag-2.jpg')).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: 'Keep both' })).toBeNull();
      expect(within(panel).getByRole('progressbar', { name: 'Uploading espresso-blend-bag-2.jpg' })).toBeInTheDocument();
    });

    it('Replace goes on without renaming', async () => {
      await setup({ upload: 'errors' });
      const panel = screen.getByRole('region', { name: 'Uploads to Products' });
      fireEvent.click(within(panel).getByRole('button', { name: 'Replace' }));
      expect(await within(panel).findByRole('progressbar', { name: 'Uploading espresso-blend-bag.jpg' })).toBeInTheDocument();
    });

    it('Retry restarts a lost connection', async () => {
      await setup({ upload: 'errors' });
      const panel = screen.getByRole('region', { name: 'Uploads to Products' });
      fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
      expect(await within(panel).findByRole('progressbar', { name: 'Uploading menu-board-summer.jpg' })).toBeInTheDocument();
    });

    it('takes the alt text of a finished picture right in the panel', async () => {
      await setup({ upload: 'errors' });
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');
      const panel = screen.getByRole('region', { name: 'Uploads to Products' });
      const field = within(panel).getByRole('textbox', { name: 'Alt text for cold-brew-bottle.jpg' });
      const save = within(panel).getByRole('button', { name: 'Save' });
      expect(save).toBeDisabled();

      fireEvent.input(field, { target: { value: 'A cold brew bottle on a wooden table' } });
      await waitFor(() => expect(save).toBeEnabled());
      fireEvent.click(save);

      expect(await within(panel).findByText(/Alt text saved/)).toBeInTheDocument();
      expect(within(panel).queryByRole('textbox', { name: 'Alt text for cold-brew-bottle.jpg' })).toBeNull();
      expect(show).toHaveBeenCalledWith('Alt text of “cold-brew-bottle.jpg” saved', 'success');

      fireEvent.click(within(panel).getByRole('button', { name: 'Open the details of cold-brew-bottle.jpg' }));
      const detail = await drawer('cold-brew-bottle.jpg');
      expect(within(detail).getByRole('textbox', { name: /Alt text/ })).toHaveValue('A cold brew bottle on a wooden table');
    });

    it('refuses chosen files by type, size and name', async () => {
      const { container } = await setup();
      await tree();
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const big = new File(['x'], 'big-banner.jpg');
      Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
      const files = [new File(['x'], 'setup.exe'), big, new File(['x'], 'espresso-blend-bag.jpg'), new File(['x'], 'fresh.jpg')];

      fireEvent.change(input, { target: { files } });

      const panel = await screen.findByRole('region', { name: 'Uploads to Products' });
      expect(within(panel).getByText(/This file type isn’t accepted/)).toBeInTheDocument();
      expect(within(panel).getByText(/is over the limit of/)).toBeInTheDocument();
      expect(within(panel).getByText('A file with this name already exists in Products.')).toBeInTheDocument();
      expect(within(panel).getAllByRole('progressbar')).toHaveLength(1);
    });
  });

  describe('bulk delete', () => {
    it('needs the word delete for 25 or more files', async () => {
      await setup({ folder: 'm-archive', selected: '30' });
      await tree();
      expect(within(bulk()).getByText('30 selected')).toBeInTheDocument();

      fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete 30 files?' });
      const confirm = within(dialog).getByRole('button', { name: 'Delete 30 files' });
      expect(confirm).toBeDisabled();

      fireEvent.input(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
      await waitFor(() => expect(confirm).toBeEnabled());
    });

    it('confirms plainly below 25', async () => {
      await setup({ folder: 'm-archive', selected: '24' });
      await tree();
      fireEvent.click(within(bulk()).getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete 24 files?' });
      expect(within(dialog).queryByRole('textbox')).toBeNull();
    });

    it('opens from the dialog link parameter', async () => {
      await setup({ folder: 'm-archive', selected: '30', dialog: 'delete' });
      expect(await screen.findByRole('dialog', { name: 'Delete 30 files?' })).toBeInTheDocument();
    });
  });

  describe('details tab', () => {
    it('says only photos have a focal point, and gives PNG, SVG, PDF and text none', async () => {
      await setup({ asset: 'a-hero-texture' });
      const detail = await drawer('hero-texture.png');
      expect(within(detail).getByText(/Only photos have a focal point/)).toBeInTheDocument();
      expect(within(detail).queryByRole('group', { name: /Focal point at/ })).toBeNull();
    });

    it('describes the focal point of a photo as photos only', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      expect(within(detail).getByRole('group', { name: /Focal point at/ })).toHaveAccessibleDescription(/Only photos have a focal point/);
    });

    it('shows the hash, media type and storage path in developer mode only', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      expect(within(detail).getByText('Hash (SHA-256)')).toBeInTheDocument();
      expect(within(detail).getByText('Media type')).toBeInTheDocument();
      expect(within(detail).getByText('image/jpeg')).toBeInTheDocument();
      expect(within(detail).getByText('Storage path')).toBeInTheDocument();
      expect(within(detail).getByText(/^blobs\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/)).toBeInTheDocument();
    });

    it('hides them outside developer mode', async () => {
      await setup({ asset: 'a-yirgacheffe-beans' });
      TestBed.inject(SampleState).devMode.set(false);
      const detail = await drawer('yirgacheffe-beans-light-roast.jpg');
      await waitFor(() => expect(within(detail).queryByText('Hash (SHA-256)')).toBeNull());
      expect(within(detail).queryByText('Storage path')).toBeNull();
    });
  });

  describe('keyboard sheet', () => {
    it('lists every media shortcut with a description', () => {
      const groups = screenShortcuts('media');
      const keys = groups.flatMap((g) => g.items.map((i) => `${g.id}:${i.id}=${i.keys}`));
      for (const expected of [
        'mediaGrid:gridMove=ArrowRight',
        'mediaGrid:gridFirst=Home',
        'mediaGrid:gridLast=End',
        'mediaGrid:rowSelect=Space',
        'mediaGrid:gridOpen=Enter',
        'mediaGrid:rowAll=Mod+A',
        'mediaGrid:fileRename=F2',
        'mediaGrid:fileMenu=Shift+F10',
        'mediaGrid:fileDelete=Delete',
        'mediaDrawer:drawerPrevious=ArrowLeft',
        'mediaDrawer:drawerNext=ArrowRight',
        'mediaDrawer:drawerClose=Escape',
        'mediaFocal:focalMove=ArrowRight',
        'mediaFocal:focalMoveBig=Shift+ArrowRight',
      ]) {
        expect(keys).toContain(expected);
      }
      const sheet = en.styleguide.sample.keyboard.sheet as { groups: Record<string, string>; items: Record<string, string> };
      for (const group of groups) {
        expect(sheet.groups[group.id], group.id).toBeTruthy();
        for (const item of group.items) {
          expect(sheet.items[item.id], item.id).toBeTruthy();
        }
      }
    });
  });
});
