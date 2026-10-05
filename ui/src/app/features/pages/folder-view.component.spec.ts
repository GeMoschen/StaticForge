import '@angular/compiler';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ReleaseEventsStore } from '../release/release-events.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { FolderSettingsDrawerComponent } from './folder-settings-drawer.component';
import { FolderViewComponent } from './folder-view.component';
import { folderRows, pageUrl } from './folder-view.util';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { PagesTreeRefresh } from './pages-tree-refresh.service';

/** The folder view (M35.18): the table, the folder's actions, the bulk actions and their Undo. */

const SUB = { uuid: 'folder-sub', uid: 'sub', displayName: 'Sub', path: '/pages_root/a/sub/', revision: 2, children: [] };
const ALPHA = { uuid: 'folder-a', uid: 'alpha', displayName: 'Alpha', path: '/pages_root/a/', revision: 4, children: [SUB] };
const BETA = { uuid: 'folder-b', uid: 'beta', displayName: 'Beta', path: '/pages_root/b/', revision: 1, children: [] };
const TREE = [{ uuid: 'root', uid: 'pages_root', displayName: 'All Pages', path: '/pages_root/', protectedFolder: true, children: [ALPHA, BETA] }];

const page = (n: number, extra: Record<string, unknown> = {}) => ({
  uuid: `page-${n}`,
  uid: `page-${n}`,
  type: 'PAGE',
  displayName: `Page ${n}`,
  folderPath: '/pages_root/a/',
  revision: 3,
  release: {},
  templateName: 'Article',
  changedAt: '2026-05-01T10:00:00Z',
  changedByName: 'Ada',
  ...extra,
});

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    listPages: vi.fn().mockReturnValue(of([page(1)])),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 5 })),
    renameAsset: vi.fn().mockReturnValue(of({ revision: 6 })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    moveFolder: vi.fn().mockReturnValue(of({})),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    duplicateAsset: vi.fn().mockImplementation((_k: string, uuid: string) => of({ uuid: `${uuid}-copy` })),
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 7, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    ...overrides,
  };
}

const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

