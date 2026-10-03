import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { MEDIA_TREE, PRODUCTS, pageOf, productFiles, projectStub, summary } from './media-library.testing';
import { MediaLibraryStore } from './media-library.store';
import { GRID_CHUNK } from './media-library.util';

type MediaView = components['schemas']['MediaView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];
type ListOptions = { folder?: string; page?: number; size?: number };

/** The list endpoint over a fixed set of files: by folder path, paged like Spring does. */
function listOver(files: MediaSummaryView[]) {
  return vi.fn((_key: string, opts: ListOptions = {}) => {
    const size = opts.size ?? 200;
    const page = opts.page ?? 0;
    const inFolder = opts.folder ? files.filter((f) => f.folderPath === opts.folder) : files;
    return of(pageOf(inFolder.slice(page * size, (page + 1) * size), page, size, inFolder.length));
  });
}

function setup(files: MediaSummaryView[] = productFiles(), tree = MEDIA_TREE) {
  const api = { listMedia: listOver(files) };
  const project = projectStub(tree);
  const locale = signal<string | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      MediaLibraryStore,
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: project },
      { provide: EditingLocaleStore, useValue: { locale } },
    ],
  });
  const store = TestBed.inject(MediaLibraryStore);
  store.connect(signal('proj'));
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const lastQuery = () => navigate.mock.lastCall?.[1]?.queryParams;
  return { store, api, project, navigate, lastQuery, locale, prefs: TestBed.inject(PreferencesService) };
}

/** Opens Products and reads it. */
function openProducts(store: MediaLibraryStore) {
  store.applyRoute({ folder: 'products-uuid' });
  store.loadFolder();
}

const names = (store: MediaLibraryStore) => store.visible().map((item) => item.displayName);

