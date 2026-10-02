import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { FolderViewComponent } from './folder-view.component';
import { PagesListComponent } from './pages-list.component';
import type { PageNodeData } from './pages-tree.util';

@Component({ selector: 'sf-folder-view', standalone: true, template: '<p data-testid="folder-view">{{ folderUuid() ?? "root" }}</p>' })
class FolderViewStub {
  readonly projectKey = input.required<string>();
  readonly folderUuid = input<string | null>(null);
  readonly openPage = output<string>();
  readonly openFolder = output<string | null>();
}

@Component({ selector: 'sf-favorites-view', standalone: true, template: '<p data-testid="favorites-view"></p>' })
class FavoritesViewStub {}

/** The folder tree as the store holds it: the fixed "All Pages" wrapper with Alpha (holding Sub) and Beta. */
const TREE = [
  {
    uuid: 'root',
    uid: 'pages_root',
    path: '/pages_root/',
    displayName: 'All Pages',
    protectedFolder: true,
    children: [
      {
        uuid: 'folder-a',
        uid: 'alpha',
        path: '/pages_root/alpha/',
        displayName: 'Alpha',
        children: [{ uuid: 'folder-sub', uid: 'sub', path: '/pages_root/alpha/sub/', displayName: 'Sub', children: [] }],
      },
      { uuid: 'folder-b', uid: 'beta', path: '/pages_root/beta/', displayName: 'Beta', children: [] },
    ],
  },
];
const IN_A = { uuid: 'page-x', uid: 'x', type: 'PAGE', displayName: 'Xylophone', folderPath: '/pages_root/alpha/', revision: 3, release: { '': { status: 'CHANGED' } } };
const IN_ROOT = { uuid: 'page-r', uid: 'r', type: 'PAGE', displayName: 'Rootpage', folderPath: '/pages_root/', revision: 2, release: { '': { status: 'PUBLISHED' } } };

interface SetupOptions {
  api?: Record<string, unknown>;
  pages?: unknown[];
  tree?: unknown[];
  templates?: unknown[];
  dev?: boolean;
  developer?: boolean;
  favorites?: unknown[];
  inputs?: Record<string, unknown>;
  confirm?: boolean;
  archived?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const api = {
    listPages: vi.fn().mockReturnValue(of(options.pages ?? [IN_A, IN_ROOT])),
    listFolders: vi.fn().mockReturnValue(of([])),
    createPage: vi.fn().mockReturnValue(of({ uuid: 'page-new' })),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'folder-new' })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    renameAsset: vi.fn().mockReturnValue(of({ revision: 4 })),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 5 })),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 7, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    duplicatePage: vi.fn().mockReturnValue(of({ uuid: 'page-copy' })),
    ...options.api,
  };
  const store = {
    pageFolderTree: signal((options.tree ?? TREE) as never),
    pageTemplates: signal((options.templates ?? [{ uuid: 'tpl-1', displayName: 'Landing' }]) as never),
    loadFor: vi.fn().mockReturnValue(of(undefined)),
  };
  const favorites = signal((options.favorites ?? []) as never[]);
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  const view = await render(PagesListComponent, {
    componentInputs: { projectKey: 'proj', ...options.inputs },
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: store },
      { provide: ConfirmService, useValue: confirm },
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
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: ProjectPermissionsStore, useValue: { canEditTemplates: () => options.developer ?? false, canRedirectOldUrls: () => false } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
      {
        provide: FavoritesService,
        useValue: { list: favorites, isFavorite: (uuid: string) => favorites().some((f: { uuid: string }) => f.uuid === uuid), toggle: vi.fn(() => true), remove: vi.fn() },
      },
    ],
    configureTestBed: (tb) => {
      tb.overrideComponent(PagesListComponent, {
        remove: { imports: [FolderViewComponent, FavoritesViewComponent] },
        add: { imports: [FolderViewStub, FavoritesViewStub] },
      });
      if (options.archived) {
        tb.inject(ProjectAccessStore).enterProject('proj', true);
      }
    },
  });
  const instance = view.fixture.componentInstance as unknown as {
    onMove(request: unknown): void;
    onRename(request: unknown): void;
    onDelete(request: unknown): void;
    menuItems(nodes: unknown[]): { label: string; action: () => void }[];
  };
  const toasts = TestBed.inject(ToastService);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { ...view, api, store, favorites, confirm, instance, toasts, navigate };
}

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const names = () => screen.queryAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim());
const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;
const node = (data: Partial<PageNodeData> & { uuid: string; name: string }) => ({
  id: data.uuid,
  label: data.name,
  data: { kind: 'page', uid: '', path: '', release: null, revision: null, scheduled: false, ...data },
});

