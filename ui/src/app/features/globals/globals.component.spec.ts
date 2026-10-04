import '@angular/compiler';
import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { GlobalSetDetailComponent, type DeletedGlobalSet } from './global-set-detail.component';
import { GlobalsComponent } from './globals.component';
import type { GlobalEntry } from './globals-tree.util';
import { GlobalsService } from './globals.service';

@Component({
  selector: 'sf-global-set-detail',
  standalone: true,
  template: '<p data-testid="detail">{{ uuid() }}|{{ tab() }}</p>',
})
class DetailStub {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  readonly tab = input<string | undefined>(undefined);
  readonly changed = output<void>();
  readonly tabChange = output<'values' | 'schema'>();
  readonly deleted = output<DeletedGlobalSet>();
}

@Component({ selector: 'sf-favorites-view', standalone: true, template: '<p data-testid="favorites-view"></p>' })
class FavoritesViewStub {}

const FOLDERS = [
  {
    uuid: 'root',
    uid: 'globals_root',
    displayName: 'All Globals',
    path: '/globals_root/',
    protectedFolder: true,
    children: [
      { uuid: 'brand', uid: 'brand', displayName: 'Brand', path: '/globals_root/brand/', children: [] },
      { uuid: 'legal', uid: 'legal', displayName: 'Legal', path: '/globals_root/legal/', children: [] },
    ],
  },
];
const SETS = [
  { uuid: 'set-site', uid: 'site', displayName: 'Site settings', folderPath: '/globals_root/brand/', revision: 4, release: { '': { status: 'CHANGED' } } },
  { uuid: 'set-shop', uid: 'shop', displayName: 'Shop settings', folderPath: '/globals_root/', revision: 2 },
];

interface SetupOptions {
  folders?: unknown[];
  sets?: unknown[];
  globals?: Record<string, unknown>;
  api?: Record<string, unknown>;
  role?: string;
  dev?: boolean;
  favorites?: unknown[];
  inputs?: Record<string, unknown>;
  confirm?: boolean;
  readOnly?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const globals = {
    folders: vi.fn().mockReturnValue(of(options.folders ?? FOLDERS)),
    list: vi.fn().mockReturnValue(of(options.sets ?? SETS)),
    create: vi.fn().mockReturnValue(of({ uuid: 'set-new' })),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'folder-new' })),
    moveSet: vi.fn().mockReturnValue(of({})),
    moveFolder: vi.fn().mockReturnValue(of({})),
    delete: vi.fn().mockReturnValue(of(undefined)),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    ...options.globals,
  };
  const api = {
    renameFolder: vi.fn().mockReturnValue(of({ revision: 6 })),
    renameAsset: vi.fn().mockReturnValue(of({ revision: 7 })),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 9, deleted: true }, { revision: 4, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    ...options.api,
  };
  const favorites = signal((options.favorites ?? []) as { uuid: string }[]);
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  const role = options.role ?? 'DEVELOPER';
  const view = await render(GlobalsComponent, {
    componentInputs: { projectKey: 'proj', ...options.inputs },
    providers: [
      provideRouter([]),
      { provide: GlobalsService, useValue: globals },
      { provide: ApiClient, useValue: api },
      { provide: ConfirmService, useValue: confirm },
      { provide: TimeTravelStore, useValue: new TimeTravelStore() },
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
      tb.overrideComponent(GlobalsComponent, {
        remove: { imports: [GlobalSetDetailComponent, FavoritesViewComponent] },
        add: { imports: [DetailStub, FavoritesViewStub] },
      });
    },
  });
  const instance = view.fixture.componentInstance as unknown as {
    onMove(request: unknown): void;
    onDelete(request: unknown): void;
    onRename(request: unknown): void;
    onSetDeleted(deleted: DeletedGlobalSet): void;
    onTabChange(tab: string): void;
    openMoveDialog(nodes: unknown[]): void;
    menuItems(nodes: unknown[]): { label: string; action: () => void }[];
    confirmDelete(nodes: unknown[]): Promise<boolean>;
    validateName(name: string, context: unknown): string | null;
  };
  const toasts = TestBed.inject(ToastService);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, globals, api, favorites, confirm, instance, toasts, navigate };
}

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const names = () => screen.queryAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim());
const lastToast = (toasts: ToastService) => toasts.toasts().at(-1)!;

