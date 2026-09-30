import type { components } from '../../core/api/generated/schema.d.ts';

export type FolderView = components['schemas']['FolderView'];
export type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** The four folder-tree scopes shown in this panel. `TEMPLATES` is ONE tree scope — its tree
 * just happens to have two fixed top-level folders ("Page Templates"/"Section Templates"),
 * structurally no different from any other scope having multiple top-level folders — so it
 * needs no special-casing anywhere below. */
export type TreeScope = 'PAGE' | 'MEDIA' | 'PAGE_REFERENCE' | 'TEMPLATES' | 'GLOBAL_SET' | 'RECORD_SET';
/** The `FolderScope`/`ExportSelectionRequest.fullStores` string for each tree scope. */
export type StoreScope = 'PAGES' | 'MEDIA' | 'NAVIGATION' | 'TEMPLATES' | 'GLOBALS' | 'CONTENT';

export const STORE_SCOPE_FOR: Record<TreeScope, StoreScope> = {
  PAGE: 'PAGES',
  MEDIA: 'MEDIA',
  PAGE_REFERENCE: 'NAVIGATION',
  TEMPLATES: 'TEMPLATES',
  GLOBAL_SET: 'GLOBALS',
  RECORD_SET: 'CONTENT',
};

/** The `ApiClient.listAssets` `type` filter(s) backing each tree scope — `TEMPLATES` needs two
 * calls since its tree holds both `PAGE_TEMPLATE` and `SECTION_TEMPLATE` leaves. */
export const ASSET_TYPES_FOR: Record<TreeScope, string[]> = {
  PAGE: ['PAGE'],
  MEDIA: ['MEDIA'],
  PAGE_REFERENCE: ['PAGE_REFERENCE'],
  // The "Datasets" folder (M19.4.1) lives in the templates tree, so its schemas are leaves there.
  TEMPLATES: ['PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'DATASET'],
  GLOBAL_SET: ['GLOBAL_SET'],
  // The Content store's leaves are its record sets (M25.5.3); a set's records go with it and are never picked
  // one by one.
  RECORD_SET: ['RECORD_SET'],
};

/** A folder tree with the Content store's record-set leaf nodes (`type: RECORD_SET`) removed at every level. */
export function withoutRecordSets(tree: FolderView[]): FolderView[] {
  return tree
    .filter((node) => node.type !== 'RECORD_SET')
    .map((node) => ({ ...node, children: withoutRecordSets(node.children ?? []) }));
}

/** Bucket key used for items with no folder — i.e. living directly at the store's hidden root. */
export const ROOT_PATH = '/';

/**
 * Tri-state a tree row can render as (M11.3.4 — replaces the old checked/indeterminate pair):
 * - `explicit`: the node's own uuid is directly selected, OR an ancestor/full-store pick covers it.
 * - `implicit`: not explicit, but at least one descendant is explicit-or-implicit — this node is
 *   pure "ancestor padding" that the backend will include anyway to give the pick a valid path.
 * - `unchecked`: neither.
 */
export type CheckState = 'unchecked' | 'explicit' | 'implicit';