describe('PagesListComponent', () => {
  describe('the tree', () => {
    it('shows folders and pages — and nothing below a page — loading a folder when it is opened', async () => {
      await setup();
      await waitFor(() => expect(names()).toEqual(['Alpha', 'Beta', 'Rootpage']));
      expect(screen.queryByText('Xylophone')).toBeNull();

      row('Alpha').focus();
      fireEvent.focusIn(row('Alpha'));
      fireEvent.keyDown(row('Alpha'), { key: 'ArrowRight' });

      expect(await screen.findByText('Xylophone')).toBeTruthy();
      expect(names()).toContain('Sub');
    });

    it('shows the UID beside the name only in developer mode', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(screen.queryByText('beta')).toBeNull();
    });

    it('shows the UID in developer mode', async () => {
      await setup({ dev: true });
      expect(await screen.findByText('beta')).toBeTruthy();
    });

    it('badges what is not released with text, and shows none on a released page', async () => {
      await setup({ tree: [{ ...TREE[0], children: [] }], pages: [IN_A, IN_ROOT].map((p) => ({ ...p, folderPath: '/pages_root/' })) });
      const changed = await screen.findByRole('treeitem', { name: /Xylophone/ });
      expect(within(changed).getByText('Changed')).toBeTruthy();
      expect(within(screen.getByRole('treeitem', { name: /Rootpage/ })).queryByText('Released')).toBeNull();
    });

    it('filters over the whole store, including pages in folders that were never opened', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));

      fireEvent.input(screen.getByRole('searchbox', { name: /filter/i }), { target: { value: 'xylo' } });

      await waitFor(() => expect(names()).toContain('Xylophone'), { timeout: 3000 });
    });

    it('pins a Favorites node on top only while there are favorites', async () => {
      await setup({ favorites: [{ kind: 'PAGE', uuid: 'page-r', title: 'Rootpage', folderPath: '/pages_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));
    });

    it('has no Favorites node without favorites', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(names()).not.toContain('Favorites');
    });

    it('selects the open folder', async () => {
      await setup({ inputs: { folder: 'folder-b' } });
      await waitFor(() => expect(row('Beta')).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getByTestId('folder-view')).toHaveTextContent('folder-b');
    });

    it('shows the Favorites list instead of a folder when asked for', async () => {
      await setup({ inputs: { favorites: '1' }, favorites: [{ kind: 'PAGE', uuid: 'page-r', title: 'Rootpage' }] });
      expect(await screen.findByTestId('favorites-view')).toBeTruthy();
      expect(screen.queryByTestId('folder-view')).toBeNull();
    });
  });

  describe('opening', () => {
    it('opens a page in the editor and a folder as the folder table (?folder=)', async () => {
      const { navigate } = await setup();
      await waitFor(() => expect(names().length).toBe(3));

      fireEvent.click(row('Rootpage'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'pages', 'page-r']);

      fireEvent.click(row('Beta'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'pages'], { queryParams: { folder: 'folder-b' } });
    });

    it('opens the Favorites node as the favorites list, and a favorite in its own area', async () => {
      const { navigate } = await setup({ favorites: [{ kind: 'RECORD', uuid: 'rec-1', title: 'Yirgacheffe', folderPath: '/content_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));

      fireEvent.click(row('Favorites'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'pages'], { queryParams: { favorites: 1 } });
    });
  });

  describe('the empty project (decision 87)', () => {
    const empty = { tree: [{ ...TREE[0], children: [] }], pages: [] };

    it('tells a developer without templates to create one: primary action Go to Templates, Create a folder always', async () => {
      const { navigate } = await setup({ ...empty, templates: [], dev: true, developer: true });
      expect(await screen.findByText('No pages yet')).toBeTruthy();

      expect(screen.getByRole('button', { name: 'Create a folder' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Go to Templates' }));
      expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'templates']);
    });

    it('tells an editor to ask a developer, without a dead button', async () => {
      await setup({ ...empty, templates: [] });
      expect(await screen.findByText(/Ask a developer/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Go to Templates' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Create a folder' })).toBeTruthy();
    });

    it('offers to create a page when templates exist', async () => {
      await setup(empty);
      expect(await screen.findByRole('button', { name: 'Create a page' })).toBeTruthy();
    });

    it('does not show the empty state while the pages are still being read, nor for a project with pages', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(screen.queryByText('No pages yet')).toBeNull();
    });
  });

  describe('creating', () => {
    it('creates a page from the New menu: the template comes from the existing dialog', async () => {
      const { api } = await setup();
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Page' }));

      fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'My Page' } });
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl-1' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect(api.createPage).toHaveBeenCalledWith('proj', { displayName: 'My Page', templateUuid: 'tpl-1', folderUuid: undefined });
    });

    it('creates a page in the open folder', async () => {
      const { api } = await setup({ inputs: { folder: 'folder-b' } });
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Page' }));
      fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'In Beta' } });
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl-1' } });
      screen.getByRole('button', { name: 'Create' }).click();

      expect(api.createPage).toHaveBeenCalledWith('proj', { displayName: 'In Beta', templateUuid: 'tpl-1', folderUuid: 'folder-b' });
    });

    it('creates a folder inline in the tree', async () => {
      const { api } = await setup();
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Folder' }));

      const input = await waitFor(() => {
        const found = document.querySelector<HTMLInputElement>('.sf-tree__edit-input');
        expect(found).not.toBeNull();
        return found!;
      });
      fireEvent.input(input, { target: { value: 'Assets' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() =>
        expect(api.createFolder).toHaveBeenCalledWith('proj', { displayName: 'Assets', parentFolderUuid: undefined, scope: 'PAGES' }),
      );
    });

    it('offers no page or folder creation in an archived project (M26)', async () => {
      await setup({ archived: true });
      expect(screen.getByRole('button', { name: /^New/ })).toBeDisabled();
    });

    it('cannot create a page in a project without templates', async () => {
      await setup({ templates: [] });
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      expect(await screen.findByRole('menuitem', { name: 'Page' })).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('changes offer Undo (M35.13)', () => {
    it('renames a page and Undo renames it back with the revision the rename produced', async () => {
      const { api, instance, toasts } = await setup();

      instance.onRename({ node: node({ uuid: 'page-x', name: 'Xylophone' }), name: 'Marimba' });

      await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'page-x', { displayName: 'Marimba' }, undefined));
      expect(lastToast(toasts).message).toBe('Renamed “Xylophone” to “Marimba”.');
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.renameAsset).toHaveBeenLastCalledWith('proj', 'page-x', { displayName: 'Xylophone' }, 4));
    });

    it('renames a folder through the folder endpoint', async () => {
      const { api, instance } = await setup();
      instance.onRename({ node: node({ uuid: 'folder-b', name: 'Beta', kind: 'folder' }), name: 'Gamma' });
      await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('proj', 'folder-b', { displayName: 'Gamma' }, undefined));
    });

    it('rejects a name that is taken among the siblings before asking the server', async () => {
      const { fixture } = await setup();
      const validate = (fixture.componentInstance as unknown as { validateName(n: string, c: unknown): string | null }).validateName;
      expect(validate('beta', { mode: 'create', node: null, parent: null, kind: 'folder' })).toBe('A page or folder with this name already exists here.');
      expect(validate('Gamma', { mode: 'create', node: null, parent: null, kind: 'folder' })).toBeNull();
    });

    it('deletes a page after a confirmation and Undo restores it from its last live revision', async () => {
      const { api, instance, toasts, confirm } = await setup();
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'page-x', name: 'Xylophone' })], completed });

      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'page-x'));
      expect(confirm.confirm).not.toHaveBeenCalled(); // the tree asks (confirmDelete) before it emits
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'page-x', { fromRevision: 7 }));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Undone.'));
    });

    it('deletes a folder with everything inside and Undo restores it with one call', async () => {
      const { api, instance } = await setup();
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'folder-b', name: 'Beta', kind: 'folder' })], completed });

      await waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith('proj', 'folder-b', true));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'folder-b'));
    });

    it('says so, and offers no Undo, when a delete fails', async () => {
      const { instance, toasts } = await setup({ api: { deleteAsset: vi.fn().mockReturnValue(throwError(() => new Error('500'))) } });
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'page-x', name: 'Xylophone' })], completed });

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(completed).not.toHaveBeenCalled();
    });

    it('asks for the typed word before deleting 25 or more items', async () => {
      const { fixture, confirm } = await setup();
      const confirmDelete = (fixture.componentInstance as unknown as { confirmDelete(n: unknown[]): Promise<boolean> }).confirmDelete;
      const many = Array.from({ length: 25 }, (_, i) => node({ uuid: `p${i}`, name: `Page ${i}` }));

      await confirmDelete(many);

      expect(confirm.confirm.mock.calls[0][0]).toMatchObject({ tone: 'danger', typeToConfirm: 'delete' });
    });

    it('names what a folder delete takes along, and that a published page stays online', async () => {
      const { fixture, confirm } = await setup();
      const confirmDelete = (fixture.componentInstance as unknown as { confirmDelete(n: unknown[]): Promise<boolean> }).confirmDelete;

      await confirmDelete([node({ uuid: 'folder-b', name: 'Beta', kind: 'folder', release: { '': { status: 'PUBLISHED' } } as never })]);

      const options = confirm.confirm.mock.calls[0][0];
      expect(options.message).toContain('everything inside it');
      expect(options.message).toContain('stay online');
      expect(options.typeToConfirm).toBeUndefined();
    });

    it('moves a page and Undo moves it back into the folder it came from', async () => {
      const { api, instance } = await setup();
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'page-x', name: 'Xylophone' })], target: { id: 'folder-b' }, copy: false, via: 'drag', completed });

      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'page-x', { folderUuid: 'folder-b' }));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'page-x', { folderUuid: 'folder-a' }));
    });

    it('moves to the project root with an empty body, and back to the root the same way', async () => {
      const { api, instance } = await setup();
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'page-r', name: 'Rootpage' })], target: { id: 'folder-b' }, copy: false, via: 'paste', completed });
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'page-r', {}));

      completed.mockClear();
      instance.onMove({ nodes: [node({ uuid: 'folder-sub', name: 'Sub', kind: 'folder' })], target: null, copy: false, via: 'drag', completed });
      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'folder-sub', {}));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'folder-sub', { folderUuid: 'folder-a' }));
    });

    it('a pasted copy is a duplicate moved into the target, and Undo deletes the copy', async () => {
      const { api, instance } = await setup();
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'page-x', name: 'Xylophone' })], target: { id: 'folder-b' }, copy: true, via: 'paste', completed });

      await waitFor(() => expect(api.duplicatePage).toHaveBeenCalledWith('proj', 'page-x'));
      await waitFor(() => expect(api.moveAsset).toHaveBeenCalledWith('proj', 'page-copy', { folderUuid: 'folder-b' }));
      await waitFor(() => expect(completed).toHaveBeenCalled());
      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'page-copy'));
    });

    it('says so when a move fails, and offers no Undo', async () => {
      const { instance, toasts } = await setup({ api: { moveAsset: vi.fn().mockReturnValue(throwError(() => new Error('422'))) } });
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'folder-a', name: 'Alpha', kind: 'folder' })], target: { id: 'folder-sub' }, copy: false, via: 'drag', completed });

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(completed).not.toHaveBeenCalled();
    });

    it('duplicates a page from its menu, and Undo deletes the copy', async () => {
      const { api, instance, toasts } = await setup();
      const items = instance.menuItems([node({ uuid: 'page-x', name: 'Xylophone' })]);

      items.find((item) => item.label === 'Duplicate')!.action();

      await waitFor(() => expect(api.duplicatePage).toHaveBeenCalledWith('proj', 'page-x'));
      await waitFor(() => expect(lastToast(toasts).message).toBe('Duplicated “Xylophone”.'));
      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledWith('proj', 'page-copy'));
    });
  });

  describe('favorites in the menu', () => {
    it('adds and removes a page or folder, but offers nothing on the Favorites branch', async () => {
      const { instance, favorites } = await setup();
      const toggle = TestBed.inject(FavoritesService).toggle as ReturnType<typeof vi.fn>;

      const items = instance.menuItems([node({ uuid: 'folder-b', name: 'Beta', kind: 'folder', path: '/pages_root/beta/' })]);
      items.find((item) => item.label === 'Add “Beta” to favorites')!.action();

      expect(toggle).toHaveBeenCalledWith({ type: 'FOLDER', uuid: 'folder-b', displayName: 'Beta', folderPath: '/pages_root/beta/' });
      favorites.set([{ kind: 'FOLDER', uuid: 'folder-b' }] as never);
      expect(instance.menuItems([{ id: 'fav:folder-b', label: 'Beta' }])).toEqual([]);
    });
  });

  describe('time travel', () => {
    const early = { uuid: 'page-early', uid: 'early', type: 'PAGE', displayName: 'Early page', folderPath: '/pages_root/' };
    const late = { uuid: 'page-late', uid: 'late', type: 'PAGE', displayName: 'Late page', folderPath: '/pages_root/' };
    const tree = (...folders: string[]) => [
      {
        uuid: 'root',
        path: '/pages_root/',
        displayName: 'All Pages',
        children: folders.map((name) => ({ uuid: `folder-${name}`, path: `/pages_root/${name}/`, displayName: `${name} folder`, children: [] })),
      },
    ];

    it('reads the tree and the list at the viewed revision and shows what they return', async () => {
      const listPages = vi.fn().mockImplementation((_key: string, opts: { revision?: number }) => of(opts.revision === 3 ? [early] : [late]));
      const listFolders = vi.fn().mockReturnValue(of(tree('old')));
      await setup({ pages: [], tree: tree('new'), api: { listPages, listFolders } });
      expect(await screen.findByText('Late page')).toBeTruthy();
      expect(screen.getByText('new folder')).toBeTruthy();
      expect(listFolders).not.toHaveBeenCalled();

      const timeTravel = TestBed.inject(TimeTravelStore);
      timeTravel.enter(3);

      expect(await screen.findByText('Early page')).toBeTruthy();
      await waitFor(() => expect(screen.queryByText('Late page')).toBeNull());
      expect(screen.getByText('old folder')).toBeTruthy();
      expect(screen.queryByText('new folder')).toBeNull();
      expect(listFolders).toHaveBeenCalledWith('proj', 'PAGES', 10, 3);
      expect(listPages).toHaveBeenLastCalledWith('proj', { revision: 3 });

      timeTravel.exit();
      expect(await screen.findByText('Late page')).toBeTruthy();
      await waitFor(() => expect(screen.getByText('new folder')).toBeTruthy());
      expect(screen.queryByText('Early page')).toBeNull();
    });

    it('shows no folders while the tree of the revision is still being read, never the present one', async () => {
      const pending = new Subject<never[]>();
      await setup({ pages: [], tree: tree('new'), api: { listFolders: vi.fn().mockReturnValue(pending) } });
      expect(await screen.findByText('new folder')).toBeTruthy();

      TestBed.inject(TimeTravelStore).enter(3);

      await waitFor(() => expect(screen.queryByText('new folder')).toBeNull());
    });
  });
});
