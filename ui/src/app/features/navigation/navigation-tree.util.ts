import type { components } from '../../core/api/generated/schema.d.ts';
import type { Crumb } from '../../core/frame/breadcrumb.util';
import type { SfTreeNode } from '../../shared/components/tree/tree-model';
import { type TreeStatusLabels, treeBadge } from '../pages/pages-tree.util';
import type { ReleaseBlock } from '../release/release-status.util';
import type { NavTreeView } from './navigation.service';

type FolderView = components['schemas']['FolderView'];

/** A menu folder or a menu item (a page reference) — what a tree node and a folder-table row stand for (the id is the uuid). */
export interface NavEntry {
  readonly kind: 'folder' | 'item';
  readonly uuid: string;
  /** What the menu shows: an item's label (else its target page's name), a folder's name. */
  readonly label: string;
  /** The asset's own name (what an item is called internally). */
  readonly displayName: string;
  readonly uid: string;
  /** The page the entry leads to (an item's target, a folder's entry page's target); `null` while there is none. */
  readonly targetUuid: string | null;
  readonly targetName: string | null;
  readonly release: ReleaseBlock;
  readonly scheduled: boolean;
  readonly revision: number | null;
}

/**
 * The navigation forest, indexed for the lazily loaded tree and the folder table. The fixed "All Navigation" wrapper
 * stands for the menu's top level: its children have the parent `null`. Children keep the order the server returned
 * them in — the stored menu order (M35.22) — never sorted here.
 */
export interface NavIndex {
  readonly rootUuid: string | null;
  /** The wrapper's revision: the `If-Match` of a reorder at the top level. */
  readonly rootRevision: number | null;
  readonly entries: ReadonlyMap<string, NavEntry>;
  /** The folder an entry lives in; `null` = the top level. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** The uuids directly inside a folder (`null` = the top level), in menu order. */
  readonly childrenOf: ReadonlyMap<string | null, readonly string[]>;
}

export const EMPTY_NAV_INDEX: NavIndex = {
  rootUuid: null,
  rootRevision: null,
  entries: new Map(),
  parentOf: new Map(),
  childrenOf: new Map(),
};

function entryOf(node: NavTreeView): NavEntry {
  const folder = node.type === 'FOLDER';
  const displayName = node.displayName ?? node.uid ?? '';
  return {
    kind: folder ? 'folder' : 'item',
    uuid: node.uuid!,
    label: (folder ? displayName : node.label) || displayName,
    displayName,
    uid: node.uid ?? '',
    targetUuid: node.resolvedPageUuid ?? null,
    targetName: node.resolvedPageName ?? null,
    release: node.release,
    scheduled: (node.scheduled?.length ?? 0) > 0,
    revision: node.revision ?? null,
  };
}

/** Indexes the forest (its sole top-level entry is the wrapper root). Pure. */
export function buildNavIndex(forest: readonly NavTreeView[]): NavIndex {
  const root = forest[0] ?? null;
  const entries = new Map<string, NavEntry>();
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, string[]>();
  const walk = (node: NavTreeView, parent: string | null): void => {
    if (!node.uuid) {
      return;
    }
    entries.set(node.uuid, entryOf(node));
    parentOf.set(node.uuid, parent);
    const siblings = childrenOf.get(parent);
    if (siblings) {
      siblings.push(node.uuid);
    } else {
      childrenOf.set(parent, [node.uuid]);
    }
    for (const child of node.children ?? []) {
      walk(child, node.uuid);
    }
  };
  for (const child of root?.children ?? []) {
    walk(child, null);
  }
  return { rootUuid: root?.uuid ?? null, rootRevision: root?.revision ?? null, entries, parentOf, childrenOf };
}

/** Whether the menu has anything in it. */
export function isEmptyNavIndex(index: NavIndex): boolean {
  return index.entries.size === 0;
}

/** The entries directly inside a folder (`null` = the top level), in menu order. Pure. */
export function navChildren(index: NavIndex, parentId: string | null): NavEntry[] {
  return (index.childrenOf.get(parentId) ?? []).flatMap((uuid) => {
    const entry = index.entries.get(uuid);
    return entry ? [entry] : [];
  });
}

/** The revision a write to `folderId`'s order sends as `If-Match` (`null` = the wrapper). */
export function folderRevision(index: NavIndex, folderId: string | null): number | null {
  return folderId === null ? index.rootRevision : (index.entries.get(folderId)?.revision ?? null);
}

/**
 * The uuids of `parentId`'s children after `uuid` is put at `position` among them (`uuid` leaves the folder it was in,
 * if another): what a reorder stores. A position past the end appends. Pure.
 */
export function orderWith(index: NavIndex, parentId: string | null, uuid: string, position: number): string[] {
  const siblings = (index.childrenOf.get(parentId) ?? []).filter((id) => id !== uuid);
  siblings.splice(Math.max(0, Math.min(position, siblings.length)), 0, uuid);
  return siblings;
}