describe('MediaLibraryStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('the open folder', () => {
    it('reads the files of the folder the URL names, by the folder’s path', () => {
      const { store, api } = setup();

      openProducts(store);

      expect(api.listMedia).toHaveBeenCalledWith('proj', { page: 0, size: 200, folder: PRODUCTS });
      expect(store.folderNode()?.displayName).toBe('Products');
      expect(store.folderTrail().map((f) => f.displayName)).toEqual(['Products']);
      expect(store.items()).toHaveLength(6);
      expect(store.loaded()).toBe(true);
      expect(store.loading()).toBe(false);
    });

    it('reads the library root (the wrapper’s own path) when no folder is open', () => {
      const { store, api } = setup([summary('root.jpg', '/media_root/'), ...productFiles()]);

      store.applyRoute({});
      store.loadFolder();

      expect(api.listMedia).toHaveBeenCalledWith('proj', { page: 0, size: 200, folder: '/media_root/' });
      expect(store.folderNode()).toBeNull();
      expect(names(store)).toEqual(['root.jpg']);
    });

    it('reads a big folder page by page until it is complete', () => {
      const many = Array.from({ length: 450 }, (_, i) => summary(`img-${String(i).padStart(3, '0')}.jpg`, PRODUCTS));
      const { store, api } = setup(many);

      openProducts(store);

      expect(api.listMedia.mock.calls.map(([, opts]) => opts?.page)).toEqual([0, 1, 2]);
      expect(store.items()).toHaveLength(450);
      expect(store.totalElements()).toBe(450);
      expect(store.loadingMore()).toBe(false);
    });

    it('shows what arrived while the rest of a big folder is still on its way', () => {
      const pages = new Subject<ReturnType<typeof pageOf>>();
      const { store, api } = setup();
      const first = Array.from({ length: 200 }, (_, i) => summary(`a-${i}.jpg`, PRODUCTS));
      api.listMedia.mockReturnValueOnce(of(pageOf(first, 0, 200, 230)) as never).mockReturnValueOnce(pages as never);

      openProducts(store);

      expect(store.items()).toHaveLength(200);
      expect(store.loadingMore()).toBe(true);
      pages.next(pageOf(Array.from({ length: 30 }, (_, i) => summary(`b-${i}.jpg`, PRODUCTS)), 1, 200, 230));
      expect(store.items()).toHaveLength(230);
      expect(store.loadingMore()).toBe(false);
    });

    it('ignores the answer for a folder that is no longer open', () => {
      const { store, api } = setup();
      const slow = new Subject<ReturnType<typeof pageOf>>();
      api.listMedia.mockReturnValueOnce(slow as never);
      openProducts(store);

      store.applyRoute({ folder: 'team-uuid' });
      store.loadFolder();
      slow.next(pageOf(productFiles()));

      expect(store.items()).toEqual([]);
      expect(store.loaded()).toBe(true);
    });

    it('reports a failed read, and a re-read keeps what is on screen', () => {
      const { store, api } = setup();
      api.listMedia.mockReturnValueOnce(throwError(() => new Error('500')) as never);

      openProducts(store);
      expect(store.failed()).toBe(true);
      expect(store.loading()).toBe(false);

      store.loadFolder();
      expect(store.failed()).toBe(false);
      expect(store.items()).toHaveLength(6);

      api.listMedia.mockReturnValueOnce(throwError(() => new Error('500')) as never);
      store.reload();
      expect(store.items()).toHaveLength(6);
    });

    it('knows when the URL names a folder that is not in the tree', () => {
      const { store } = setup();

      store.applyRoute({ folder: 'gone-uuid' });

      expect(store.folderGone()).toBe(true);
      expect(store.folderNode()).toBeNull();
    });

    it('waits for the folder tree before it knows a folder is gone', () => {
      const { store } = setup([], []);

      store.applyRoute({ folder: 'products-uuid' });

      expect(store.treeReady()).toBe(false);
      expect(store.folderGone()).toBe(false);
    });
  });

  describe('search, type filter and sort', () => {
    it('applies the URL’s q, type and sort to the folder’s files', () => {
      const { store } = setup();
      openProducts(store);

      store.applyRoute({ folder: 'products-uuid', q: 'logo', type: 'images', sort: 'size-desc' });

      expect(names(store)).toEqual(['logo-mark.png', 'logo.svg']);
      expect(store.search()).toBe('logo');
      expect(store.typeFilter()).toBe('images');
      expect(store.sort()).toBe('size');
      expect(store.direction()).toBe('desc');
      expect(store.filtered()).toBe(true);
    });

    it('falls back to the defaults for values it does not know', () => {
      const { store } = setup();

      store.applyRoute({ type: 'videos', sort: 'weight-up', media: 'carousel' });

      expect(store.typeFilter()).toBe('all');
      expect(store.sort()).toBe('name');
      expect(store.direction()).toBe('asc');
      expect(store.viewParam()).toBeNull();
    });

    it('sends type, sort and clear-filters through the router, leaving defaults out', () => {
      const { store, lastQuery } = setup();

      store.setTypeFilter('text');
      expect(lastQuery()).toEqual({ type: 'text' });
      store.setTypeFilter('all');
      expect(lastQuery()).toEqual({ type: null });
      store.setSort('date', 'asc');
      expect(lastQuery()).toEqual({ sort: 'date-asc' });
      store.setSort('name', 'asc');
      expect(lastQuery()).toEqual({ sort: null });
      store.clearFilters();
      expect(lastQuery()).toEqual({ q: null, type: null });
      expect(store.search()).toBe('');
    });

    it('filters at once while typing and writes q to the URL after a pause, replacing the entry', () => {
      const { store, navigate, lastQuery } = setup();
      openProducts(store);

      store.setSearch('lo');
      store.setSearch('logo');

      expect(names(store)).toEqual(['logo-mark.png', 'logo.svg']);
      expect(navigate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(lastQuery()).toEqual({ q: 'logo' });
      expect(navigate.mock.lastCall?.[1]?.replaceUrl).toBe(true);
    });

    it('does not take back what is being typed when the URL echoes an older text', () => {
      const { store } = setup();

      store.setSearch('lo');
      vi.advanceTimersByTime(300); // the URL now holds q=lo
      store.setSearch('log');
      store.applyRoute({ q: 'lo' }); // the router’s echo of the first write

      expect(store.search()).toBe('log');
    });

    it('takes the URL’s q when it really changed (back, forward, a link)', () => {
      const { store } = setup();
      store.setSearch('log');
      vi.advanceTimersByTime(300);

      store.applyRoute({ q: '' });

      expect(store.search()).toBe('');
    });
  });

  describe('rendering a big folder in chunks', () => {
    it('shows the first chunk and more as the end scrolls in', () => {
      const many = Array.from({ length: 150 }, (_, i) => summary(`img-${String(i).padStart(3, '0')}.jpg`, PRODUCTS));
      const { store } = setup(many);
      openProducts(store);

      expect(store.shown()).toHaveLength(GRID_CHUNK);
      expect(store.hasMoreToShow()).toBe(true);
      store.showMore();
      expect(store.shown()).toHaveLength(2 * GRID_CHUNK);
      store.showAll();
      expect(store.shown()).toHaveLength(150);
      expect(store.hasMoreToShow()).toBe(false);
    });

    it('starts over with the first chunk for another sort, filter or folder', () => {
      const many = Array.from({ length: 150 }, (_, i) => summary(`img-${String(i).padStart(3, '0')}.jpg`, PRODUCTS));
      const { store } = setup(many);
      openProducts(store);
      store.showAll();

      store.applyRoute({ folder: 'products-uuid', sort: 'size-desc' });
      expect(store.renderLimit()).toBe(GRID_CHUNK);

      store.showAll();
      store.setSearch('img');
      expect(store.renderLimit()).toBe(GRID_CHUNK);

      store.showAll();
      store.applyRoute({ folder: 'team-uuid' });
      expect(store.renderLimit()).toBe(GRID_CHUNK);
    });
  });

  describe('selection', () => {
    function opened() {
      const result = setup();
      openProducts(result.store);
      return { ...result, uuids: () => result.store.visible().map((item) => item.uuid ?? '') };
    }

    it('toggles single files', () => {
      const { store, uuids } = opened();

      store.toggle(uuids()[1]);
      store.toggle(uuids()[3]);
      store.toggle(uuids()[1]);

      expect(store.selected()).toEqual([uuids()[3]]);
      expect(store.isSelected(uuids()[3])).toBe(true);
      expect(store.selectedItems().map((i) => i.displayName)).toEqual(['logo.svg']);
    });

    it('selects a range of the visible list, in either direction, keeping the rest', () => {
      const { store, uuids } = opened();

      store.toggle(uuids()[5]);
      store.selectRange(uuids()[3], uuids()[1]);

      expect(new Set(store.selected())).toEqual(new Set([uuids()[1], uuids()[2], uuids()[3], uuids()[5]]));
    });

    it('selects all visible files, and clears', () => {
      const { store } = opened();

      store.applyRoute({ folder: 'products-uuid', type: 'images' });
      store.selectAll();
      expect(store.selected()).toHaveLength(4);

      store.clearSelection();
      expect(store.selected()).toEqual([]);
    });

    it('drops files from the selection when a filter hides them', () => {
      const { store } = opened();
      store.selectAll();

      store.setSearch('logo');

      expect(store.selected()).toHaveLength(2);
      expect(store.selectedItems().map((i) => i.displayName)).toEqual(['logo-mark.png', 'logo.svg']);
    });

    it('is emptied by another folder, and keeps only the files that are still in the folder after a re-read', () => {
      const { store, api } = opened();
      store.selectAll();
      const removed = productFiles().slice(1);
      api.listMedia.mockReturnValueOnce(of(pageOf(removed)) as never);

      store.reload();
      expect(store.selected()).toHaveLength(5);
      expect(store.selected()).not.toContain('uuid-yirgacheffe-jpg');

      store.applyRoute({ folder: 'team-uuid' });
      expect(store.selected()).toEqual([]);
    });
  });

  describe('the view', () => {
    it('is the stored preference unless the URL says otherwise', () => {
      const { store, prefs } = setup();
      expect(store.view()).toBe('grid');

      prefs.setMediaView('list');
      expect(store.view()).toBe('list');

      store.applyRoute({ media: 'grid' });
      expect(store.view()).toBe('grid');
    });

    it('stores a choice in the preferences, and rewrites a ?media= that would override it', () => {
      const { store, prefs, navigate, lastQuery } = setup();

      store.setView('list');
      expect(prefs.mediaView()).toBe('list');
      expect(navigate).not.toHaveBeenCalled();

      store.applyRoute({ media: 'grid' });
      store.setView('list');
      expect(lastQuery()).toEqual({ media: 'list' });
    });
  });

  describe('opening folders and files', () => {
    it('opens a folder through the router, closing the open file, and the root with null', () => {
      const { store, lastQuery } = setup();

      store.openFolder('team-uuid');
      expect(lastQuery()).toEqual({ folder: 'team-uuid', asset: null });

      store.applyRoute({ folder: 'team-uuid' });
      store.openFolder(null);
      expect(lastQuery()).toEqual({ folder: null, asset: null });
    });

    it('does nothing when the folder is already open', () => {
      const { store, navigate } = setup();
      store.applyRoute({ folder: 'team-uuid' });

      store.openFolder('team-uuid');

      expect(navigate).not.toHaveBeenCalled();
    });

    it('resolves false when the router refuses (the drawer kept its unsaved edits)', async () => {
      const { store, navigate } = setup();
      store.applyRoute({ asset: 'uuid-a' });
      navigate.mockResolvedValueOnce(false);

      expect(await store.openAsset('uuid-b')).toBe(false);
      navigate.mockResolvedValueOnce(false);
      expect(await store.openFolder('team-uuid')).toBe(false);
      navigate.mockResolvedValueOnce(false);
      expect(await store.openFavorites()).toBe(false);

      expect(await store.openAsset('uuid-b')).toBe(true);
    });

    it('closes the drawer through the router (the drawer asked already)', () => {
      const { store, lastQuery } = setup();
      store.applyRoute({ asset: 'uuid-a' });

      store.closeDetail();

      expect(lastQuery()).toEqual({ asset: null });
    });
  });

  describe('the file the URL names', () => {
    it('shows a file of the open folder', () => {
      const { store } = setup();
      openProducts(store);
      const latte = store.items().find((i) => i.displayName === 'latte-art.jpg')!;

      store.applyRoute({ folder: 'products-uuid', asset: latte.uuid });
      store.resolveAsset(store.assetUuid());

      expect(store.selectedMedia()?.uuid).toBe(latte.uuid);
      expect(store.assetGone()).toBe(false);
    });

    it('finds a file of another folder in the project-wide list, and says where it lives', () => {
      const team = summary('anna.jpg', '/media_root/team/');
      const { store } = setup([...productFiles(), team]);
      store.loadAllMedia('proj');

      store.applyRoute({ asset: team.uuid });
      store.resolveAsset(team.uuid ?? null);

      expect(store.selectedMedia()?.uuid).toBe(team.uuid);
      expect(store.folderUuidOfAsset(team.uuid!)).toBe('team-uuid');
    });

    it('answers the root for a file that lives directly in the library', () => {
      const root = summary('root.jpg', '/media_root/');
      const { store } = setup([root]);
      store.loadAllMedia('proj');

      expect(store.folderUuidOfAsset(root.uuid!)).toBe('');
      expect(store.folderUuidOfAsset('unknown')).toBeNull();
    });

    it('waits for the project-wide list before it calls a file gone', () => {
      const { store, api } = setup();
      store.applyRoute({ asset: 'ghost' });

      store.resolveAsset('ghost');
      expect(store.assetGone()).toBe(false);

      api.listMedia.mockReturnValueOnce(of(pageOf(productFiles())) as never);
      store.loadAllMedia('proj');
      store.resolveAsset('ghost');
      expect(store.assetGone()).toBe(true);
      expect(store.selectedMedia()).toBeNull();
    });

    it('closes the drawer when the URL names no file', () => {
      const { store } = setup();
      openProducts(store);
      store.applyRoute({ folder: 'products-uuid', asset: store.items()[0].uuid });
      store.resolveAsset(store.assetUuid());
      expect(store.selectedMedia()).not.toBeNull();

      store.applyRoute({ folder: 'products-uuid' });
      store.resolveAsset(store.assetUuid());

      expect(store.selectedMedia()).toBeNull();
    });

    it('keeps the drawer’s own fuller copy of the file while the URL still names it', () => {
      const { store } = setup();
      openProducts(store);
      const first = store.items()[0];
      store.applyRoute({ folder: 'products-uuid', asset: first.uuid });
      const saved: MediaView = { uuid: first.uuid, displayName: first.displayName, revision: 9, altText: 'Beans' };

      store.onUpdated(saved);
      store.resolveAsset(first.uuid ?? null);

      expect(store.selectedMedia()).toBe(saved);
      expect(store.items().find((i) => i.uuid === first.uuid)?.revision).toBe(9);
    });
  });

  describe('changes made in the library', () => {
    it('drops a deleted file from the list, the counts and the selection, and closes its drawer', () => {
      const { store, lastQuery } = setup();
      store.loadAllMedia('proj');
      openProducts(store);
      const first = store.items()[0];
      store.applyRoute({ folder: 'products-uuid', asset: first.uuid });
      store.resolveAsset(first.uuid ?? null);
      store.toggle(first.uuid);

      store.onDeleted(first.uuid!);

      expect(store.items()).toHaveLength(5);
      expect(store.allMedia().some((i) => i.uuid === first.uuid)).toBe(false);
      expect(store.selected()).toEqual([]);
      expect(store.selectedMedia()).toBeNull();
      expect(lastQuery()).toEqual({ asset: null });
    });

    it('leaves the drawer of another file open when a file is deleted', () => {
      const { store } = setup();
      openProducts(store);
      const [first, second] = store.items();
      store.applyRoute({ folder: 'products-uuid', asset: first.uuid });
      store.resolveAsset(first.uuid ?? null);

      store.onDeleted(second.uuid!);

      expect(store.selectedMedia()?.uuid).toBe(first.uuid);
    });

    it('puts an uploaded file first in the open folder and in the project-wide list', () => {
      const { store } = setup();
      openProducts(store);
      const uploaded: MediaView = {
        uuid: 'new-uuid',
        displayName: 'fresh.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 900,
        revision: 1,
        image: { width: 800, height: 600 },
      };

      store.prepend(uploaded, 'products-uuid');

      expect(store.items()[0]).toMatchObject({ uuid: 'new-uuid', width: 800, height: 600, usageCount: 0, folderPath: PRODUCTS });
      expect(store.allMedia()[0].uuid).toBe('new-uuid');
      expect(store.totalElements()).toBe(7);
    });

    it('keeps an upload to another folder out of the open folder’s list', () => {
      const { store } = setup();
      openProducts(store);

      store.prepend({ uuid: 'new-uuid', displayName: 'fresh.jpg', revision: 1 }, 'team-uuid');

      expect(store.items()).toHaveLength(6);
      expect(store.allMedia()[0]).toMatchObject({ uuid: 'new-uuid', folderPath: '/media_root/team/' });
    });

    it('re-reads the folders (the tree first) and then the files', () => {
      const { store, project, api } = setup();
      openProducts(store);
      api.listMedia.mockClear();

      store.reloadFolders();

      expect(project.loadFor).toHaveBeenCalledWith('proj', true);
      expect(api.listMedia).toHaveBeenCalledWith('proj', { page: 0, size: 200, folder: PRODUCTS });
      expect(api.listMedia).toHaveBeenCalledWith('proj', { page: 0, size: 10000 });
    });
  });

  describe('what the library knows about its folders', () => {
    it('counts the files per folder and finds where a file lives', () => {
      const { store } = setup();
      store.loadAllMedia('proj');

      expect(store.mediaByFolder().get(PRODUCTS)).toHaveLength(6);
      expect(store.parentFolderUuidOf(store.allMedia()[0].uuid!)).toBe('products-uuid');
      expect(store.parentFolderUuidOf('roastery-uuid')).toBe('products-uuid');
      expect(store.parentFolderUuidOf('products-uuid')).toBeUndefined();
      expect(store.labelOf('products-uuid')).toBe('Products');
    });

    it('reports an empty library only when there are no folders and no files and both were read', () => {
      const { store } = setup([], [{ ...MEDIA_TREE[0], children: [] }]);
      expect(store.libraryEmpty()).toBe(false);

      store.loadAllMedia('proj');

      expect(store.libraryEmpty()).toBe(true);
    });

    it('does not call a library with folders empty', () => {
      const { store } = setup([]);

      store.loadAllMedia('proj');

      expect(store.libraryEmpty()).toBe(false);
    });

    it('does not call a library empty because its files could not be read', () => {
      const { store, api } = setup([], [{ ...MEDIA_TREE[0], children: [] }]);
      api.listMedia.mockReturnValueOnce(throwError(() => new Error('500')) as never);

      store.loadAllMedia('proj');

      expect(store.allFailed()).toBe(true);
      expect(store.libraryEmpty()).toBe(false);
    });

    it('shows the status icon only for a file with something unreleased, in the editing language', () => {
      const { store, locale } = setup();
      const [yirgacheffe, latte] = productFiles();

      expect(store.statusOf(yirgacheffe)).toBeNull();
      expect(store.statusOf(latte)).toMatchObject({ label: 'Changed', tone: 'warning' });

      locale.set('de');
      const localized = summary('hero.png', PRODUCTS, {
        localized: true,
        release: { en: { status: 'PUBLISHED' }, de: { status: 'NEW' } },
      });
      expect(store.statusOf(localized)?.label).toBe('New');
    });
  });
});
