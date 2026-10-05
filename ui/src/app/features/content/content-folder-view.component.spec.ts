import '@angular/compiler';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ContentFolderViewComponent } from './content-folder-view.component';
import { ContentStoreRefresh } from './content-store-refresh.service';
import { buildIndex } from './content-tree.util';
import { ContentService, type DatasetSummaryView, type FolderView, type RecordSetSummaryView } from './content.service';

/** The Content folder view (M35.20): the table, the folder's actions, the dataset filter, the bulk actions and their Undo. */

/** The folder tree as the REST API sends it: stored folder paths, record set leaves. */
const TREE: FolderView[] = [
  {
    uuid: 'root',
    uid: 'content_root',
    displayName: 'All Content',
    path: '/content_root/',
    protectedFolder: true,
    type: 'FOLDER',
    children: [
      {
        uuid: 'shop',
        uid: 'shop',
        displayName: 'Shop',
        path: '/content_root/shop/',
        type: 'FOLDER',
        children: [
          { uuid: 'set-espresso', uid: 'espresso', displayName: 'Espresso blends', type: 'RECORD_SET', recordCount: 4 },
          { uuid: 'set-tours', uid: 'tours', displayName: 'Roastery tours', type: 'RECORD_SET', recordCount: 3 },
          { uuid: 'spring', uid: 'spring', displayName: 'Spring 2026', path: '/content_root/shop/spring/', type: 'FOLDER', children: [] },
        ],
      },
      { uuid: 'company', uid: 'company', displayName: 'Company', path: '/content_root/company/', type: 'FOLDER', children: [] },
      { uuid: 'set-team', uid: 'team', displayName: 'Team', type: 'RECORD_SET', recordCount: 5 },
    ],
  },
];

/** The set list: `folderPath` is store-relative as the API sends it. */
const SETS: RecordSetSummaryView[] = [
  {
    uuid: 'set-espresso',
    uid: 'espresso',
    displayName: 'Espresso blends',
    dataset: { uuid: 'ds-products', displayName: 'Products' },
    folderUuid: 'shop',
    folderPath: '/shop/',
    recordCount: 4,
    queryValid: true,
    revision: 3,
    changedAt: '2026-10-02T08:00:00Z',
    release: { '': { status: 'CHANGED' } } as never,
  },
  {
    uuid: 'set-tours',
    uid: 'tours',
    displayName: 'Roastery tours',
    dataset: { uuid: 'ds-events', displayName: 'Events' },
    folderUuid: 'shop',
    folderPath: '/shop/',
    recordCount: 3,
    queryValid: false,
    revision: 2,
  },
  {
    uuid: 'set-team',
    uid: 'team',
    displayName: 'Team',
    dataset: { uuid: 'ds-team', displayName: 'Team members' },
    folderUuid: 'root',
    folderPath: '/',
    recordCount: 5,
    queryValid: true,
    revision: 1,
  },
];

const DATASETS: DatasetSummaryView[] = [
  { uuid: 'ds-products', displayName: 'Products' },
  { uuid: 'ds-events', displayName: 'Events' },
  { uuid: 'ds-team', displayName: 'Team members' },
];

function stubs() {
  return {
    content: {
      moveAsset: vi.fn().mockReturnValue(of({})),
      moveFolder: vi.fn().mockReturnValue(of({})),
      deleteRecordSet: vi.fn().mockReturnValue(of(undefined)),
    },
    api: {
      deleteFolder: vi.fn().mockReturnValue(of(undefined)),
      restoreFolder: vi.fn().mockReturnValue(of({})),
      assetHistory: vi.fn().mockReturnValue(of([{ revision: 8, deleted: true }, { revision: 3, deleted: false }])),
      restoreAsset: vi.fn().mockReturnValue(of({})),
      duplicateAsset: vi.fn().mockImplementation((_key: string, uuid: string) => of({ uuid: `${uuid}-copy` })),
      deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    },
  };
}

const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

