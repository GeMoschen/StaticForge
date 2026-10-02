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
    moveAsset: vi.fn().mockReturnValue(of({})),
    moveFolder: vi.fn().mockReturnValue(of({})),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    duplicatePage: vi.fn().mockImplementation((_k: string, uuid: string) => of({ uuid: `${uuid}-copy` })),
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
        { provide: ProjectPermissionsStore, useValue: { canRelease: signal(true) } },
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

      await waitFor(() => expect(api.duplicatePage).toHaveBeenCalledWith('proj', 'page-1'));
      expect(api.duplicatePage).toHaveBeenCalledTimes(1);
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
