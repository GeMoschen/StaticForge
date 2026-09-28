import type { components } from '../../core/api/generated/schema.d.ts';
import { isOnline } from './release-status.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type FolderView = components['schemas']['FolderView'];

/** Each pages folder's start page (M31): folder path (`/pages_root/products/`) → page uuid. */
export type StartPagesByFolder = ReadonlyMap<string, string>;

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

/** The start pages of a pages folder tree (`GET /folders?scope=PAGES`), keyed by folder path. */
export function startPagesByFolder(tree: readonly FolderView[]): Map<string, string> {
  const byFolder = new Map<string, string>();
  const visit = (nodes: readonly FolderView[]) => {
    for (const node of nodes) {
      if (node.startPageUuid && node.path) {
        byFolder.set(folderOf(node.path), node.startPageUuid);
      }
      visit(node.children ?? []);
    }
  };
  visit(tree);
  return byFolder;
}

/**
 * The index page of the nearest folder above `source` that has one online (M30.6.3), starting with the page's own
 * folder and walking up to the root. A folder's index page is the page whose output is the folder's index file
 * (M31): its start page, while that page is in the folder and stays online; otherwise the page in it with a channel's
 * index UID (`index` → `products/index.html`) — the fallback a folder without an online start page renders with. Pages
 * in `exclude` (those going offline themselves) never count. `null` when no folder on the way has a published index
 * page.
 */
export function nearestIndexPage(
  source: RedirectSource,
  pages: readonly AssetSummaryView[],
  indexUids: ReadonlySet<string>,
  startPages: StartPagesByFolder,
  exclude: ReadonlySet<string>,
): AssetSummaryView | null {
  let folder: string | null = folderOf(source.folderPath);
  const candidate = (page: AssetSummaryView, inFolder: string) =>
    !!page.uuid && !exclude.has(page.uuid) && isOnline(page.release ?? null) && folderOf(page.folderPath) === inFolder;
  while (folder !== null) {
    const inFolder = folder;
    const startPage = startPages.get(inFolder);
    const hit =
      (startPage ? pages.find((page) => page.uuid === startPage && candidate(page, inFolder)) : undefined) ??
      pages.find((page) => candidate(page, inFolder) && !!page.uid && indexUids.has(page.uid));
    if (hit) {
      return hit;
    }
    folder = parentFolder(inFolder);
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
  startPages: StartPagesByFolder,
): AssetSummaryView | null {
  const exclude = new Set(sources.map((source) => source.uuid));
  let common: AssetSummaryView | null = null;
  for (const source of sources) {
    const hit = nearestIndexPage(source, pages, indexUids, startPages, exclude);
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

/** `/a/b/` → `/a/`, `/a/` → `/`, `/` → `null` (above the root). */
function parentFolder(folder: string): string | null {
  if (folder === '/') {
    return null;
  }
  const withoutSlash = folder.slice(0, -1);
  const cut = withoutSlash.lastIndexOf('/');
  return cut <= 0 ? '/' : withoutSlash.slice(0, cut + 1);
}
