import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { commonIndexPage, intentReady, nearestIndexPage } from './redirect-option.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];

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

describe('redirect-option.util', () => {
  it('finds the index page of the nearest folder above that is online', () => {
    // The tools index was never released: the products index is the nearest online one.
    expect(nearestIndexPage({ uuid: 'hammer', name: 'Hammer', folderPath: '/products/tools/' }, PAGES, INDEX, new Set())?.uuid).toBe(
      'products-index',
    );
    // A folder path without its trailing slash is the same folder.
    expect(nearestIndexPage({ uuid: 'hammer', name: 'Hammer', folderPath: '/products/tools' }, PAGES, INDEX, new Set())?.uuid).toBe(
      'products-index',
    );
    // A channel's own index uid counts.
    expect(nearestIndexPage({ uuid: 'team', name: 'Team', folderPath: '/about/' }, PAGES, new Set(['index', 'start']), new Set())?.uuid).toBe(
      'about-start',
    );
    expect(nearestIndexPage({ uuid: 'team', name: 'Team', folderPath: '/about/' }, PAGES, INDEX, new Set())?.uuid).toBe('root-index');
  });

  it('takes the page named like a folder, beside it, as that folder’s index page', () => {
    // As the API sends folder paths: under the pages root. A uid is unique per project, so a subfolder's landing page
    // is the page named like the folder (written as `products/index.html` with directory URLs).
    const pages = [
      page('home', 'index', '/pages_root/', 'PUBLISHED'),
      page('products', 'products', '/pages_root/', 'PUBLISHED'),
      page('tools', 'tools', '/pages_root/products/', 'UNPUBLISHED'),
      page('hammer', 'hammer', '/pages_root/products/tools/', 'PUBLISHED'),
    ];
    const hammer = { uuid: 'hammer', name: 'Hammer', folderPath: '/pages_root/products/tools/' };
    // "tools" is offline: the products page is the nearest.
    expect(nearestIndexPage(hammer, pages, INDEX, new Set())?.uuid).toBe('products');
    // With the products page going offline too, the home page (index uid in the pages root).
    expect(nearestIndexPage(hammer, pages, INDEX, new Set(['products']))?.uuid).toBe('home');
  });

  it('skips the pages going offline, the index page itself included, up to none', () => {
    const products = { uuid: 'products-index', name: 'Products', folderPath: '/products/' };
    expect(nearestIndexPage(products, PAGES, INDEX, new Set(['products-index']))?.uuid).toBe('root-index');
    const root = { uuid: 'root-index', name: 'Home', folderPath: '/' };
    expect(nearestIndexPage(root, PAGES, INDEX, new Set(['root-index']))).toBeNull();
  });

  it('preselects for several pages only the page they share', () => {
    const hammer = { uuid: 'hammer', name: 'Hammer', folderPath: '/products/tools/' };
    const saw = { uuid: 'saw', name: 'Saw', folderPath: '/products/tools/' };
    const team = { uuid: 'team', name: 'Team', folderPath: '/about/' };
    expect(commonIndexPage([hammer, saw], PAGES, INDEX)?.uuid).toBe('products-index');
    expect(commonIndexPage([hammer, team], PAGES, INDEX)).toBeNull();
    // Unpublishing the products index with a page below it: neither may be the target.
    expect(commonIndexPage([hammer, { uuid: 'products-index', name: 'Products', folderPath: '/products/' }], PAGES, INDEX)?.uuid).toBe(
      'root-index',
    );
  });

  it('is ready without a redirect, or with a page', () => {
    expect(intentReady({ wanted: false, page: null })).toBe(true);
    expect(intentReady({ wanted: true, page: null })).toBe(false);
    expect(intentReady({ wanted: true, page: { uuid: 'x', name: 'X' } })).toBe(true);
  });
});