const entry = (data: Partial<GlobalEntry> & { uuid: string; name: string }): GlobalEntry => ({
  kind: 'set',
  uid: '',
  path: '/globals_root/',
  release: null,
  scheduled: false,
  revision: null,
  ...data,
});
const node = (data: Partial<GlobalEntry> & { uuid: string; name: string }) => ({ id: data.uuid, label: data.name, data: entry(data) });

describe('GlobalsComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('the tree', () => {
    it('shows folders and global sets in one tree, loading a folder when it is opened', async () => {
      await setup();
      await waitFor(() => expect(names()).toEqual(['Brand', 'Legal', 'Shop settings']));
      expect(screen.queryByText('Site settings')).toBeNull();

      row('Brand').focus();
      fireEvent.focusIn(row('Brand'));
      fireEvent.keyDown(row('Brand'), { key: 'ArrowRight' });

      expect(await screen.findByText('Site settings')).toBeTruthy();
      expect(within(row('Site settings')).getByText('Changed')).toBeTruthy();
    });

    it('has a filter that searches the whole store, including folders that were never opened', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));

      fireEvent.input(screen.getByRole('searchbox', { name: /filter/i }), { target: { value: 'site' } });

      await waitFor(() => expect(names()).toContain('Site settings'), { timeout: 3000 });
    });

    it('shows the UID beside the name only in developer mode', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(screen.queryByText('shop')).toBeNull();
    });

    it('shows the UID in developer mode', async () => {
      await setup({ dev: true });
      expect(await screen.findByText('shop')).toBeTruthy();
    });

    it('pins a Favorites node on top only while there are favorites', async () => {
      await setup({ favorites: [{ kind: 'GLOBAL_SET', uuid: 'set-shop', title: 'Shop settings', folderPath: '/globals_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));
    });

    it('has no Favorites node without favorites', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(names()).not.toContain('Favorites');
    });
  });

  describe('selection in the URL', () => {
    it('opens the set named by ?asset= in the detail, with the tab from ?gtab=', async () => {
      await setup({ inputs: { asset: 'set-shop', gtab: 'schema' } });

      expect(await screen.findByTestId('detail')).toHaveTextContent('set-shop|schema');
      await waitFor(() => expect(row('Shop settings')).toHaveAttribute('aria-selected', 'true'));
    });

    it('reveals a set inside a folder and selects it', async () => {
      await setup({ inputs: { asset: 'set-site' } });

      expect(await screen.findByTestId('detail')).toHaveTextContent('set-site');
      await waitFor(() => expect(row('Site settings')).toHaveAttribute('aria-selected', 'true'));
    });

    it('shows a folder as its own pane, with its name as the heading', async () => {
      await setup({ inputs: { asset: 'brand' } });

      expect(await screen.findByRole('heading', { level: 1, name: 'Brand' })).toBeTruthy();
      expect(screen.queryByTestId('detail')).toBeNull();
      await waitFor(() => expect(row('Brand')).toHaveAttribute('aria-selected', 'true'));
    });

    it('shows the Favorites list for ?favorites=1', async () => {
      await setup({ inputs: { favorites: '1' }, favorites: [{ kind: 'GLOBAL_SET', uuid: 'set-shop', title: 'Shop settings' }] });

      expect(await screen.findByTestId('favorites-view')).toBeTruthy();
    });

    it('asks to select a set when nothing is open, with a heading', async () => {
      await setup();

      expect(await screen.findByText('Select a global set')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: 'Globals' })).toBeTruthy();
    });

    it('opens a set or folder by navigating to its ?asset= — the route guard asks about unsaved edits', async () => {
      const { navigate } = await setup();
      await waitFor(() => expect(names().length).toBe(3));

      fireEvent.click(row('Shop settings'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'globals'], { queryParams: { asset: 'set-shop' } });

      fireEvent.click(row('Legal'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'globals'], { queryParams: { asset: 'legal' } });
    });

    it('opens the Favorites node as the favorites list, and a favorite in its own area', async () => {
      const { navigate } = await setup({ favorites: [{ kind: 'PAGE', uuid: 'page-1', title: 'About', folderPath: '/pages_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));

      fireEvent.click(row('Favorites'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'globals'], { queryParams: { favorites: 1 } });
    });

    it('keeps the tab in the URL, replacing the entry', async () => {
      const { instance, navigate } = await setup({ inputs: { asset: 'set-shop' } });

      instance.onTabChange('schema');
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'globals'], { queryParams: { asset: 'set-shop', gtab: 'schema' }, replaceUrl: true });
      instance.onTabChange('values');
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'globals'], { queryParams: { asset: 'set-shop' }, replaceUrl: true });
    });
  });

  describe('the empty states', () => {
    const empty = { folders: [{ ...FOLDERS[0], children: [] }], sets: [] };

    it('invites a developer to create the first set or a folder', async () => {
      await setup(empty);
      expect(await screen.findByText('No global sets yet')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'New global set' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Create a folder' })).toBeTruthy();
    });

    it('tells an editor to ask a developer, without a dead button', async () => {
      await setup({ ...empty, role: 'EDITOR' });
      expect(await screen.findByText(/Ask a developer/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'New global set' })).toBeNull();
    });
  });

  describe('creating', () => {
    it('creates a folder inline in the tree, from the New menu', async () => {
      const { globals } = await setup();
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'New folder' }));

      const input = await waitFor(() => {
        const found = document.querySelector<HTMLInputElement>('.sf-tree__edit-input');
        expect(found).not.toBeNull();
        return found!;
      });
      fireEvent.input(input, { target: { value: 'Assets' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(globals.createFolder).toHaveBeenCalledWith('proj', 'Assets', undefined));
    });

    it('creates a global set in the open folder with a starter field, and opens it', async () => {
      const { globals, navigate } = await setup({ inputs: { asset: 'brand' } });
      fireEvent.click(screen.getByRole('button', { name: /^New/ }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'New global set' }));
      await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

      fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Legal notice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(globals.create).toHaveBeenCalledWith('proj', expect.objectContaining({ parentFolderUuid: 'brand', displayName: 'Legal notice' }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'globals'], { queryParams: { asset: 'set-new' } }));
    });

    it('keeps the New menu disabled for an editor and in a read-only project', async () => {
      await setup({ role: 'EDITOR' });
      expect(screen.getByRole('button', { name: /^New/ })).toBeDisabled();
    });

    it('keeps the New menu disabled in time travel or an archived project', async () => {
      await setup({ readOnly: true });
      expect(screen.getByRole('button', { name: /^New/ })).toBeDisabled();
    });
  });

  describe('the context menu', () => {
    it('offers a folder New global set and the favorite star', async () => {
      const { instance } = await setup();

      expect(instance.menuItems([node({ uuid: 'brand', name: 'Brand', kind: 'folder' })]).map((item) => item.label)).toEqual([
        'New global set',
        'Add “Brand” to favorites',
      ]);
    });

    it('offers an editor only the star', async () => {
      const { instance } = await setup({ role: 'EDITOR' });

      expect(instance.menuItems([node({ uuid: 'set-shop', name: 'Shop settings' })]).map((item) => item.label)).toEqual(['Add “Shop settings” to favorites']);
    });

    it('adds a global set to the favorites with a toast', async () => {
      const { instance, toasts } = await setup();
      const toggle = TestBed.inject(FavoritesService).toggle as ReturnType<typeof vi.fn>;

      instance.menuItems([node({ uuid: 'set-shop', name: 'Shop settings', path: '/globals_root/' })])[0].action();

      expect(toggle).toHaveBeenCalledWith({ type: 'GLOBAL_SET', uuid: 'set-shop', displayName: 'Shop settings', folderPath: '/globals_root/' });
      expect(lastToast(toasts).message).toContain('added to your favorites');
    });

    it('stores a folder as a FOLDER favorite', async () => {
      const { instance } = await setup();
      const toggle = TestBed.inject(FavoritesService).toggle as ReturnType<typeof vi.fn>;

      instance.menuItems([node({ uuid: 'brand', name: 'Brand', kind: 'folder', path: '/globals_root/brand/' })])[1].action();

      expect(toggle).toHaveBeenCalledWith({ type: 'FOLDER', uuid: 'brand', displayName: 'Brand', folderPath: '/globals_root/brand/' });
    });

    it('offers nothing on the Favorites branch', async () => {
      const { instance } = await setup();
      expect(instance.menuItems([{ id: 'fav:abc', label: 'Shop', data: entry({ uuid: 'set-shop', name: 'Shop' }) }])).toEqual([]);
    });

    it('rejects a name another folder or set of its kind already has', async () => {
      const { instance } = await setup();
      await waitFor(() => expect(names().length).toBe(3));

      expect(instance.validateName('legal', { parent: null, node: null })).toBe('A folder or global set with this name already exists here.');
      expect(instance.validateName('Fresh', { parent: null, node: null })).toBeNull();
    });
  });

  describe('delete and undo', () => {
    it('asks first, naming what is lost, with a danger confirm', async () => {
      const { instance, confirm } = await setup();

      await instance.confirmDelete([node({ uuid: 'brand', name: 'Brand', kind: 'folder' })]);

      expect(confirm.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'danger', message: expect.stringContaining('every global set inside it') }),
      );
    });

    it('deletes a set through its own endpoint and an Undo restores it from its last live revision', async () => {
      const { instance, globals, api } = await setup();
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'set-shop', name: 'Shop settings' })], completed });
      await waitFor(() => expect(completed).toHaveBeenCalled());
      expect(globals.delete).toHaveBeenCalledWith('proj', 'set-shop');

      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-shop', { fromRevision: 4 }));
    });

    it('deletes a folder with everything inside and an Undo restores the subtree', async () => {
      const { instance, globals, api } = await setup();
      const completed = vi.fn();

      instance.onDelete({ nodes: [node({ uuid: 'brand', name: 'Brand', kind: 'folder' })], completed });
      await waitFor(() => expect(completed).toHaveBeenCalled());
      expect(globals.deleteFolder).toHaveBeenCalledWith('proj', 'brand', true);

      completed.mock.calls[0][0]();
      await waitFor(() => expect(api.restoreFolder).toHaveBeenCalledWith('proj', 'brand'));
    });

    it('closes the open set when it was deleted from the tree', async () => {
      const { instance, navigate } = await setup({ inputs: { asset: 'set-shop' } });
      await screen.findByTestId('detail');

      instance.onDelete({ nodes: [node({ uuid: 'set-shop', name: 'Shop settings' })], completed: vi.fn() });

      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'globals'], { queryParams: {} }));
    });

    it('says what could not be deleted and stops', async () => {
      const { instance, toasts } = await setup({ globals: { delete: vi.fn().mockReturnValue(throwError(() => new Error('409'))) } });

      instance.onDelete({ nodes: [node({ uuid: 'set-shop', name: 'Shop settings' })], completed: vi.fn() });

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
      expect(lastToast(toasts).message).toContain('Shop settings');
    });

    it('a set deleted in the detail closes it and offers Undo, which restores it and reloads', async () => {
      const { instance, globals, api, toasts, navigate } = await setup({ inputs: { asset: 'set-shop' } });
      await screen.findByTestId('detail');
      const loads = globals.list.mock.calls.length;

      instance.onSetDeleted({ uuid: 'set-shop', name: 'Shop settings', online: false });
      expect(lastToast(toasts).message).toBe('Deleted “Shop settings”.');
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'globals'], { queryParams: {} });

      lastToast(toasts).action!.run();

      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-shop', { fromRevision: 4 }));
      await waitFor(() => expect(globals.list.mock.calls.length).toBeGreaterThan(loads));
    });

    it('mentions that a released set stays online until the deletion is released', async () => {
      const { instance, toasts } = await setup();

      instance.onSetDeleted({ uuid: 'set-shop', name: 'Shop settings', online: true });

      expect(lastToast(toasts).message).toBe('Deleted “Shop settings”. It stays online until you release the deletion.');
    });
  });

  describe('rename and move', () => {
    it('renames a set through the asset endpoint and Undo renames it back', async () => {
      const { instance, api, toasts } = await setup();

      instance.onRename({ node: node({ uuid: 'set-shop', name: 'Shop settings' }), name: 'Shop' });
      await waitFor(() => expect(api.renameAsset).toHaveBeenCalledWith('proj', 'set-shop', { displayName: 'Shop' }, undefined));

      lastToast(toasts).action!.run();
      await waitFor(() => expect(api.renameAsset).toHaveBeenLastCalledWith('proj', 'set-shop', { displayName: 'Shop settings' }, 7));
    });

    it('renames a folder through the folder endpoint', async () => {
      const { instance, api } = await setup();

      instance.onRename({ node: node({ uuid: 'brand', name: 'Brand', kind: 'folder' }), name: 'Identity' });

      await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith('proj', 'brand', { displayName: 'Identity' }, undefined));
    });

    it('moves a set into a folder, and Undo moves it back to where it came from', async () => {
      const { instance, globals } = await setup({ inputs: {} });
      await waitFor(() => expect(names().length).toBe(3));
      // Site settings lives in Brand: load it into the index first.
      const completed = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'set-site', name: 'Site settings' })], target: node({ uuid: 'legal', name: 'Legal', kind: 'folder' }), completed });
      await waitFor(() => expect(completed).toHaveBeenCalled());
      expect(globals.moveSet).toHaveBeenCalledWith('proj', 'set-site', 'legal');

      completed.mock.calls[0][0]();
      await waitFor(() => expect(globals.moveSet).toHaveBeenLastCalledWith('proj', 'set-site', 'brand'));
    });

    it('a set that lived at the top is moved back to the root, a folder through the folder endpoint', async () => {
      const { instance, globals } = await setup();
      await waitFor(() => expect(names().length).toBe(3));
      const first = vi.fn();
      const second = vi.fn();

      instance.onMove({ nodes: [node({ uuid: 'set-shop', name: 'Shop settings' })], target: node({ uuid: 'legal', name: 'Legal', kind: 'folder' }), completed: first });
      await waitFor(() => expect(first).toHaveBeenCalled());
      first.mock.calls[0][0]();
      await waitFor(() => expect(globals.moveSet).toHaveBeenLastCalledWith('proj', 'set-shop', undefined));

      instance.onMove({ nodes: [node({ uuid: 'brand', name: 'Brand', kind: 'folder' })], target: node({ uuid: 'legal', name: 'Legal', kind: 'folder' }), completed: second });
      await waitFor(() => expect(globals.moveFolder).toHaveBeenCalledWith('proj', 'brand', 'legal'));
    });

    it('says so when a move fails', async () => {
      const { instance, toasts } = await setup({ globals: { moveSet: vi.fn().mockReturnValue(throwError(() => new Error('422'))) } });
      await waitFor(() => expect(names().length).toBe(3));

      instance.onMove({ nodes: [node({ uuid: 'set-shop', name: 'Shop settings' })], target: node({ uuid: 'legal', name: 'Legal', kind: 'folder' }), completed: vi.fn() });

      await waitFor(() => expect(lastToast(toasts).kind).toBe('error'));
    });
  });
});
