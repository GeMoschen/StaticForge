import type { components } from '../../core/api/generated/schema.d.ts';
import { isOnline } from './release-status.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** A page whose old URLs an unpublish or delete dialog offers to redirect. */
export interface RedirectSource {
  uuid: string;
  name: string;
  /** The page's folder path as the API sends it (`/products/tools/`). */
  folderPath?: string | null;
}

/** Where the old URLs go: page 1 of this page. */
export interface RedirectTargetPage {
  uuid: string;
  name: string;
}

/** The option's state: whether to redirect, and to which page (none chosen yet: `null`). */
export interface RedirectIntent {
  wanted: boolean;
  page: RedirectTargetPage | null;
}

export const NO_REDIRECT: RedirectIntent = { wanted: false, page: null };

/** Whether the dialog may go ahead: no redirect wanted, or one with a page. */
export function intentReady(intent: RedirectIntent): boolean {
  return !intent.wanted || intent.page !== null;
}

/**
 * The index page of the nearest folder above `source` that has one online (M30.6.3), starting with the page's own
 * folder and walking up to the root. A folder's index page is the page whose output is the folder's index file: the
 * page in it with a channel's index UID (`index` → `products/index.html`), or — as a UID is unique per project, so
 * only one page can carry the index UID — the page beside the folder named like it (`products` next to `products/`,
 * written as `products/index.html` with directory URLs). Pages in `exclude` (those going offline themselves) never
 * count. `null` when no folder on the way has a published index page.
 */
export function nearestIndexPage(
  source: RedirectSource,
  pages: readonly AssetSummaryView[],
  indexUids: ReadonlySet<string>,
  exclude: ReadonlySet<string>,
): AssetSummaryView | null {
  let folder: string | null = folderOf(source.folderPath);
  const candidate = (page: AssetSummaryView) => !!page.uuid && !exclude.has(page.uuid) && isOnline(page.release ?? null);
  while (folder !== null) {
    const inFolder = folder;
    const parent = parentFolder(inFolder);
    const name = lastSegment(inFolder);
    const hit =
      pages.find((page) => candidate(page) && folderOf(page.folderPath) === inFolder && !!page.uid && indexUids.has(page.uid)) ??
      pages.find((page) => candidate(page) && parent !== null && folderOf(page.folderPath) === parent && !!name && page.uid === name);
    if (hit) {
      return hit;
    }
    folder = parent;
  }
  return null;
}

/**
 * The page every source shares as its nearest published index page — the preselection of a dialog that takes several
 * pages offline; `null` when they differ or none has one.
 */
export function commonIndexPage(
  sources: readonly RedirectSource[],
  pages: readonly AssetSummaryView[],
  indexUids: ReadonlySet<string>,
): AssetSummaryView | null {
  const exclude = new Set(sources.map((source) => source.uuid));
  let common: AssetSummaryView | null = null;
  for (const source of sources) {
    const hit = nearestIndexPage(source, pages, indexUids, exclude);
    if (!hit || (common && common.uuid !== hit.uuid)) {
      return null;
    }
    common = hit;
  }
  return common;
}

/** `/a/b` and `/a/b/` → `/a/b/`; empty → the root `/`. */
function folderOf(path: string | null | undefined): string {
  const trimmed = (path ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** `/a/b/` → `b`; the root has no name. */
function lastSegment(folder: string): string | null {
  const segments = folder.split('/').filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/** `/a/b/` → `/a/`, `/a/` → `/`, `/` → `null` (above the root). */
function parentFolder(folder: string): string | null {
  if (folder === '/') {
    return null;
  }
  const withoutSlash = folder.slice(0, -1);
  const cut = withoutSlash.lastIndexOf('/');
  return cut <= 0 ? '/' : withoutSlash.slice(0, cut + 1);
}
