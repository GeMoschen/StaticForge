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
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { NavFolderViewComponent } from './nav-folder-view.component';
import { NavItemDetailComponent } from './nav-item-detail.component';
import { NavigationComponent } from './navigation.component';
import { type NavTreeView, NavigationService } from './navigation.service';

@Component({
  selector: 'sf-nav-folder-view',
  standalone: true,
  template: '<p data-testid="folder-view">{{ folder().label }}</p>',
})
class FolderViewStub {
  readonly projectKey = input.required<string>();
  readonly folder = input.required<{ label: string }>();
  readonly index = input<unknown>();
  readonly urls = input<unknown>();
  readonly loading = input(false);
  readonly failed = input(false);
  readonly openEntry = output<string>();
  readonly newItem = output<void>();
  readonly rename = output<string>();
  readonly moveEntries = output<unknown>();
  readonly deleteEntries = output<unknown>();
  readonly retry = output<void>();
  readonly changed = output<void>();
}

@Component({
  selector: 'sf-nav-item-detail',
  standalone: true,
  template: '<p data-testid="item-detail">{{ entry().label }}</p>',
})
class ItemDetailStub {
  readonly projectKey = input.required<string>();
  readonly entry = input.required<{ label: string }>();
  readonly urls = input<unknown>();
  readonly changed = output<void>();
  readonly move = output<void>();
  readonly remove = output<void>();
  readonly openPage = output<string>();
}

@Component({ selector: 'sf-favorites-view', standalone: true, template: '<p data-testid="favorites-view"></p>' })
class FavoritesViewStub {}

/** The menu as the API returns it: the "All Navigation" wrapper; its children in the stored order (not alphabetical). */
const FOREST: NavTreeView[] = [
  {
    uuid: 'root',
    uid: 'navigation_root',
    type: 'FOLDER',
    displayName: 'All Navigation',
    protectedFolder: true,
    revision: 9,
    children: [
      { uuid: 'n-home', uid: 'home', type: 'PAGE_REFERENCE', displayName: 'Home link', label: 'Home', resolvedPageUuid: 'p-home', resolvedPageName: 'Welcome', revision: 2, children: [] },
      {
        uuid: 'n-company',
        uid: 'company',
        type: 'FOLDER',
        displayName: 'Company',
        label: 'Company',
        resolvedPageUuid: 'p-about',
        resolvedPageName: 'About us',
        revision: 4,
        children: [
          { uuid: 'n-about', uid: 'about', type: 'PAGE_REFERENCE', displayName: 'About', label: 'About us', resolvedPageUuid: 'p-about', resolvedPageName: 'About us', revision: 1, children: [] },
          { uuid: 'n-team', uid: 'team', type: 'PAGE_REFERENCE', displayName: 'Team', label: 'Team', resolvedPageUuid: 'p-team', resolvedPageName: 'Our team', revision: 1, children: [] },
        ],
      },
      { uuid: 'n-blog', uid: 'blog', type: 'PAGE_REFERENCE', displayName: 'Blog', label: 'Blog', resolvedPageUuid: 'p-blog', resolvedPageName: 'News', revision: 1, children: [] },
    ],
  },
];

const URL_ROWS = {
  last: true,
  content: [
    { targetUuid: 'p-home', area: 'GENERATED', url: '/' },
    { targetUuid: 'p-about', area: 'GENERATED', url: '/about-us/' },
    { targetUuid: 'p-blog', area: 'GENERATED', url: '/blog/' },
  ],
};