async function open(
  options: { folderUuid?: string | null; canEdit?: boolean; datasets?: DatasetSummaryView[]; loading?: boolean; failed?: boolean; confirm?: boolean; sets?: RecordSetSummaryView[]; canRelease?: boolean } = {},
) {
  const { content, api } = stubs();
  const confirm = vi.fn().mockResolvedValue(options.confirm ?? true);
  const view = await render(ContentFolderViewComponent, {
    componentInputs: {
      projectKey: 'proj',
      folderUuid: options.folderUuid === undefined ? 'shop' : options.folderUuid,
      index: buildIndex(TREE, options.sets ?? SETS),
      tree: TREE,
      datasets: options.datasets ?? DATASETS,
      loading: options.loading ?? false,
      failed: options.failed ?? false,
    },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideFavoritesStub(),
      ContentStoreRefresh,
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: api },
      { provide: ConfirmService, useValue: { confirm } },
      { provide: ProjectPermissionsStore, useValue: { canEditContent: signal(options.canEdit ?? true), canRelease: signal(options.canRelease ?? true) } },
    ],
  });
  const component = view.fixture.componentInstance;
  const outputs = {
    openSet: vi.fn(),
    openFolder: vi.fn(),
    newFolder: vi.fn(),
    newRecordSet: vi.fn(),
    rename: vi.fn(),
    newFolderIn: vi.fn(),
    newRecordSetIn: vi.fn(),
    renameEntry: vi.fn(),
    releaseEntries: vi.fn(),
    retry: vi.fn(),
  };
  for (const [name, spy] of Object.entries(outputs)) {
    (component as unknown as Record<string, { subscribe(fn: unknown): void }>)[name].subscribe(spy);
  }
  return { view, content, api, confirm, toasts: TestBed.inject(ToastService), refresh: TestBed.inject(ContentStoreRefresh), outputs };
}

const openMenuItem = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
};

