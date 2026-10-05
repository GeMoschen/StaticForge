import '@angular/compiler';
import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { FavoritesService } from '../../core/assets/favorites.service';
import { AuthStore } from '../../core/auth/auth.store';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentFolderViewComponent } from './content-folder-view.component';
import type { ContentEntry } from './content-tree.util';
import { ContentComponent } from './content.component';
import type { DatasetSummaryView, FolderView, RecordSetSummaryView } from './content.service';
import { ContentService } from './content.service';

@Component({
  selector: 'sf-content-folder-view',
  standalone: true,
  template: '<p data-testid="folder-view">{{ folderUuid() ?? "root" }}</p>',
})
class FolderViewStub {
  readonly projectKey = input.required<string>();
  readonly folderUuid = input<string | null>(null);
  readonly index = input<unknown>();
  readonly tree = input<unknown>();
  readonly datasets = input<unknown>();
  readonly loading = input(false);
  readonly failed = input(false);
  readonly openSet = output<string>();
  readonly openFolder = output<string | null>();
  readonly newFolder = output<void>();
  readonly newRecordSet = output<void>();
  readonly rename = output<string>();
  readonly retry = output<void>();
}

@Component({ selector: 'sf-favorites-view', standalone: true, template: '<p data-testid="favorites-view"></p>' })
class FavoritesViewStub {}

/** The folder tree as the REST API sends it: the fixed "All Content" wrapper, folders with stored paths, record set leaves. */
const FOLDERS: FolderView[] = [
  {
    uuid: 'root',
    uid: 'content_root',
    displayName: 'All Content',
    path: '/content_root/',
    protectedFolder: true,
    type: 'FOLDER',
    children: [
      {
        uuid: 'team',
        uid: 'team',
        displayName: 'Team',
        path: '/content_root/team/',
        type: 'FOLDER',
        children: [{ uuid: 'set-leads', uid: 'leads', displayName: 'Leads', type: 'RECORD_SET', recordCount: 3 }],
      },
      { uuid: 'set-products', uid: 'products', displayName: 'Products', type: 'RECORD_SET', recordCount: 0 },
    ],
  },
];

/** The set list: `folderPath` is store-relative, as the API sends it. */
const SETS: RecordSetSummaryView[] = [
  {
    uuid: 'set-leads',
    uid: 'leads',
    displayName: 'Leads',
    dataset: { uuid: 'ds-team', displayName: 'Team' },
    folderUuid: 'team',
    folderPath: '/team/',
    recordCount: 3,
    queryValid: false,
    revision: 5,
    release: { '': { status: 'CHANGED' } } as never,
  },
  {
    uuid: 'set-products',
    uid: 'products',
    displayName: 'Products',
    dataset: { uuid: 'ds-product', displayName: 'Product' },
    folderUuid: 'root',
    folderPath: '/',
    recordCount: 0,
    queryValid: true,
    revision: 2,
    release: { '': { status: 'PUBLISHED' } } as never,
  },
];

const DATASETS: DatasetSummaryView[] = [
  { uuid: 'ds-team', displayName: 'Team' },
  { uuid: 'ds-product', displayName: 'Product' },
];

