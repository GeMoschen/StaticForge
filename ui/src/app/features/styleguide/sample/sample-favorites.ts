import { SampleEntry, pathTo } from './sample-data';
import { SampleContentEntry, SampleTemplateEntry, contentPath, templatePath } from './sample-content-data';
import type { SampleArea } from './sample-state';

/**
 * Favorites are not bound to a store (M35.15): any asset or folder can be one, whichever tree it lives in. A favorite
 * folder shows as a folder and opens lazily, like the folder itself.
 */
export type SampleFavoriteKind = 'page' | 'folder' | 'recordset' | 'record' | 'template' | 'media' | 'global';

export interface SampleFavorite {
  /** `area:id`, unique. */
  readonly key: string;
  readonly kind: SampleFavoriteKind;
  readonly id: string;
  readonly name: string;
  /** Where it lives, for the muted text beside the name ("Shop", "Page templates"). */
  readonly path: string;
  /** The area (store) it opens in. */
  readonly area: SampleArea;
}

export const FAVORITE_ICONS: Readonly<Record<SampleFavoriteKind, string>> = {
  page: 'description',
  folder: 'folder',
  recordset: 'table_rows',
  record: 'table_rows',
  template: 'code_blocks',
  media: 'image',
  global: 'tune',
};

/** The id of the pinned *Favorites* node at the top of every tree. */
export const FAVORITES_NODE = 'favorites-node';

/** The ids of the *Favorites* node's descendants are `fav:<favorite key>` and `fav:<favorite key>/<item id inside it>`. */
export const FAVORITE_NODE_PREFIX = 'fav:';

export const favoriteKey = (area: SampleArea, id: string): string => `${area}:${id}`;

/** Favorites from several stores, folders included, so the list shows that it spans all of them. */
export const FAVORITE_SEED: readonly SampleFavorite[] = [
  { key: 'pages:p-espresso', kind: 'page', id: 'p-espresso', name: 'Espresso blends', path: 'Shop', area: 'pages' },
  { key: 'pages:f-news', kind: 'folder', id: 'f-news', name: 'News', path: '', area: 'pages' },
  { key: 'content:cf-shop', kind: 'folder', id: 'cf-shop', name: 'Shop', path: '', area: 'content' },
  { key: 'content:r-yirgacheffe_konga_250_g', kind: 'record', id: 'r-yirgacheffe_konga_250_g', name: 'Yirgacheffe Konga 250 g', path: 'Shop › Single origins', area: 'content' },
  { key: 'templates:tf-page', kind: 'folder', id: 'tf-page', name: 'Page templates', path: '', area: 'templates' },
  { key: 'templates:t-page-article', kind: 'template', id: 't-page-article', name: 'Article', path: 'Page templates', area: 'templates' },
  { key: 'media:m-products', kind: 'folder', id: 'm-products', name: 'Products', path: '', area: 'media' },
  { key: 'media:a-yirgacheffe-beans', kind: 'media', id: 'a-yirgacheffe-beans', name: 'yirgacheffe-beans-light-roast.jpg', path: 'Products', area: 'media' },
  { key: 'globals:site', kind: 'global', id: 'site', name: 'Site settings', path: 'Site', area: 'globals' },
];

const joined = (names: readonly string[]): string => names.join(' › ');

export function pageFavorite(entry: SampleEntry): SampleFavorite {
  return {
    key: favoriteKey('pages', entry.id),
    kind: entry.kind === 'folder' ? 'folder' : 'page',
    id: entry.id,
    name: entry.name,
    path: joined(pathTo(entry.id).slice(0, -1).map((e) => e.name)),
    area: 'pages',
  };
}

export function contentFavorite(entry: SampleContentEntry): SampleFavorite {
  return {
    key: favoriteKey('content', entry.id),
    kind: entry.kind === 'folder' ? 'folder' : 'recordset',
    id: entry.id,
    name: entry.name,
    path: joined(contentPath(entry.id).slice(0, -1).map((e) => e.name)),
    area: 'content',
  };
}

export function templateFavorite(entry: SampleTemplateEntry): SampleFavorite {
  return {
    key: favoriteKey('templates', entry.id),
    kind: entry.kind === 'folder' ? 'folder' : 'template',
    id: entry.id,
    name: entry.name,
    path: joined(templatePath(entry.id).slice(0, -1).map((e) => e.name)),
    area: 'templates',
  };
}