interface SetupOptions {
  forest?: NavTreeView[];
  nav?: Record<string, unknown>;
  api?: Record<string, unknown>;
  role?: string;
  dev?: boolean;
  favorites?: unknown[];
  inputs?: Record<string, unknown>;
  confirm?: boolean;
  readOnly?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const nav = {
    tree: vi.fn().mockReturnValue(of(options.forest ?? FOREST)),
    pageUrlRows: vi.fn().mockReturnValue(of(URL_ROWS)),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'folder-new' })),
    createReference: vi.fn().mockReturnValue(of({ uuid: 'item-new' })),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 6 })),
    updateReference: vi.fn().mockReturnValue(of({ revision: 7 })),
    moveFolder: vi.fn().mockReturnValue(of({})),
    moveReference: vi.fn().mockReturnValue(of({})),
    deleteReference: vi.fn().mockReturnValue(of(undefined)),
    reorderChildren: vi.fn().mockReturnValue(of({ revision: 10 })),
    ...options.nav,
  };
  const api = {
    assetDetail: vi.fn().mockReturnValue(of({ revision: 5, payload: { target: { kind: 'PAGE', assetUuid: 'p-about' }, label: 'About us' } })),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 9, deleted: true }, { revision: 6, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    ...options.api,
  };
  const favorites = signal((options.favorites ?? []) as { uuid: string }[]);
  const favoritesApi = { list: favorites, isFavorite: (uuid: string) => favorites().some((f) => f.uuid === uuid), toggle: vi.fn(() => true), remove: vi.fn() };
  const confirm = { confirm: vi.fn().mockResolvedValue(options.confirm ?? true) };
  const role = options.role ?? 'EDITOR';
  const view = await render(NavigationComponent, {
    componentInputs: { projectKey: 'proj', ...options.inputs },
    providers: [
      provideRouter([]),
      { provide: NavigationService, useValue: nav },
      { provide: ApiClient, useValue: api },
      { provide: ConfirmService, useValue: confirm },
      { provide: AuthStore, useValue: { roleFor: () => role, isArchived: () => false } },
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
      { provide: FavoritesService, useValue: favoritesApi },
    ],
    configureTestBed: (tb) => {
      tb.overrideComponent(NavigationComponent, {
        remove: { imports: [NavFolderViewComponent, NavItemDetailComponent, FavoritesViewComponent] },
        add: { imports: [FolderViewStub, ItemDetailStub, FavoritesViewStub] },
      });
    },
  });
  const instance = view.fixture.componentInstance as unknown as {
    onReorder(request: unknown): void;
    onMove(request: unknown): void;
    onRename(request: unknown): void;
    onDelete(request: unknown): void;
    deleteEntries(entries: unknown[]): Promise<void>;
    openMoveDialog(entries: unknown[]): void;
    menuItems(nodes: unknown[]): { label: string; action: () => void }[];
    validateName(name: string, context: unknown): string | null;
  };
  const toasts = TestBed.inject(ToastService);
  const undo = TestBed.inject(UndoService);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, nav, api, favorites, favoritesApi, confirm, instance, toasts, undo, navigate };
}

/** Presses the Undo of the latest toast that offers one. */
const clickUndo = (toasts: ToastService) => {
  const action = [...toasts.toasts()].reverse().find((toast) => toast.action)?.action;
  expect(action).toBeTruthy();
  action!.run();
};

const row = (name: string) => screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const names = () => screen.queryAllByRole('treeitem').map((r) => r.querySelector('.sf-tree__name')?.textContent?.trim());
const node = (uuid: string, label: string, kind: 'folder' | 'item' = 'item') => ({
  id: uuid,
  label,
  data: { kind, uuid, label, displayName: label, uid: uuid, targetUuid: null, targetName: null, release: null, scheduled: false, revision: 1 },
});