interface SetupOptions {
  folders?: FolderView[];
  sets?: RecordSetSummaryView[];
  datasets?: DatasetSummaryView[];
  content?: Record<string, unknown>;
  api?: Record<string, unknown>;
  role?: string;
  dev?: boolean;
  favorites?: unknown[];
  inputs?: Record<string, unknown>;
  confirm?: boolean;
  readOnly?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const content = {
    folders: vi.fn().mockReturnValue(of(options.folders ?? FOLDERS)),
    listDatasets: vi.fn().mockReturnValue(of(options.datasets ?? DATASETS)),
    listRecordSets: vi.fn().mockReturnValue(of(options.sets ?? SETS)),
    createRecordSet: vi.fn().mockReturnValue(of({ uuid: 'set-new' })),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'folder-new' })),
    moveFolder: vi.fn().mockReturnValue(of({})),
    moveAsset: vi.fn().mockReturnValue(of({})),
    deleteRecordSet: vi.fn().mockReturnValue(of(undefined)),
    ...options.content,
  };
  const api = {
    renameFolder: vi.fn().mockReturnValue(of({ revision: 6 })),
    renameAsset: vi.fn().mockReturnValue(of({ revision: 7 })),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 9, deleted: true }, { revision: 6, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    duplicateAsset: vi.fn().mockImplementation((_key: string, uuid: string) => of({ uuid: `${uuid}-copy` })),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    ...options.api,
  };
  const projectContext = { updateContentFolderTree: vi.fn() };
  const favorites = signal((options.favorites ?? []) as { uuid: string }[]);
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  const timeTravel = new TimeTravelStore();
  const role = options.role ?? 'EDITOR';
  const view = await render(ContentComponent, {
    componentInputs: { projectKey: 'proj', ...options.inputs },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: api },
      { provide: ConfirmService, useValue: confirm },
      { provide: AuthStore, useValue: { roleFor: () => role, isArchived: () => false } },
      { provide: TimeTravelStore, useValue: timeTravel },
      { provide: ProjectContextStore, useValue: projectContext },
      provideProjectPermissions({ role: () => role, readOnly: () => options.readOnly ?? false }),
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
      {
        provide: PreferencesService,
        useValue: {
          loaded: signal(true),
          treeExpansion: vi.fn(() => []),
          setTreeExpansion: vi.fn(),
          paneSize: vi.fn(() => undefined),
          setPaneSize: vi.fn(),
        },
      },
      {
        provide: FavoritesService,
        useValue: { list: favorites, isFavorite: (uuid: string) => favorites().some((f) => f.uuid === uuid), toggle: vi.fn(() => true), remove: vi.fn() },
      },
    ],
    configureTestBed: (tb) => {
      tb.overrideComponent(ContentComponent, {
        remove: { imports: [ContentFolderViewComponent, FavoritesViewComponent] },
        add: { imports: [FolderViewStub, FavoritesViewStub] },
      });
    },
  });
  const instance = view.fixture.componentInstance as unknown as {
    onMove(request: unknown): void;
    onRename(request: unknown): void;
    onDelete(request: unknown): void;
    openMoveDialog(nodes: unknown[]): void;
    menuItems(nodes: unknown[]): { label: string; disabled?: boolean; action: () => void }[];
    confirmDelete(nodes: unknown[]): Promise<boolean>;
    validateName(name: string, context: unknown): string | null;
  };
  const toasts = TestBed.inject(ToastService);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { ...view, content, api, favorites, confirm, instance, toasts, navigate, projectContext, timeTravel };
}

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const names = () => screen.queryAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim());
const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

const entry = (data: Partial<ContentEntry> & { uuid: string; name: string }): ContentEntry => ({
  kind: 'set',
  uid: '',
  path: '/content_root/',
  release: null,
  scheduled: false,
  revision: null,
  datasetUuid: null,
  datasetName: null,
  recordCount: 0,
  queryValid: true,
  changedAt: null,
  ...data,
});
const node = (data: Partial<ContentEntry> & { uuid: string; name: string }) => ({ id: data.uuid, label: data.name, data: entry(data) });