/** The public URLs per page uuid (from the URL registry), used to say where an entry leads. */
export type NavUrls = ReadonlyMap<string, string>;

export interface NavNodeOptions {
  /** Developer mode shows the UID beside the name (decision 19). */
  readonly dev: boolean;
  readonly locale: string | null;
  readonly labels: TreeStatusLabels;
  readonly urls: NavUrls;
}

/** The public URL an entry leads to, `null` while it has none or none is known yet. */
export function entryUrl(entry: NavEntry, urls: NavUrls): string | null {
  return entry.targetUuid ? (urls.get(entry.targetUuid) ?? null) : null;
}

/**
 * "Company → /about-us/": the tree shows the label and, after it, where the entry leads — the public URL, else the
 * target page's name while no URL is registered yet (a menu that was never built or previewed). The developer-mode UID
 * follows. Pure.
 */
export function navSecondary(entry: NavEntry, options: Pick<NavNodeOptions, 'dev' | 'urls'>): string | null {
  const where = entryUrl(entry, options.urls) ?? entry.targetName;
  const parts = [where ? `→ ${where}` : null, options.dev ? entry.uid : null].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('  ·  ') : null;
}

function nodeOf(entry: NavEntry, index: NavIndex, options: NavNodeOptions): SfTreeNode<NavEntry> {
  const folder = entry.kind === 'folder';
  const status = treeBadge(entry.release, entry.scheduled, options.locale, options.labels);
  return {
    id: entry.uuid,
    label: entry.label,
    icon: folder ? 'folder' : 'link',
    secondary: navSecondary(entry, options),
    badges: status ? [status] : [],
    hasChildren: folder && (index.childrenOf.get(entry.uuid)?.length ?? 0) > 0,
    droppable: folder,
    data: entry,
  };
}

/** The tree nodes directly inside `parentId` (`null` = the top level), in menu order. */
export function navNodes(index: NavIndex, parentId: string | null, options: NavNodeOptions): SfTreeNode<NavEntry>[] {
  return navChildren(index, parentId).map((entry) => nodeOf(entry, index, options));
}

/** The ids from the top down to `id` (inclusive); empty for an unknown id. */
export function navIdPath(index: NavIndex, id: string): string[] {
  const path: string[] = [];
  let current: string | null | undefined = id;
  while (current != null) {
    if (!index.entries.has(current)) {
      return [];
    }
    path.unshift(current);
    current = index.parentOf.get(current);
  }
  return path;
}

/**
 * The server-filter answer for a query: the root-to-match id path of every entry whose label, target page, public URL
 * or UID contains it (case-insensitive). The whole menu is in memory, so the tree's filter is answered locally. Pure.
 */
export function navSearchPaths(index: NavIndex, query: string, urls: NavUrls): string[][] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const paths: string[][] = [];
  for (const entry of index.entries.values()) {
    const haystack = [entry.label, entry.displayName, entry.uid, entry.targetName, entryUrl(entry, urls)];
    if (haystack.some((text) => text?.toLowerCase().includes(needle))) {
      paths.push(navIdPath(index, entry.uuid));
    }
  }
  return paths;
}

/** The breadcrumb of an open entry: the folders above it as links (the wrapper root is the area itself). */
export function navTrail(index: NavIndex, uuid: string, projectKey: string): Crumb[] {
  return navIdPath(index, uuid)
    .slice(0, -1)
    .map((id) => ({
      id,
      label: index.entries.get(id)?.label ?? '',
      link: ['/p', projectKey, 'navigation'],
      queryParams: { asset: id },
    }));
}

/**
 * The menu folders in the shape of the "Move to…" dialog's tree, the wrapper as its single entry (items are left out; an
 * item can only go into a folder).
 */
export function navFolderTree(forest: readonly NavTreeView[]): FolderView[] {
  const only = (nodes: readonly NavTreeView[]): FolderView[] =>
    nodes
      .filter((node) => node.type === 'FOLDER')
      .map((node) => ({ uuid: node.uuid, uid: node.uid, displayName: node.displayName, children: only(node.children ?? []) }));
  return only(forest);
}

/** The stored path of the wrapper root; every navigation path starts with it (`/navigation_root/company/`). */
export const NAV_ROOT_PATH = '/navigation_root/';

/**
 * The folder path the API reports for an entry: a folder's own path, an item's the path of the folder it lives in. The
 * path segments are the folders' UIDs, so it can be built from the index (favorites need it to find a folder's contents
 * and the store a favorite belongs to).
 */
export function entryFolderPath(index: NavIndex, entry: NavEntry): string {
  const folders = navIdPath(index, entry.uuid).filter((id) => id !== entry.uuid || entry.kind === 'folder');
  return NAV_ROOT_PATH + folders.map((id) => `${index.entries.get(id)?.uid ?? id}/`).join('');
}