describe('the Content folder view', () => {
  describe('the table', () => {
    it('lists the sub-folders first, then the record sets, with dataset, record count and status', async () => {
      await open();

      expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeTruthy();
      const rows = await screen.findAllByRole('row');
      expect(within(rows[1]).getByText('Spring 2026')).toBeTruthy();
      expect(within(rows[1]).getByText('Folder')).toBeTruthy();
      expect(within(rows[2]).getByText('Espresso blends')).toBeTruthy();
      expect(within(rows[2]).getByText('Products')).toBeTruthy();
      expect(within(rows[2]).getByText('4')).toBeTruthy();
      expect(within(rows[3]).getByText('Roastery tours')).toBeTruthy();
      expect(within(rows[3]).getByText('Query invalid')).toBeTruthy();
    });

    it('lists the store root as All content: its folders and the sets directly in it', async () => {
      await open({ folderUuid: null });

      expect(await screen.findByRole('heading', { level: 1, name: 'All content' })).toBeTruthy();
      const rows = await screen.findAllByRole('row');
      expect(rows.slice(1).map((r) => within(r).queryByText(/^(Company|Shop|Team)$/)?.textContent)).toEqual(['Company', 'Shop', 'Team']);
    });

    it('reads a folder that is not in the tree any more as the store root', async () => {
      await open({ folderUuid: 'gone' });
      expect(await screen.findByRole('heading', { level: 1, name: 'All content' })).toBeTruthy();
    });

    it('shows when a set was last changed, and a dash where nothing is known (a folder, a set without a change time)', async () => {
      await open();
      const rows = await screen.findAllByRole('row');

      expect(rows[2].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-02T08:00:00.000Z');
      expect(rows[1].querySelector('time')).toBeNull();
      expect(within(rows[1]).getAllByText('—').length).toBeGreaterThan(0);
      expect(rows[3].querySelector('time')).toBeNull();
      expect(within(rows[3]).getAllByText('—').length).toBeGreaterThan(0);
    });

    it('opens a row through the outputs', async () => {
      const { outputs } = await open();

      fireEvent.click(await screen.findByText('Espresso blends'));
      expect(outputs.openSet).toHaveBeenCalledWith('set-espresso');
      fireEvent.click(screen.getByText('Spring 2026'));
      expect(outputs.openFolder).toHaveBeenCalledWith('spring');
    });

    it('shows the empty state for a folder without anything in it', async () => {
      await open({ folderUuid: 'company' });
      expect(await screen.findByText('This folder is empty')).toBeTruthy();
    });

    it('shows the error state with a retry that the area answers', async () => {
      const { outputs } = await open({ failed: true });

      expect(await screen.findByText('The folder could not be loaded.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(outputs.retry).toHaveBeenCalled();
    });

    it('shows the loading skeleton while the store is read', async () => {
      await open({ loading: true });
      expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeTruthy();
      expect(document.querySelector('.sf-skeleton, [aria-busy="true"]')).not.toBeNull();
    });
  });

  describe('the dataset filter ("Dataset: Products")', () => {
    it('narrows the table to the sets of the picked dataset, and a folder drops out', async () => {
      const { view } = await open();
      await screen.findByText('Espresso blends');
      const table = view.fixture.debugElement.query(By.directive(SfDataTableComponent)).componentInstance as SfDataTableComponent<unknown>;

      table.toggleFilterValue('dataset', 'ds-products');
      view.fixture.detectChanges();

      await waitFor(() => expect(screen.queryByText('Roastery tours')).toBeNull());
      expect(screen.getByText('Espresso blends')).toBeTruthy();
      expect(screen.queryByText('Spring 2026')).toBeNull();
      expect(screen.getByText(/Dataset/, { selector: '.sf-data-table__chip, [class*="chip"] *, [class*="chip"]' })).toBeTruthy();
    });
  });

  describe('the folder header', () => {
    it('offers New folder and New record set, which the area answers', async () => {
      const { outputs } = await open();

      fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
      fireEvent.click(screen.getByRole('button', { name: 'New record set' }));

      expect(outputs.newFolder).toHaveBeenCalled();
      expect(outputs.newRecordSet).toHaveBeenCalled();
    });

    it('says why a record set cannot be created without a dataset', async () => {
      await open({ datasets: [] });
      expect(screen.getByRole('button', { name: 'New record set' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('disables the create buttons and the bulk actions for a viewer', async () => {
      await open({ canEdit: false });
      expect(screen.getByRole('button', { name: 'New folder' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'New record set' })).toBeDisabled();
      await screen.findByText('Espresso blends');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('has no ⋮ menu at the store root, which cannot be renamed, moved or deleted', async () => {
      await open({ folderUuid: null });
      await screen.findByText('Company');
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    });

    it('renames in the tree: the header asks the area to start the in-place edit', async () => {
      const { outputs } = await open();
      await screen.findByText('Espresso blends');

      await openMenuItem('Rename');

      expect(outputs.rename).toHaveBeenCalledWith('shop');
    });

    it('moves the open folder through the picker, which lists folders only, and Undo moves it back', async () => {
      const { content, toasts } = await open({ folderUuid: 'spring' });
      await screen.findByRole('heading', { level: 1, name: 'Spring 2026' });

      await openMenuItem('Move…');
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      expect(within(dialog).getAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim())).toEqual([
        'All content',
        'Company',
        'Shop',
      ]);
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Company/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(content.moveFolder).toHaveBeenCalledWith('proj', 'spring', 'company'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Moved “Spring 2026”'));
      lastToast(toasts).action!.run();
      await waitFor(() => expect(content.moveFolder).toHaveBeenLastCalledWith('proj', 'spring', 'shop'));
    });

    it('deletes the open folder after a danger confirmation, Undo restores the whole folder with one call, and the view goes up', async () => {
      const { api, confirm, toasts, outputs } = await open({ folderUuid: 'spring' });
      await screen.findByRole('heading', { level: 1, name: 'Spring 2026' });

      await openMenuItem('Delete…');

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'spring', true));
      expect(confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger', title: 'Delete “Spring 2026”?' });
      await waitFor(() => expect(outputs.openFolder).toHaveBeenCalledWith('shop'));
      expect(lastToast(toasts).message).toBe('Deleted “Spring 2026”');
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'spring'));
    });

    it('does not delete when the confirmation is cancelled', async () => {
      const { api, outputs } = await open({ folderUuid: 'spring', confirm: false });
      await screen.findByRole('heading', { level: 1, name: 'Spring 2026' });

      await openMenuItem('Delete…');

      await waitFor(() => expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy());
      expect(api.deleteFolder).not.toHaveBeenCalled();
      expect(outputs.openFolder).not.toHaveBeenCalled();
    });
  });

  describe('bulk actions', () => {
    async function selectAll() {
      await screen.findByText('Espresso blends');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    }

    it('deletes the selection in order — a folder as a folder, a set with its records — and one Undo restores each', async () => {
      const { content, api, toasts, refresh } = await open();
      await selectAll();
      const ticks = refresh.tick();

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'spring', true));
      await waitFor(() => expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-espresso', true));
      await waitFor(() => expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-tours', true));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Deleted 3 items'));
      expect(refresh.tick()).toBeGreaterThan(ticks);

      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'spring'));
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-espresso', { fromRevision: 3 }));
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-tours', { fromRevision: 3 }));
    });

    it('asks once, naming what goes with the sets, and asks for the typed word from 25 items', async () => {
      const { confirm } = await open();
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      const options = confirm.mock.calls[0][0];
      expect(options.message).toContain('7 records');
      expect(options.typeToConfirm).toBeUndefined();
      expect(options.details).toEqual(['Spring 2026', 'Espresso blends', 'Roastery tours']);
    });

    it('stops at the first failure, keeps what was deleted undoable and says so', async () => {
      const { content, api, toasts } = await open();
      content.deleteRecordSet.mockReturnValueOnce(throwError(() => new Error('500')));
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalled());
      await waitFor(() => expect(toasts.toasts().some((t) => t.kind === 'error')).toBe(true));
      expect(content.deleteRecordSet).toHaveBeenCalledTimes(1);
      expect(toasts.toasts().some((t) => t.message === 'Deleted “Spring 2026”' && !!t.action)).toBe(true);
    });

    it('moves folders with the folder move and sets with the asset move into the chosen folder, Undo puts each back', async () => {
      const { content, toasts } = await open();
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Move…' }));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Company/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(content.moveFolder).toHaveBeenCalledWith('proj', 'spring', 'company'));
      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-espresso', 'company'));
      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-tours', 'company'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Moved 3 items'));

      lastToast(toasts).action!.run();
      await waitFor(() => expect(content.moveFolder).toHaveBeenLastCalledWith('proj', 'spring', 'shop'));
      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-tours', 'shop'));
    });

    it('moves to the store root with no folder, and a folder being moved cannot be its own target', async () => {
      const { content } = await open();
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Move…' }));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^All content/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-espresso', undefined));
      await waitFor(() => expect(content.moveFolder).toHaveBeenCalledWith('proj', 'spring', undefined));
    });
  });

  describe('the row menu', () => {
    type Menu = (rows: unknown[]) => ContextMenuItem[];
    const menuOf = (view: { fixture: { componentInstance: unknown } }) => (view.fixture.componentInstance as { rowMenu: Menu }).rowMenu;
    const rowsOf = (view: { fixture: { componentInstance: unknown } }) => (view.fixture.componentInstance as { rows: () => unknown[] }).rows();
    const labels = (items: ContextMenuItem[]) => items.filter((item) => !item.separator).map((item) => item.label);

    it('offers a folder row the entries of the tree menu, Open first', async () => {
      const { view } = await open();
      const [folder] = rowsOf(view);

      expect(labels(menuOf(view)([folder]))).toEqual([
        'Open',
        'New folder',
        'New record set',
        'Rename…',
        'Cut',
        'Paste',
        'Move to…',
        'Add “Spring 2026” to favorites',
        'Release…',
        'Delete',
      ]);
    });

    it('offers a record set row no New entries, and no Release without the right', async () => {
      const { view } = await open({ canRelease: false });
      const set = rowsOf(view)[1];

      expect(labels(menuOf(view)([set]))).toEqual(['Open', 'Rename…', 'Cut', 'Copy', 'Paste', 'Move to…', 'Add “Espresso blends” to favorites', 'Delete']);
    });

    it('creates inside the folder, renames in the dialog and releases the row', async () => {
      const { view, outputs } = await open();
      const [folder] = rowsOf(view);
      const items = menuOf(view)([folder]);
      const run = (label: string) => items.find((item) => item.label === label)!.action!();

      run('New folder');
      run('New record set');
      run('Rename…');
      run('Release…');

      expect(outputs.newFolderIn).toHaveBeenCalledWith('spring');
      expect(outputs.newRecordSetIn).toHaveBeenCalledWith('spring');
      expect(outputs.renameEntry).toHaveBeenCalledWith(folder);
      expect(outputs.releaseEntries).toHaveBeenCalledWith([folder]);
    });

    it('cuts a set and pastes it onto a folder row with the same move the tree does, Undo puts it back', async () => {
      const { view, content, toasts } = await open();
      const [folder, set] = rowsOf(view);
      menuOf(view)([set]).find((item) => item.label === 'Cut')!.action!();
      expect(TestBed.inject(TreeClipboardService).nodes()?.scope).toBe('proj:content');

      const paste = menuOf(view)([folder]).find((item) => item.label === 'Paste')!;
      expect(paste.disabled).toBeFalsy();
      paste.action!();

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-espresso', 'spring'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Moved “Espresso blends”'));
      expect(TestBed.inject(TreeClipboardService).nodes()).toBeNull();
    });

    it('copies a set and pastes it onto a folder row: one duplicate into that folder, one Undo deletes the copy', async () => {
      const { view, api, toasts } = await open();
      const [folder, set] = rowsOf(view);
      menuOf(view)([set]).find((item) => item.label === 'Copy')!.action!();
      expect(TestBed.inject(TreeClipboardService).nodes()).toMatchObject({ mode: 'copy', scope: 'proj:content' });

      const paste = menuOf(view)([folder]).find((item) => item.label === 'Paste')!;
      expect(paste.disabled).toBeFalsy();
      paste.action!();

      await waitFor(() => expect(api.duplicateAsset).toHaveBeenCalledWith('proj', 'set-espresso', 'spring'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Copied “Espresso blends”'));
      // a copy stays on the clipboard: it can be pasted again
      expect(TestBed.inject(TreeClipboardService).nodes()?.mode).toBe('copy');
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'set-espresso-copy'));
    });

    it('copies several sets with one call each and offers one Undo; a copy can be pasted next to the set too', async () => {
      const { view, api } = await open();
      const [, espresso, tours] = rowsOf(view);
      const items = menuOf(view)([espresso, tours]);
      expect(labels(items)).toContain('Copy');
      items.find((item) => item.label === 'Copy')!.action!();

      menuOf(view)([espresso]).find((item) => item.label === 'Paste')!.action!();

      await waitFor(() => expect(api.duplicateAsset).toHaveBeenCalledTimes(2));
      expect(api.duplicateAsset).toHaveBeenNthCalledWith(1, 'proj', 'set-espresso', 'shop');
      expect(api.duplicateAsset).toHaveBeenNthCalledWith(2, 'proj', 'set-tours', 'shop');
    });

    it('does not offer Copy on a folder or a selection holding one, and does not paste a copied folder', async () => {
      const { view } = await open();
      const rows = rowsOf(view);

      expect(labels(menuOf(view)([rows[0]]))).not.toContain('Copy');
      expect(labels(menuOf(view)(rows))).not.toContain('Copy');
      TestBed.inject(TreeClipboardService).copyNodes('proj:content', [{ id: 'spring', label: 'Spring 2026', data: rows[0] } as never]);
      expect(menuOf(view)([rows[0]]).find((item) => item.label === 'Paste')!.disabled).toBe(true);
    });

    it('says so when a copy fails, and keeps the Undo of what was copied', async () => {
      const { view, api, toasts } = await open();
      const [folder, espresso, tours] = rowsOf(view);
      api.duplicateAsset.mockImplementationOnce((_k: string, uuid: string) => of({ uuid: `${uuid}-copy` })).mockReturnValueOnce(throwError(() => new Error('422')));
      menuOf(view)([espresso, tours]).find((item) => item.label === 'Copy')!.action!();

      menuOf(view)([folder]).find((item) => item.label === 'Paste')!.action!();

      await waitFor(() => expect(toasts.toasts().some((toast) => toast.kind === 'error' && /Could not copy/.test(toast.message))).toBe(true));
      expect(toasts.toasts().some((toast) => toast.message === 'Copied “Espresso blends”')).toBe(true);
    });

    it('does not paste a folder into itself or a set where it already is', async () => {
      const { view } = await open();
      const [folder, set] = rowsOf(view);
      menuOf(view)([folder]).find((item) => item.label === 'Cut')!.action!();
      expect(menuOf(view)([folder]).find((item) => item.label === 'Paste')!.disabled).toBe(true);

      menuOf(view)([set]).find((item) => item.label === 'Cut')!.action!();
      // a set row pastes next to itself: into the open folder, where it already is
      expect(menuOf(view)([set]).find((item) => item.label === 'Paste')!.disabled).toBe(true);
    });

    it('offers a selection Cut and the bulk actions: Move…, Release…, Delete', async () => {
      const { view } = await open();

      expect(labels(menuOf(view)(rowsOf(view)))).toEqual(['Cut', 'Move…', 'Release…', 'Delete']);
    });
  });

  describe('the bulk bar', () => {
    it('releases the selection through the area', async () => {
      const { outputs } = await open();
      await screen.findByText('Espresso blends');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Release…' }));

      expect(outputs.releaseEntries).toHaveBeenCalled();
      expect(outputs.releaseEntries.mock.calls[0][0].map((row: { uuid: string }) => row.uuid)).toEqual(['spring', 'set-espresso', 'set-tours']);
    });

    it('has no Release without the release right', async () => {
      await open({ canRelease: false });
      await screen.findByText('Espresso blends');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

      expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull();
    });
  });
});