describe('ContentComponent (record sets)', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('the tree', () => {
    it('shows folders and record sets as leaves with their record count, loading a folder when it is opened', async () => {
      await setup();
      // The tree sorts siblings by name, folders and sets alike.
      await waitFor(() => expect(names()).toEqual(['Products', 'Team']));
      expect(row('Products').textContent).toContain('0');
      expect(screen.queryByText('Leads')).toBeNull();

      row('Team').focus();
      fireEvent.focusIn(row('Team'));
      fireEvent.keyDown(row('Team'), { key: 'ArrowRight' });

      expect(await screen.findByText('Leads')).toBeTruthy();
      expect(row('Leads').textContent).toContain('3');
    });

    it('flags a record set whose stored query is invalid with text, and badges what is not released', async () => {
      await setup({ inputs: { folder: 'team' } });
      const leads = await screen.findByRole('treeitem', { name: /Leads/ });

      expect(within(leads).getByText('Query invalid')).toBeTruthy();
      expect(within(leads).getByText('Changed')).toBeTruthy();
      expect(within(row('Products')).queryByText('Released')).toBeNull();
      expect(within(row('Products')).queryByText('Query invalid')).toBeNull();
    });

    it('shows the UID beside the name only in developer mode', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(2));
      expect(screen.queryByText('products')).toBeNull();
    });

    it('shows the UID in developer mode', async () => {
      await setup({ dev: true });
      expect(await screen.findByText('products')).toBeTruthy();
    });

    it('filters over the whole store, including sets in folders that were never opened', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(2));

      fireEvent.input(screen.getByRole('searchbox', { name: /filter/i }), { target: { value: 'lead' } });

      await waitFor(() => expect(names()).toContain('Leads'), { timeout: 3000 });
    });

    it('pins a Favorites node on top only while there are favorites', async () => {
      await setup({ favorites: [{ kind: 'RECORD_SET', uuid: 'set-products', title: 'Products', folderPath: '/content_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));
    });

    it('has no Favorites node without favorites', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(2));
      expect(names()).not.toContain('Favorites');
    });

    it('selects the open folder and shows its table (?folder=)', async () => {
      await setup({ inputs: { folder: 'team' } });
      await waitFor(() => expect(row('Team')).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getByTestId('folder-view')).toHaveTextContent('team');
    });

    it('shows the Favorites list instead of a folder when asked for', async () => {
      await setup({ inputs: { favorites: '1' }, favorites: [{ kind: 'RECORD_SET', uuid: 'set-products', title: 'Products' }] });
      expect(await screen.findByTestId('favorites-view')).toBeTruthy();
      expect(screen.queryByTestId('folder-view')).toBeNull();
    });

    it('hands every tree it loads to the shared project context, so the export picker sees new folders', async () => {
      const { projectContext } = await setup();
      await waitFor(() => expect(projectContext.updateContentFolderTree).toHaveBeenCalledWith('proj', FOLDERS));
    });
  });

  describe('opening', () => {
    it('opens a set in the set view and a folder as the folder table (?folder=)', async () => {
      const { navigate } = await setup();
      await waitFor(() => expect(names().length).toBe(2));

      fireEvent.click(row('Products'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'content', 'sets', 'set-products'], { queryParams: {} });

      fireEvent.click(row('Team'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'content'], { queryParams: { folder: 'team' } });
    });

    it('opens the Favorites node as the favorites list, and a favorite in its own area', async () => {
      const { navigate } = await setup({ favorites: [{ kind: 'RECORD', uuid: 'rec-1', title: 'Yirgacheffe', folderPath: '/content_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));

      fireEvent.click(row('Favorites'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'content'], { queryParams: { favorites: 1 } });
    });
  });

  describe('the empty states', () => {
    const empty = { folders: [{ ...FOLDERS[0], children: [] }], sets: [] };

    it('tells a developer without datasets to define one: primary action Go to Templates, Create a folder always', async () => {
      const { navigate } = await setup({ ...empty, datasets: [], dev: true, role: 'DEVELOPER' });
      expect(await screen.findByText('No datasets yet')).toBeTruthy();
      expect(screen.getByText(/defines datasets in Templates/)).toBeTruthy();

      expect(screen.getByRole('button', { name: 'Create a folder' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Go to Templates' }));
      expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'templates'], { queryParams: { kind: 'DATASET' } });
    });

    it('tells an editor to ask a developer, without a dead button', async () => {
      await setup({ ...empty, datasets: [] });
      expect(await screen.findByText(/Ask a developer/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Go to Templates' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Create a folder' })).toBeTruthy();
    });

    it('offers a first record set when datasets exist', async () => {
      await setup(empty);
      expect(await screen.findByText('No record sets yet')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'New record set' })).toBeTruthy();
    });

    it('offers nothing to a viewer but the explanation', async () => {
      await setup({ ...empty, role: 'VIEWER' });
      expect(await screen.findByText('No record sets yet')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'New record set' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create a folder' })).toBeNull();
    });

    it('does not show an empty state while the store is still being read, nor for a store with record sets', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(2));
      expect(screen.queryByText('No record sets yet')).toBeNull();
      expect(screen.getByTestId('folder-view')).toBeTruthy();
    });

    it('keeps the folder view, with its error state and retry, when the store could not be read', async () => {
      const { toasts } = await setup({ content: { folders: vi.fn().mockReturnValue(throwError(() => new Error('500'))) } });
      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(screen.getByTestId('folder-view')).toBeTruthy();
      expect(screen.queryByText('No record sets yet')).toBeNull();
    });
  });

  describe('creating', () => {
    it('creates a folder inline in the tree, from the New menu', async () => {
      const { content } = await setup();
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'New folder' }));

      const input = await waitFor(() => {
        const found = document.querySelector<HTMLInputElement>('.sf-tree__edit-input');
        expect(found).not.toBeNull();
        return found!;
      });
      fireEvent.input(input, { target: { value: 'Assets' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(content.createFolder).toHaveBeenCalledWith('proj', 'Assets', undefined));
    });

    it('creates a record set with the dataset chosen in the dialog, in the open folder, and opens it', async () => {
      const { content, navigate } = await setup({ inputs: { folder: 'team' } });
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'New record set' }));
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'New record set' })).toBeTruthy());

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Staff' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(content.createRecordSet).toHaveBeenCalledWith('proj', {
        folderUuid: 'team',
        datasetUuid: 'ds-team',
        uid: undefined,
        displayName: 'Staff',
      });
      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content', 'sets', 'set-new'], { queryParams: {} }));
    });

    it('creates a record set in the right-clicked folder from the tree menu', async () => {
      const { content, instance } = await setup();
      await waitFor(() => expect(names().length).toBe(2));

      instance.menuItems([node({ uuid: 'team', name: 'Team', kind: 'folder' })]).find((item) => item.label === 'New record set')!.action();
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'New record set' })).toBeTruthy());
      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Staff' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(content.createRecordSet).toHaveBeenCalledWith('proj', expect.objectContaining({ folderUuid: 'team', displayName: 'Staff' }));
    });

    it('says why a record set cannot be created while there is no dataset', async () => {
      await setup({ datasets: [], inputs: { folder: 'team' } });
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      expect(await screen.findByRole('menuitem', { name: 'New record set' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('keeps the New menu disabled for a viewer', async () => {
      await setup({ role: 'VIEWER' });
      expect(screen.getByRole('button', { name: /^New/ })).toBeDisabled();
    });

    it('keeps the New menu disabled in a read-only project (time travel, archived)', async () => {
      await setup({ readOnly: true });
      expect(screen.getByRole('button', { name: /^New/ })).toBeDisabled();
    });
  });

  describe('the one menu', () => {
    it("offers a record set's own entries and the star: new record, history, used by", async () => {
      const { instance } = await setup();

      const items = instance.menuItems([node({ uuid: 'set-leads', name: 'Leads' })]);

      expect(items.map((item) => item.label)).toEqual(['New record', 'History', 'Used by', 'Add “Leads” to favorites']);
    });

    it('opens the set view on its History and Used by panels, and with a new record', async () => {
      const { instance, navigate } = await setup();
      const items = instance.menuItems([node({ uuid: 'set-leads', name: 'Leads' })]);

      items.find((item) => item.label === 'History')!.action();
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'content', 'sets', 'set-leads'], { queryParams: { panel: 'history' } });
      items.find((item) => item.label === 'Used by')!.action();
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'content', 'sets', 'set-leads'], { queryParams: { panel: 'usages' } });
      items.find((item) => item.label === 'New record')!.action();
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'content', 'sets', 'set-leads'], { queryParams: { newRecord: '1' } });
    });

    it('offers a folder New record set (and the star)', async () => {
      const { instance } = await setup();
      const folder = node({ uuid: 'team', name: 'Team', kind: 'folder' });

      expect(instance.menuItems([folder]).map((item) => item.label)).toEqual(['New record set', 'Add “Team” to favorites']);
    });

    it('offers a viewer the star and the read-only entries only', async () => {
      const { instance } = await setup({ role: 'VIEWER' });
      expect(instance.menuItems([node({ uuid: 'set-leads', name: 'Leads' })]).map((item) => item.label)).toEqual(['History', 'Used by', 'Add “Leads” to favorites']);
    });

    it('adds and removes a favorite, but offers nothing on the Favorites branch', async () => {
      const { instance, favorites } = await setup();
      const toggle = TestBed.inject(FavoritesService).toggle as ReturnType<typeof vi.fn>;

      instance
        .menuItems([node({ uuid: 'team', name: 'Team', kind: 'folder', path: '/content_root/team/' })])
        .find((item) => item.label === 'Add “Team” to favorites')!
        .action();
      expect(toggle).toHaveBeenCalledWith({ type: 'FOLDER', uuid: 'team', displayName: 'Team', folderPath: '/content_root/team/' });

      instance
        .menuItems([node({ uuid: 'set-leads', name: 'Leads', path: '/content_root/team/' })])
        .find((item) => item.label === 'Add “Leads” to favorites')!
        .action();
      expect(toggle).toHaveBeenLastCalledWith({ type: 'RECORD_SET', uuid: 'set-leads', displayName: 'Leads', folderPath: '/content_root/team/' });

      favorites.set([{ uuid: 'team' }]);
      expect(instance.menuItems([{ id: 'fav:team', label: 'Team' }])).toEqual([]);
    });
  });

  describe('changes offer Undo (M35.13)', () => {
    it('renames a set and Undo renames it back with the revision the rename produced', async () => {
      const { api, instance, toasts } = await setup();

      instance.onRename({ node: node({ uuid: 'set-leads', name: 'Leads' }), name: 'Staff' });

      await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'set-leads', { displayName: 'Staff' }, undefined));
      expect(lastToast(toasts).message).toBe('Renamed “Leads” to “Staff”.');
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.renameAsset).toHaveBeenLastCalledWith('proj', 'set-leads', { displayName: 'Leads' }, 7));
    });

    it('renames a folder through the folder endpoint', async () => {
      const { api, instance } = await setup();
      instance.onRename({ node: node({ uuid: 'team', name: 'Team', kind: 'folder' }), name: 'People' });
      await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('proj', 'team', { displayName: 'People' }, undefined));
    });

    it('rejects a name that is taken among the siblings of its kind before asking the server', async () => {
      const { instance } = await setup();
      expect(instance.validateName('team', { mode: 'create', node: null, parent: null, kind: 'folder' })).toBe(
        'A folder or record set with this name already exists here.',
      );
      expect(instance.validateName('Products', { mode: 'rename', node: node({ uuid: 'set-x', name: 'X' }), parent: null, kind: null })).toBe(
        'A folder or record set with this name already exists here.',
      );
      expect(instance.validateName('People', { mode: 'create', node: null, parent: null, kind: 'folder' })).toBeNull();
    });

    it('deletes a set with its records and Undo restores it (and its records) from its last live revision', async () => {
      const { content, api, instance, toasts } = await setup();
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'set-leads', name: 'Leads', recordCount: 3 })], completed });

      await waitFor(() => expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-leads', true));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-leads', { fromRevision: 6 }));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Undone.'));
      await waitFor(() => expect(content.folders.mock.calls.length).toBeGreaterThanOrEqual(3));
    });

    it('deletes an empty set without cascading', async () => {
      const { content, instance } = await setup();
      instance.onDelete({ nodes: [node({ uuid: 'set-products', name: 'Products', recordCount: 0 })], completed: vi.fn() });
      await waitFor(() => expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-products', false));
    });

    it('deletes a folder with everything inside and Undo restores it with one call', async () => {
      const { api, instance } = await setup();
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'team', name: 'Team', kind: 'folder' })], completed });

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'team', true));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'team'));
    });

    it('goes up to the store root when the open folder was deleted', async () => {
      const { instance, navigate } = await setup({ inputs: { folder: 'team' } });
      await waitFor(() => expect(names()).toContain('Team'));

      instance.onDelete({ nodes: [node({ uuid: 'team', name: 'Team', kind: 'folder' })], completed: vi.fn() });

      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content'], { queryParams: {} }));
    });

    it('says so, and offers no Undo, when a delete fails', async () => {
      const { instance, toasts } = await setup({ content: { deleteRecordSet: vi.fn().mockReturnValue(throwError(() => new Error('500'))) } });
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'set-leads', name: 'Leads', recordCount: 3 })], completed });

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(completed).not.toHaveBeenCalled();
    });

    it('confirms a set delete naming its records, and asks for the typed word from 25 items on', async () => {
      const { instance, confirm } = await setup();

      await instance.confirmDelete([node({ uuid: 'set-leads', name: 'Leads', recordCount: 3 })]);
      expect(confirm.confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger', title: 'Delete “Leads”?' });
      expect(confirm.confirm.mock.calls[0][0].message).toContain('3 records');
      expect(confirm.confirm.mock.calls[0][0].typeToConfirm).toBeUndefined();

      await instance.confirmDelete([node({ uuid: 'set-big', name: 'Big', recordCount: 30 })]);
      expect(confirm.confirm.mock.calls[1][0].typeToConfirm).toBe('delete');

      await instance.confirmDelete(Array.from({ length: 25 }, (_, i) => node({ uuid: `s${i}`, name: `Set ${i}` })));
      expect(confirm.confirm.mock.calls[2][0].typeToConfirm).toBe('delete');
    });

    it('names what a folder delete takes along, and that a published set stays online', async () => {
      const { instance, confirm } = await setup();

      await instance.confirmDelete([node({ uuid: 'team', name: 'Team', kind: 'folder', release: { '': { status: 'PUBLISHED' } } as never })]);

      const options = confirm.confirm.mock.calls[0][0];
      expect(options.message).toContain('every record set and record inside it');
      expect(options.message).toContain('stay online');
    });

    it('moves a set into a folder (drag or paste) and Undo moves it back into the folder it came from', async () => {
      const { content, instance } = await setup();
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'set-leads', name: 'Leads' })], target: { id: 'root-x' }, copy: false, via: 'drag', completed });

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-leads', 'root-x'));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(content.moveAsset).toHaveBeenLastCalledWith('proj', 'set-leads', 'team'));
    });

    it('copies a set on paste with one duplicate per set, and Undo deletes the copies', async () => {
      const { api, instance } = await setup();
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'set-leads', name: 'Leads' })], target: { id: 'root-x' }, copy: true, via: 'paste', completed });

      await waitFor(() => expect(api.duplicateAsset).toHaveBeenCalledWith('proj', 'set-leads', 'root-x'));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'set-leads-copy'));
    });

    it('allows copying record sets only, never a folder', async () => {
      const { instance } = await setup();
      const allow = (instance as unknown as { allowAction: (a: string, n: unknown[]) => boolean }).allowAction;

      expect(allow('copy', [node({ uuid: 'set-leads', name: 'Leads' })])).toBe(true);
      expect(allow('copy', [node({ uuid: 'team', name: 'Team', kind: 'folder' })])).toBe(false);
      expect(allow('move', [node({ uuid: 'team', name: 'Team', kind: 'folder' })])).toBe(true);
    });

    it('moves a folder through the folder move, to the store root with no folder, and back', async () => {
      const { content, instance } = await setup();
      await waitFor(() => expect(names().length).toBe(2));
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'team', name: 'Team', kind: 'folder' })], target: null, copy: false, via: 'drag', completed });

      await waitFor(() => expect(content.moveFolder).toHaveBeenCalledWith('proj', 'team', undefined));
      expect(content.moveAsset).not.toHaveBeenCalled();
      await waitFor(() => expect(completed).toHaveBeenCalled());
    });

    it('says so when a move fails, and offers no Undo', async () => {
      const { instance, toasts } = await setup({ content: { moveAsset: vi.fn().mockReturnValue(throwError(() => new Error('422'))) } });
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'set-leads', name: 'Leads' })], target: { id: 'team' }, copy: false, via: 'drag', completed });

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(completed).not.toHaveBeenCalled();
    });

    it('a failing move-back shows the error toast', async () => {
      const { content, instance, toasts } = await setup();
      const completed = vi.fn();
      instance.onMove({ nodes: [node({ uuid: 'set-leads', name: 'Leads' })], target: { id: 'root-x' }, copy: false, via: 'drag', completed });
      await waitFor(() => expect(completed).toHaveBeenCalled());
      content.moveAsset.mockReturnValue(throwError(() => new Error('422')));

      completed.mock.calls[0][0]();

      await waitFor(() => expect(lastToast(toasts).message).toMatch(/Could not undo/));
    });
  });

  describe('Move to… (replaces the old dialog)', () => {
    it('picks among the folders only — never a record set — and moves with one Undo', async () => {
      const { content, instance, toasts } = await setup();
      await waitFor(() => expect(names().length).toBe(2));

      instance.openMoveDialog([node({ uuid: 'set-products', name: 'Products' })]);
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      const labels = within(dialog).getAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim());
      expect(labels).toEqual(['All content', 'Team']);

      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^Team/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-products', 'team'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Moved “Products”'));
      expect(lastToast(toasts).action).toBeDefined();
    });

    it('moves to the store root through the first entry', async () => {
      const { content, instance } = await setup();
      await waitFor(() => expect(names().length).toBe(2));

      instance.openMoveDialog([node({ uuid: 'set-leads', name: 'Leads' })]);
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).getAllByRole('treeitem').length).toBeGreaterThan(0));
      fireEvent.click(within(dialog).getByRole('treeitem', { name: /^All content/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move here' }));

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-leads', undefined));
    });
  });
});
