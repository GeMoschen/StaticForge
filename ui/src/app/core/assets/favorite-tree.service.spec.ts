import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api.client';
import { FAVORITES_NODE, FAVORITE_NODE_PREFIX, FavoriteTreeService, isFavoriteNode } from './favorite-tree.service';

const listAssets = vi.fn();

describe('FavoriteTreeService', () => {
  let service: FavoriteTreeService;

  beforeEach(() => {
    listAssets.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { listAssets } }] });
    service = TestBed.inject(FavoriteTreeService);
  });

  it('has a pinned root node and recognises everything in its branch', () => {
    const root = service.rootNode('Favorites');
    expect(root).toMatchObject({ id: FAVORITES_NODE, pinned: true, icon: 'star', hasChildren: true, draggable: false, droppable: false });
    expect(isFavoriteNode(FAVORITES_NODE)).toBe(true);
    expect(isFavoriteNode(`${FAVORITE_NODE_PREFIX}u1/u2`)).toBe(true);
    expect(isFavoriteNode('u1')).toBe(false);
  });

  it('lists favorites from any store as flat nodes, folders as expandable folder nodes', () => {
    const nodes = service.nodes([
      { kind: 'PAGE', uuid: 'p', title: 'Our story', folderPath: '/pages_root/about/' },
      { kind: 'FOLDER', uuid: 'f', title: 'Photos', folderPath: '/media_root/photos/' },
      { kind: 'RECORD', uuid: 'r', title: 'Yirgacheffe' },
    ]);
    expect(nodes.map((n) => [n.id, n.label, n.icon, n.hasChildren])).toEqual([
      ['fav:p', 'Our story', 'description', false],
      ['fav:f', 'Photos', 'folder', true],
      ['fav:r', 'Yirgacheffe', 'table_rows', false],
    ]);
    expect(nodes[0].secondary).toBe('about');
  });

  it('loads the direct contents of a favorite folder, whichever store it belongs to', async () => {
    listAssets.mockReturnValue(
      of({
        content: [
          { uuid: 'f', type: 'FOLDER', displayName: 'Photos', folderPath: '/media_root/photos/' },
          { uuid: 'a', type: 'MEDIA', displayName: 'a.jpg', folderPath: '/media_root/photos/' },
          { uuid: 'sub', type: 'FOLDER', displayName: 'Summer', folderPath: '/media_root/photos/summer/' },
          { uuid: 'deep', type: 'FOLDER', displayName: 'Deep', folderPath: '/media_root/photos/summer/deep/' },
          { uuid: 'b', type: 'MEDIA', displayName: 'b.jpg', folderPath: '/media_root/photos/summer/' },
        ],
      }),
    );
    const [folder] = service.nodes([{ kind: 'FOLDER', uuid: 'f', title: 'Photos', folderPath: '/media_root/photos/' }]);
    const children = await firstValueFrom(service.children('demo', folder));
    expect(listAssets).toHaveBeenCalledWith('demo', { folder: '/media_root/photos/', size: 500 });
    expect(children.map((c) => [c.id, c.label, c.hasChildren])).toEqual([
      ['fav:f/a', 'a.jpg', false],
      ['fav:f/sub', 'Summer', true],
    ]);

    // A folder inside the branch loads the same way, from its own path.
    listAssets.mockReturnValue(of({ content: [{ uuid: 'b', type: 'MEDIA', displayName: 'b.jpg', folderPath: '/media_root/photos/summer/' }] }));
    const inner = await firstValueFrom(service.children('demo', children[1]));
    expect(inner.map((c) => c.id)).toEqual(['fav:f/sub/b']);
  });

  it('has no contents for anything that is not a folder', async () => {
    const [page] = service.nodes([{ kind: 'PAGE', uuid: 'p', title: 'Page', folderPath: '/pages_root/' }]);
    expect(await firstValueFrom(service.children('demo', page))).toEqual([]);
    expect(listAssets).not.toHaveBeenCalled();
  });

  it('opens a node in its own area', () => {
    const [page, folder] = service.nodes([
      { kind: 'PAGE', uuid: 'p', title: 'Page', folderPath: '/pages_root/' },
      { kind: 'FOLDER', uuid: 'f', title: 'Photos', folderPath: '/media_root/photos/' },
    ]);
    expect(service.routeOf('demo', page)).toEqual({ commands: ['/p', 'demo', 'pages', 'p'], queryParams: {} });
    expect(service.routeOf('demo', folder)).toEqual({ commands: ['/p', 'demo', 'media'], queryParams: { folder: 'f' } });
  });
});