describe('folder view', () => {
  beforeEach(() => {
    TestBed.overrideComponent(FolderSettingsDrawerComponent, {
      remove: { imports: [SfAssetUrlsComponent] },
      add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
  });

  async function open(api: ReturnType<typeof apiStub>, options: { confirm?: ReturnType<typeof vi.fn>; folderUuid?: string | null } = {}) {
    const confirm = options.confirm ?? vi.fn().mockResolvedValue(true);
    const view = await render(FolderViewComponent, {
      componentInputs: { projectKey: 'proj', folderUuid: options.folderUuid === undefined ? 'folder-a' : options.folderUuid },
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideFavoritesStub(),
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: { confirm } },
        {
          provide: ProjectContextStore,
          useValue: { pageFolderTree: signal(TREE), pageTemplates: signal([]), loadFor: vi.fn().mockReturnValue(of(undefined)) },
        },
        { provide: ProjectPermissionsStore, useValue: { canRelease: signal(true), canRedirectOldUrls: signal(false) } },
        { provide: ProjectAccessStore, useValue: { readOnly: signal(false) } },
        { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
        { provide: TimeTravelStore, useValue: { activeRevision: signal(null) } },
        { provide: ReleaseEventsStore, useValue: { version: signal(0) } },
        { provide: LocalesStore, useValue: { labelOf: (code: string) => code } },
        { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
      ],
    });
    return { view, confirm, toasts: TestBed.inject(ToastService) };
  }

  const openMenuItem = async (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name }));
  };

  it('lists the sub-folders first, then the pages, with the folder as the page heading', async () => {
    await open(apiStub());

    expect(await screen.findByRole('heading', { level: 1, name: 'Alpha' })).toBeTruthy();
    await screen.findByText('Page 1');
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('Sub')).toBeTruthy();
    expect(within(rows[2]).getByText('Page 1')).toBeTruthy();
    expect(within(rows[2]).getByText('Article')).toBeTruthy();
  });

  it('opens a row through the outputs', async () => {
    const { view } = await open(apiStub());
    const openPage = vi.fn();
    const openFolder = vi.fn();
    view.fixture.componentInstance.openPage.subscribe(openPage);
    view.fixture.componentInstance.openFolder.subscribe(openFolder);

    fireEvent.click(await screen.findByText('Page 1'));
    expect(openPage).toHaveBeenCalledWith('page-1');
    fireEvent.click(screen.getByText('Sub'));
    expect(openFolder).toHaveBeenCalledWith('folder-sub');
  });

  describe('row context menu', () => {
    interface Probe {
      rows(): { key: string; kind: string; uuid: string; name: string }[];
      rowMenu(rows: unknown[]): { label: string; disabled?: boolean; separator?: boolean; action?: () => void }[];
      renameTo(row: unknown, name: string): void;
      renaming(): unknown;
      dialog(): { kind: string; choices?: { assetUuid: string; checked: boolean }[] } | null;
    }
    const labels = (items: { label: string; separator?: boolean }[]) => items.filter((item) => !item.separator).map((item) => item.label);

    async function menuOf(api: ReturnType<typeof apiStub>) {
      const { view, toasts } = await open(api);
      await screen.findByText('Page 1');
      TestBed.inject(TreeClipboardService).clear();
      const probe = view.fixture.componentInstance as unknown as Probe;
      const row = (key: string) => probe.rows().find((r) => r.key === key)!;
      return { probe, row, toasts };
    }

    it('a folder row has the tree menu for a folder, and no Open or Duplicate', async () => {
      const { probe, row } = await menuOf(apiStub());

      expect(labels(probe.rowMenu([row('folder:folder-sub')]))).toEqual([
        'New folder', 'Rename…', 'Cut', 'Paste', 'Move to…', 'Add “Sub” to favorites', 'Release…', 'Delete',
      ]);
    });

    it('a page row has Duplicate and Copy but no New folder', async () => {
      const { probe, row } = await menuOf(apiStub());

      expect(labels(probe.rowMenu([row('page:page-1')]))).toEqual([
        'Rename…', 'Cut', 'Copy', 'Paste', 'Move to…', 'Add “Page 1” to favorites', 'Duplicate', 'Release…', 'Delete',
      ]);
    });

    it('renames through the rename dialog and offers Undo', async () => {
      const api = apiStub();
      const { probe, row, toasts } = await menuOf(api);

      probe.rowMenu([row('page:page-1')]).find((item) => item.label === 'Rename…')!.action!();
      expect(probe.renaming()).toEqual(expect.objectContaining({ uuid: 'page-1' }));
      probe.renameTo(row('page:page-1'), 'Renamed');

      await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'page-1', { displayName: 'Renamed' }, undefined));
      await waitFor(() => expect(probe.renaming()).toBeNull());
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.renameAsset).toHaveBeenLastCalledWith('proj', 'page-1', { displayName: 'Page 1' }, 6));
    });

    it('cut then paste onto a folder row moves into it; Paste is disabled with an empty clipboard', async () => {
      const api = apiStub();
      const { probe, row } = await menuOf(api);
      const paste = () => probe.rowMenu([row('folder:folder-sub')]).find((item) => item.label === 'Paste')!;
      expect(paste().disabled).toBe(true);

      probe.rowMenu([row('page:page-1')]).find((item) => item.label === 'Cut')!.action!();
      expect(paste().disabled).toBe(false);
      paste().action!();

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'page-1', { folderUuid: 'folder-sub' }));
      expect(TestBed.inject(TreeClipboardService).nodes()).toBeNull();
    });

    it('copy then paste onto a folder row duplicates the page into it', async () => {
      const api = apiStub();
      const { probe, row } = await menuOf(api);

      probe.rowMenu([row('page:page-1')]).find((item) => item.label === 'Copy')!.action!();
      probe.rowMenu([row('folder:folder-sub')]).find((item) => item.label === 'Paste')!.action!();

      await waitFor(() => expect(api.duplicateAsset).toHaveBeenCalledWith('proj', 'page-1', 'folder-sub'));
    });

    it('does not offer pasting a folder into itself', async () => {
      const { probe, row } = await menuOf(apiStub());

      probe.rowMenu([row('folder:folder-sub')]).find((item) => item.label === 'Cut')!.action!();

      expect(probe.rowMenu([row('folder:folder-sub')]).find((item) => item.label === 'Paste')!.disabled).toBe(true);
    });

    it('Release… on a folder row collects what is inside it, ticked; nothing to release says so', async () => {
      const changed = page(1, { release: { '': { status: 'CHANGED' } } });
      const api = apiStub({ listPages: vi.fn().mockReturnValue(of([changed])) });
      const { probe, row } = await menuOf(api);

      probe.rowMenu([row('folder:folder-sub')]).find((item) => item.label === 'Release…')!.action!();

      await waitFor(() => expect(probe.dialog()?.kind).toBe('release'));
      expect(api.listPages).toHaveBeenCalledWith('proj', { folder: 'folder-sub' });
      expect(probe.dialog()!.choices!.map((choice) => [choice.assetUuid, choice.checked])).toEqual([['page-1', true]]);
    });

    it('says nothing is waiting when a folder has nothing to release', async () => {
      const { probe, row, toasts } = await menuOf(apiStub());

      probe.rowMenu([row('folder:folder-sub')]).find((item) => item.label === 'Release…')!.action!();

      await waitFor(() => expect(lastToast(toasts).message).toBe('Nothing here is waiting to be released.'));
      expect(probe.dialog()).toBeNull();
    });

    it('a selection gets the bulk entries; Duplicate only when it holds a page', async () => {
      const { probe, row } = await menuOf(apiStub());

      expect(labels(probe.rowMenu([row('folder:folder-sub'), row('page:page-1')]))).toEqual(['Move…', 'Release…', 'Duplicate', 'Delete']);
      expect(labels(probe.rowMenu([row('folder:folder-sub'), row('folder:folder-sub')]))).toEqual(['Move…', 'Release…', 'Delete']);
    });
  });

  describe('delete the open folder', () => {
    it('deletes after a danger confirmation, and Undo restores the whole folder with one call', async () => {
      const api = apiStub();
      const { confirm, toasts, view } = await open(api);
      const opened = vi.fn();
      view.fixture.componentInstance.openFolder.subscribe(opened);
      await screen.findByText('Page 1');

      await openMenuItem('Delete folder');

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'folder-a', true));
      const options = confirm.mock.calls[0][0];
      expect(options.tone).toBe('danger');
      expect(options.irreversible).toBeUndefined();
      expect(options.typeToConfirm).toBeUndefined();
      expect(lastToast(toasts).message).toBe('Deleted “Alpha” and everything inside it.');
      expect(opened).toHaveBeenCalledWith(null);

      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'folder-a'));
      expect(api.restoreFolder).toHaveBeenCalledTimes(1);
    });

    it('does not delete when the confirmation is declined', async () => {
      const api = apiStub();
      await open(api, { confirm: vi.fn().mockResolvedValue(false) });
      await screen.findByText('Page 1');

      await openMenuItem('Delete folder');

      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeTruthy());
      expect(api.deleteFolder).not.toHaveBeenCalled();
    });

    it('asks for the typed word when 25 or more items are inside', async () => {
      const api = apiStub({ listPages: vi.fn().mockReturnValue(of(Array.from({ length: 24 }, (_, i) => page(i)))) });
      const { confirm } = await open(api, { confirm: vi.fn().mockResolvedValue(false) });
      await screen.findByText('Page 1');

      await openMenuItem('Delete folder');

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
    });

    it('shows the error toast when the restore fails', async () => {
      const api = apiStub({ restoreFolder: vi.fn().mockReturnValue(throwError(() => new Error('409'))) });
      const { toasts } = await open(api);
      await screen.findByText('Page 1');
      await openMenuItem('Delete folder');
      await waitFor(() => expect(lastToast(toasts)?.action).toBeDefined());

      lastToast(toasts).action!.run();

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(lastToast(toasts).message).toMatch(/Could not undo/);
    });
  });

  it('a rename in the folder settings offers Undo, which renames back with the revision the rename produced', async () => {
    const api = apiStub();
    const { toasts } = await open(api);
    await screen.findByText('Page 1');

    await openMenuItem('Rename folder');
    fireEvent.input(await screen.findByDisplayValue('Alpha'), { target: { value: 'Omega' } });
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('proj', 'folder-a', { displayName: 'Omega' }, 4));
    expect(lastToast(toasts).message).toBe('Renamed “Alpha” to “Omega”.');

    lastToast(toasts).action!.run();
    await waitFor(() => expect(api.renameFolder).toHaveBeenLastCalledWith('proj', 'folder-a', { displayName: 'Alpha' }, 5));
  });

  describe('bulk actions', () => {
    async function selectAll() {
      await screen.findByText('Page 1');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    }

    it('deletes the selection in order and one Undo restores each: a folder as a folder, a page from its history', async () => {
      const api = apiStub();
      const { toasts } = await open(api);
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'folder-sub', true));
      expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'page-1');
      expect(lastToast(toasts).message).toBe('Deleted 2 items.');

      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'folder-sub'));
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'page-1', { fromRevision: 7 }));
    });

    it('moves folders with moveFolder and pages with moveAsset into the chosen folder', async () => {
      const api = apiStub();
      await open(api);
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Move…' }));
      fireEvent.click(await screen.findByText('Beta'));
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(api.moveFolder).toHaveBeenCalledWith('proj', 'folder-sub', { folderUuid: 'folder-b' }));
      expect(api.moveAsset).toHaveBeenCalledWith('proj', 'page-1', { folderUuid: 'folder-b' });
    });

    it('duplicates the selected pages and Undo deletes the copies', async () => {
      const api = apiStub();
      const { toasts } = await open(api);
      await selectAll();

      fireEvent.click(await screen.findByRole('button', { name: 'Duplicate' }));

      await waitFor(() => expect(api.duplicateAsset).toHaveBeenCalledWith('proj', 'page-1'));
      expect(api.duplicateAsset).toHaveBeenCalledTimes(1);
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'page-1-copy'));
    });

    it('re-reads the pages after a change', async () => {
      const api = apiStub();
      await open(api);
      await screen.findByText('Page 1');
      const before = api.listPages.mock.calls.length;

      TestBed.inject(PagesTreeRefresh).notify();

      await waitFor(() => expect(api.listPages.mock.calls.length).toBeGreaterThan(before));
    });
  });
});

describe('folder view rows', () => {
  it('puts folders before pages, each by name', () => {
    const rows = folderRows([BETA, ALPHA] as never, [page(2), page(1)] as never);
    expect(rows.map((row) => row.name)).toEqual(['Alpha', 'Beta', 'Page 1', 'Page 2']);
  });

  it('derives a page URL without the store root', () => {
    expect(pageUrl('/pages_root/news/', 'spring')).toBe('/news/spring');
    expect(pageUrl('/pages_root/', 'home')).toBe('/home');
  });
});
