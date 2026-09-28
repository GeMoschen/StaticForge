import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { commonIndexPage, intentReady, nearestIndexPage, startPagesByFolder } from './redirect-option.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type FolderView = components['schemas']['FolderView'];

/** A page as `GET /pages` lists it: its folder path and its release block per locale key. */
function page(uuid: string, uid: string, folderPath: string, status: string): AssetSummaryView {
  return { uuid, uid, type: 'PAGE', displayName: uid, folderPath, revision: 3, release: { '': { status } } };
}

const PAGES: AssetSummaryView[] = [
  page('root-index', 'index', '/', 'PUBLISHED'),
  page('products-index', 'index', '/products/', 'CHANGED'),
  page('tools-index', 'index', '/products/tools/', 'NEW'),
  page('hammer', 'hammer', '/products/tools/', 'PUBLISHED'),
  page('saw', 'saw', '/products/tools/', 'PUBLISHED'),
  page('about-start', 'start', '/about/', 'PUBLISHED'),
  page('team', 'team', '/about/', 'PUBLISHED'),
];

const INDEX = new Set(['index']);
const NONE = new Map<string, string>();

describe('redirect-option.util', () => {
  it('finds the index page of the nearest folder above that is online', () => {
    // The tools index was never released: the products index is the nearest online one.
    expect(nearestIndexPage({ uuid: 'hammer', name: 'Hammer', folderPath: '/products/tools/' }, PAGES, INDEX, NONE, new Set())?.uuid).toBe(
      'products-index',
    );
    // A folder path without its trailing slash is the same folder.
    expect(nearestIndexPage({ uuid: 'hammer', name: 'Hammer', folderPath: '/products/tools' }, PAGES, INDEX, NONE, new Set())?.uuid).toBe(
      'products-index',
    );
    // A channel's own index uid counts.
    expect(nearestIndexPage({ uuid: 'team', name: 'Team', folderPath: '/about/' }, PAGES, new Set(['index', 'start']), NONE, new Set())?.uuid).toBe(
      'about-start',
    );
    expect(nearestIndexPage({ uuid: 'team', name: 'Team', folderPath: '/about/' }, PAGES, INDEX, NONE, new Set())?.uuid).toBe('root-index');
  });

  describe('start pages (M31)', () => {
    // As the API sends them: pages and folders under the protected pages root, each folder with its start page pointer.
    const pages = [
      page('home', 'homepage', '/pages_root/', 'PUBLISHED'),
      page('root-index', 'index', '/pages_root/', 'PUBLISHED'),
      page('products', 'products', '/pages_root/', 'PUBLISHED'),
      page('catalogue', 'catalogue', '/pages_root/products/', 'PUBLISHED'),
      page('tools-start', 'tools-overview', '/pages_root/products/tools/', 'UNPUBLISHED'),
      page('hammer', 'hammer', '/pages_root/products/tools/', 'PUBLISHED'),
    ];
    const tree: FolderView[] = [
      {
        uuid: 'pages-root',
        uid: 'pages_root',
        displayName: 'All Pages',
        path: '/pages_root/',
        scope: 'PAGES',
        protectedFolder: true,
        type: 'FOLDER',
        revision: 4,
        startPageUuid: 'home',
        children: [
          {
            uuid: 'products-f',
            uid: 'products',
            displayName: 'Products',
            path: '/pages_root/products/',
            scope: 'PAGES',
            protectedFolder: false,
            type: 'FOLDER',
            revision: 7,
            startPageUuid: 'catalogue',
            children: [
              {
                uuid: 'tools-f',
                uid: 'tools',
                displayName: 'Tools',
                path: '/pages_root/products/tools/',
                scope: 'PAGES',
                protectedFolder: false,
                type: 'FOLDER',
                revision: 8,
                startPageUuid: 'tools-start',
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const hammer = { uuid: 'hammer', name: 'Hammer', folderPath: '/pages_root/products/tools/' };

    it('reads every folder’s start page from the folder tree', () => {
      expect([...startPagesByFolder(tree)]).toEqual([
        ['/pages_root/', 'home'],
        ['/pages_root/products/', 'catalogue'],
        ['/pages_root/products/tools/', 'tools-start'],
      ]);
    });

    it('takes a folder’s start page first, walking up past an offline one', () => {
      // The tools start page is offline: the products start page is the nearest, not a page named like a folder.
      expect(nearestIndexPage(hammer, pages, INDEX, startPagesByFolder(tree), new Set())?.uuid).toBe('catalogue');
      // Without start pages nothing below the root has an index page; the page named like the folder doesn't count.
      expect(nearestIndexPage(hammer, pages, INDEX, NONE, new Set())?.uuid).toBe('root-index');
    });

    it('beats the index UID page of the same folder, which is the fallback once the start page goes offline', () => {
      const products = { uuid: 'products', name: 'Products', folderPath: '/pages_root/' };
      expect(nearestIndexPage(products, pages, INDEX, startPagesByFolder(tree), new Set(['products']))?.uuid).toBe('home');
      expect(nearestIndexPage(products, pages, INDEX, startPagesByFolder(tree), new Set(['products', 'home']))?.uuid).toBe(
        'root-index',
      );
    });

    it('ignores a start page pointer to a page that is no longer in the folder', () => {
      // The catalogue was moved to the root: the products folder's stale pointer doesn't make it the products index.
      const moved = pages.map((p) => (p.uuid === 'catalogue' ? { ...p, folderPath: '/pages_root/' } : p));
      expect(nearestIndexPage(hammer, moved, INDEX, startPagesByFolder(tree), new Set())?.uuid).toBe('home');
    });
  });

  it('skips the pages going offline, the index page itself included, up to none', () => {
    const products = { uuid: 'products-index', name: 'Products', folderPath: '/products/' };
    expect(nearestIndexPage(products, PAGES, INDEX, NONE, new Set(['products-index']))?.uuid).toBe('root-index');
    const root = { uuid: 'root-index', name: 'Home', folderPath: '/' };
    expect(nearestIndexPage(root, PAGES, INDEX, NONE, new Set(['root-index']))).toBeNull();
  });

  it('preselects for several pages only the page they share', () => {
    const hammer = { uuid: 'hammer', name: 'Hammer', folderPath: '/products/tools/' };
    const saw = { uuid: 'saw', name: 'Saw', folderPath: '/products/tools/' };
    const team = { uuid: 'team', name: 'Team', folderPath: '/about/' };
    expect(commonIndexPage([hammer, saw], PAGES, INDEX, NONE)?.uuid).toBe('products-index');
    expect(commonIndexPage([hammer, team], PAGES, INDEX, NONE)).toBeNull();
    // Unpublishing the products index with a page below it: neither may be the target.
    expect(commonIndexPage([hammer, { uuid: 'products-index', name: 'Products', folderPath: '/products/' }], PAGES, INDEX, NONE)?.uuid).toBe(
      'root-index',
    );
  });

  it('is ready without a redirect, or with a page', () => {
    expect(intentReady({ wanted: false, page: null })).toBe(true);
    expect(intentReady({ wanted: true, page: null })).toBe(false);
    expect(intentReady({ wanted: true, page: { uuid: 'x', name: 'X' } })).toBe(true);
  });
});
