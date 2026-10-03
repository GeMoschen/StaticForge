import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { MEDIA_TREE, pageOf, productFiles, projectStub } from './media-library.testing';
import { MediaLibraryStore } from './media-library.store';

/** The part of the store the detail drawer uses: its tab, its place in the list and the step to the next file. */
function setup() {
  const files = productFiles();
  const api = { listMedia: vi.fn(() => of(pageOf(files, 0, 200, files.length))) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      MediaLibraryStore,
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: projectStub(MEDIA_TREE) },
      { provide: EditingLocaleStore, useValue: { locale: signal<string | null>(null) } },
    ],
  });
  const store = TestBed.inject(MediaLibraryStore);
  store.connect(signal('proj'));
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  store.applyRoute({ folder: 'products-uuid' });
  store.loadFolder();
  return { store, navigate, query: () => navigate.mock.lastCall?.[1]?.queryParams };
}

describe('MediaLibraryStore: the detail drawer', () => {
  it('shows a changed UID in the grid, the project-wide list and the open drawer, by uuid', () => {
    const { store } = setup();
    const file = store.items()[0];
    store.allMedia.set(productFiles());
    store.selectedMedia.set(file as never);

    store.onUidChanged(file.uuid!, 'cover_photo');

    expect(store.items()[0]).toMatchObject({ uuid: file.uuid, uid: 'cover_photo', displayName: file.displayName });
    expect(store.items()[1].uid).not.toBe('cover_photo');
    expect(store.allMedia().find((item) => item.uuid === file.uuid)?.uid).toBe('cover_photo');
    expect(store.mediaUids()).toContain('cover_photo');
    expect(store.selectedMedia()?.uid).toBe('cover_photo');
  });

  it('takes the drawer’s tab from the URL (`mtab`), none meaning Details', () => {
    const { store } = setup();
    expect(store.tabParam()).toBeNull();

    store.applyRoute({ folder: 'products-uuid', asset: 'a', mtab: 'source' });

    expect(store.tabParam()).toBe('source');
  });

  it('writes the tab to the URL as a replaced entry, and leaves Details out', () => {
    const { store, navigate, query } = setup();

    store.setDetailTab('versions');
    expect(query()).toEqual({ mtab: 'versions' });
    expect(navigate.mock.lastCall?.[1]?.replaceUrl).toBe(true);

    store.setDetailTab('details');
    expect(query()).toEqual({ mtab: null });
  });

  it('forgets the tab when the drawer closes, and keeps it when another file is stepped to', () => {
    const { store, query } = setup();
    const [first, second] = store.visible();
    store.applyRoute({ folder: 'products-uuid', asset: first.uuid, mtab: 'usedby' });

    store.openAsset(second.uuid ?? null);
    expect(query()).toEqual({ asset: second.uuid });

    store.closeDetail();
    expect(query()).toEqual({ asset: null, mtab: null });
  });

  it('knows the open file’s place in the visible list', () => {
    const { store } = setup();
    const list = store.visible();
    store.applyRoute({ folder: 'products-uuid', asset: list[2].uuid });

    expect(store.detailPosition()).toEqual({ index: 2, count: list.length });

    store.applyRoute({ folder: 'products-uuid', asset: 'not-in-the-list' });
    expect(store.detailPosition()).toEqual({ index: -1, count: list.length });
  });

  it('steps to the next and previous file of the visible list, wrapping around', () => {
    const { store, query } = setup();
    const list = store.visible();

    store.applyRoute({ folder: 'products-uuid', asset: list[0].uuid });
    store.stepAsset(-1);
    expect(query()).toEqual({ asset: list.at(-1)!.uuid });

    store.applyRoute({ folder: 'products-uuid', asset: list.at(-1)!.uuid });
    store.stepAsset(1);
    expect(query()).toEqual({ asset: list[0].uuid });

    store.applyRoute({ folder: 'products-uuid', asset: list[1].uuid });
    store.stepAsset(1);
    expect(query()).toEqual({ asset: list[2].uuid });
  });

  it('steps through what the search shows, not the whole folder', () => {
    const { store, query } = setup();
    store.setSearch('.jpg');
    const shown = store.visible();
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThan(store.items().length);
    store.applyRoute({ folder: 'products-uuid', asset: shown[0].uuid, q: '.jpg' });

    store.stepAsset(1);

    expect(query()).toEqual({ asset: shown[1].uuid });
  });

  it('does not step from a file that is not in the list, or in a list of one', () => {
    const { store, navigate } = setup();
    store.applyRoute({ folder: 'products-uuid', asset: 'elsewhere' });

    store.stepAsset(1);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('lists the UIDs of the project’s media, and the folder the open file lives in', () => {
    const { store } = setup();
    store.loadAllMedia('proj');
    const uids = store.mediaUids();
    const first = store.visible()[0];
    store.applyRoute({ folder: 'products-uuid', asset: first.uuid });

    expect(uids.length).toBeGreaterThan(0);
    expect(store.assetFolderPath()).toBe(first.folderPath);
  });
});