describe('NavigationComponent (menu)', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('the tree', () => {
    it('shows the menu in the stored order, not alphabetically', async () => {
      await setup();
      await waitFor(() => expect(names()).toEqual(['Home', 'Company', 'Blog']));
    });

    it('says where an entry leads: the label, then "→ public URL" (from the URL registry)', async () => {
      await setup();
      await waitFor(() => expect(row('Home').textContent).toContain('→ /'));
      expect(row('Company').textContent).toContain('→ /about-us/');
      expect(row('Blog').textContent).toContain('→ /blog/');
      // Never the internal folder path.
      expect(row('Blog').textContent).not.toContain('pages_root');
    });

    it('names the target page while no URL is registered', async () => {
      await setup({ nav: { pageUrlRows: vi.fn().mockReturnValue(of({ last: true, content: [] })) } });
      await waitFor(() => expect(row('Blog').textContent).toContain('→ News'));
    });

    it('shows no UID beside the name outside developer mode', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(row('Blog').textContent).not.toContain('blog  ·');
    });

    it('shows the UID beside the name in developer mode', async () => {
      await setup({ dev: true });
      await waitFor(() => expect(row('Blog').textContent).toContain('→ /blog/  ·  blog'));
    });

    it('loads a folder\'s entries when it is opened, in menu order', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      row('Company').focus();
      fireEvent.focusIn(row('Company'));
      fireEvent.keyDown(row('Company'), { key: 'ArrowRight' });

      await screen.findByText('About us');
      expect(names()).toEqual(['Home', 'Company', 'About us', 'Team', 'Blog']);
    });

    it('filters over the whole menu, including folders that were never opened', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));

      fireEvent.input(screen.getByRole('searchbox', { name: /filter/i }), { target: { value: 'team' } });

      await waitFor(() => expect(names()).toContain('Team'), { timeout: 3000 });
    });

    it('has no Favorites node without favorites', async () => {
      await setup();
      await waitFor(() => expect(names().length).toBe(3));
      expect(names()).not.toContain('Favorites');
    });

    it('pins a Favorites node on top while there are favorites', async () => {
      await setup({ favorites: [{ kind: 'PAGE_REFERENCE', uuid: 'n-blog', title: 'Blog', folderPath: '/navigation_root/' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));
    });
  });

  describe('the selection is in the URL (?asset=)', () => {
    it('selects the open folder and shows its table', async () => {
      await setup({ inputs: { asset: 'n-company' } });
      await waitFor(() => expect(row('Company')).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getByTestId('folder-view')).toHaveTextContent('Company');
    });

    it('selects the open item and shows its detail', async () => {
      await setup({ inputs: { asset: 'n-blog' } });
      await waitFor(() => expect(row('Blog')).toHaveAttribute('aria-selected', 'true'));
      expect(screen.getByTestId('item-detail')).toHaveTextContent('Blog');
    });

    it('opens a row by putting its uuid in the URL', async () => {
      const { navigate } = await setup();
      await waitFor(() => expect(names().length).toBe(3));

      fireEvent.click(row('Blog'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'navigation'], { queryParams: { asset: 'n-blog' } });
      fireEvent.click(row('Company'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'navigation'], { queryParams: { asset: 'n-company' } });
    });

    it('opens the Favorites node as the favorites list', async () => {
      const { navigate } = await setup({ favorites: [{ kind: 'PAGE_REFERENCE', uuid: 'n-blog', title: 'Blog' }] });
      await waitFor(() => expect(names()[0]).toBe('Favorites'));
      fireEvent.click(row('Favorites'));
      expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'navigation'], { queryParams: { favorites: 1 } });
    });

    it('shows the Favorites list instead of a folder when asked for', async () => {
      await setup({ inputs: { favorites: '1' }, favorites: [{ kind: 'PAGE_REFERENCE', uuid: 'n-blog', title: 'Blog' }] });
      expect(await screen.findByTestId('favorites-view')).toBeTruthy();
      expect(screen.queryByTestId('item-detail')).toBeNull();
    });

    it('says "Select a menu item" when nothing (or something that is gone) is selected', async () => {
      await setup({ inputs: { asset: 'gone' } });
      expect(await screen.findByText('Select a menu item')).toBeTruthy();
      expect(screen.queryByText('Select a node')).toBeNull();
    });

    it('explains an empty menu and offers to add an item', async () => {
      await setup({ forest: [{ ...FOREST[0], children: [] }] });
      expect(await screen.findByText('No menu yet')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Menu item' })).toBeTruthy();
    });
  });

  describe('reordering siblings (decision 23)', () => {
    it('stores the new order of the folder on Alt+↓, with an Undo that writes the previous list', async () => {
      // The menu read again after the write carries the revision the write produced.
      const reread = [{ ...FOREST[0], revision: 10 }];
      const { nav, toasts } = await setup({ nav: { tree: vi.fn().mockReturnValueOnce(of(FOREST)).mockReturnValue(of(reread)) } });
      await waitFor(() => expect(names().length).toBe(3));

      row('Home').focus();
      fireEvent.focusIn(row('Home'));
      fireEvent.keyDown(row('Home'), { key: 'ArrowDown', altKey: true });

      await waitFor(() => expect(nav.reorderChildren).toHaveBeenCalledTimes(1));
      // The top level is the wrapper; the order is its children after the move, by uuid.
      expect(nav.reorderChildren).toHaveBeenCalledWith('proj', 'root', ['n-company', 'n-home', 'n-blog'], '"rev-9"');
      await waitFor(() => expect(nav.tree).toHaveBeenCalledTimes(2));

      // The toast offers Undo: it writes the list as it was and the menu is read again.
      clickUndo(toasts);
      await waitFor(() => expect(nav.reorderChildren).toHaveBeenCalledTimes(2));
      expect(nav.reorderChildren).toHaveBeenLastCalledWith('proj', 'root', ['n-home', 'n-company', 'n-blog'], '"rev-10"');
    });

    it('stores a drop before a row of another folder as a move there, then the order; Undo takes both back', async () => {
      const { nav, instance } = await setup();
      const completed = vi.fn();

      instance.onReorder({ node: node('n-blog', 'Blog'), parent: node('n-company', 'Company', 'folder'), index: 1, via: 'drag', completed });

      await waitFor(() => expect(completed).toHaveBeenCalled());
      expect(nav.moveReference).toHaveBeenCalledWith('proj', 'n-blog', 'n-company');
      expect(nav.reorderChildren).toHaveBeenCalledWith('proj', 'n-company', ['n-about', 'n-blog', 'n-team'], '"rev-4"');

      completed.mock.calls[0][0]();
      await waitFor(() => expect(nav.moveReference).toHaveBeenLastCalledWith('proj', 'n-blog', undefined));
      // The reorder is undone first (last step runs first), then the move.
      expect(nav.reorderChildren).toHaveBeenLastCalledWith('proj', 'n-company', ['n-about', 'n-team'], expect.any(String));
    });

    it('says so and reads the menu again when the write is refused (someone else changed the folder)', async () => {
      const { nav, instance, toasts } = await setup({ nav: { reorderChildren: vi.fn().mockReturnValue(throwError(() => new Error('409'))) } });
      const completed = vi.fn();

      instance.onReorder({ node: node('n-home', 'Home'), parent: null, index: 2, via: 'keyboard', completed });

      await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
      expect(toasts.toasts().at(-1)?.message).toContain('Could not reorder “Home”');
      expect(completed).not.toHaveBeenCalled();
      await waitFor(() => expect(nav.tree).toHaveBeenCalledTimes(2));
    });

    it('does nothing for a viewer', async () => {
      const { nav, instance } = await setup({ role: 'VIEWER' });
      instance.onReorder({ node: node('n-home', 'Home'), parent: null, index: 2, via: 'drag', completed: vi.fn() });
      expect(nav.reorderChildren).not.toHaveBeenCalled();
    });
  });

  describe('moving', () => {
    it('moves entries into a folder (a drop on it) with an Undo that moves them back where they were', async () => {
      const { nav, instance } = await setup();
      const completed = vi.fn();

      instance.onMove({ nodes: [node('n-home', 'Home')], target: node('n-company', 'Company', 'folder'), copy: false, via: 'drag', completed });

      await waitFor(() => expect(completed).toHaveBeenCalled());
      expect(nav.moveReference).toHaveBeenCalledWith('proj', 'n-home', 'n-company');
      completed.mock.calls[0][0]();
      await waitFor(() => expect(nav.moveReference).toHaveBeenLastCalledWith('proj', 'n-home', undefined));
    });

    it('reports a refused move and moves nothing else', async () => {
      const { instance, toasts } = await setup({ nav: { moveFolder: vi.fn().mockReturnValue(throwError(() => new Error('cycle'))) } });
      const completed = vi.fn();

      instance.onMove({ nodes: [node('n-company', 'Company', 'folder')], target: null, copy: false, via: 'drag', completed });

      await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
      expect(completed).not.toHaveBeenCalled();
    });

    it('opens the move dialog for the table\'s and the headers\' Move…', async () => {
      const { instance, fixture } = await setup();
      instance.openMoveDialog([node('n-home', 'Home').data]);
      fixture.detectChanges();
      expect(await screen.findByText('Move 1 item(s) to…')).toBeTruthy();
    });
  });

  describe('renaming and creating', () => {
    it('renames a folder with an Undo that renames it back against the revision the rename produced', async () => {
      const { nav, instance, toasts } = await setup();

      instance.onRename({ node: node('n-company', 'Company', 'folder'), name: 'Firm' });

      await waitFor(() => expect(nav.renameFolder).toHaveBeenCalledWith('proj', 'n-company', 'Firm', '"rev-1"'));
      await waitFor(() => expect(toasts.toasts().some((toast) => toast.action)).toBe(true));
      clickUndo(toasts);
      await waitFor(() => expect(nav.renameFolder).toHaveBeenLastCalledWith('proj', 'n-company', 'Company', '"rev-6"'));
    });

    it('renames an item by writing its label (the menu name), keeping the target', async () => {
      const { nav, instance, toasts } = await setup();

      instance.onRename({ node: node('n-about', 'About us'), name: 'Who we are' });

      await waitFor(() =>
        expect(nav.updateReference).toHaveBeenCalledWith('proj', 'n-about', { targetKind: 'PAGE', targetAssetUuid: 'p-about', label: 'Who we are' }, '"rev-5"', undefined),
      );
      await waitFor(() => expect(toasts.toasts().some((toast) => toast.action)).toBe(true));
      clickUndo(toasts);
      await waitFor(() =>
        expect(nav.updateReference).toHaveBeenLastCalledWith('proj', 'n-about', { targetKind: 'PAGE', targetAssetUuid: 'p-about', label: 'About us' }, '"rev-7"', undefined),
      );
    });

    it('refuses a name another folder or item here already has', async () => {
      const { instance } = await setup();
      expect(instance.validateName('team', { parent: node('n-company', 'Company', 'folder'), node: node('n-about', 'About us') })).toBeTruthy();
      expect(instance.validateName('Brand new', { parent: node('n-company', 'Company', 'folder'), node: node('n-about', 'About us') })).toBeNull();
    });
  });

  describe('deleting', () => {
    it('asks first (a folder takes its entries with it), deletes, selects the parent and offers one Undo that restores it', async () => {
      const { api, instance, confirm, navigate, toasts } = await setup({ inputs: { asset: 'n-about' } });
      await waitFor(() => expect(screen.getByTestId('item-detail')).toBeTruthy());

      await instance.deleteEntries([node('n-about', 'About us').data]);
      expect(confirm.confirm).toHaveBeenCalled();
      expect(confirm.confirm.mock.calls[0][0].tone).toBe('danger');
      // The open item went: the area goes up to its folder.
      await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(['/p', 'proj', 'navigation'], { queryParams: { asset: 'n-company' } }));

      await waitFor(() => expect(toasts.toasts().some((toast) => toast.action)).toBe(true));
      clickUndo(toasts);
      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'n-about', { fromRevision: 6 }));
    });

    it('does nothing when the question is answered No', async () => {
      const { nav, instance } = await setup({ confirm: false });
      await instance.deleteEntries([node('n-blog', 'Blog').data]);
      expect(nav.deleteReference).not.toHaveBeenCalled();
    });

    it('lets the tree ask and delete through the same actions, announcing the Undo', async () => {
      const { nav, instance } = await setup();
      const completed = vi.fn();
      instance.onDelete({ nodes: [node('n-blog', 'Blog')], completed });
      await waitFor(() => expect(completed).toHaveBeenCalled());
      expect(nav.deleteReference).toHaveBeenCalledWith('proj', 'n-blog');
      expect(typeof completed.mock.calls[0][0]).toBe('function');
    });
  });

  describe('favorites in the context menu', () => {
    it('offers Add to favorites, and a menu item\'s page', async () => {
      const { instance, favoritesApi } = await setup();
      const items = instance.menuItems([node('n-about', 'About us')]);
      items.find((i) => i.label.startsWith('Add'))!.action();
      expect(favoritesApi.toggle).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_REFERENCE', uuid: 'n-about', displayName: 'About us' }));
    });

    it('offers New menu item in a folder', async () => {
      const { instance } = await setup();
      const labels = instance.menuItems([node('n-company', 'Company', 'folder')]).map((i) => i.label);
      expect(labels).toContain('New menu item');
    });
  });

  describe('read-only', () => {
    it('disables creating for a viewer and hides the reorder hint', async () => {
      await setup({ role: 'VIEWER' });
      await waitFor(() => expect(names().length).toBe(3));
      expect(screen.getByText('New').closest('button')).toBeDisabled();
      expect(screen.queryByText(/Drag to reorder/)).toBeNull();
    });
  });

  it('shows the reorder hint for editors', async () => {
    await setup();
    expect(await screen.findByText(/Drag to reorder, or press Alt/)).toBeTruthy();
    expect(within(document.body).queryByText('Select a node')).toBeNull();
  });
});
