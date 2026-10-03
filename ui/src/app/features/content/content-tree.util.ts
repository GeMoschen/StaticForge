import type { Crumb } from '../../core/frame/breadcrumb.util';
import type { SfTreeBadge, SfTreeNode } from '../../shared/components/tree/tree-model';
import { type TreeStatusLabels, treeBadge } from '../pages/pages-tree.util';
import { type ReleaseBlock } from '../release/release-status.util';
import { RECORD_SET_TYPE, type FolderView, type RecordSetSummaryView } from './content.service';

/** Tree icon of a record set (M25.5.1). */
export const RECORD_SET_ICON = 'table_rows';

/** Tooltip of a set whose stored query no longer validates against its dataset. */
export const INVALID_QUERY_WARNING = "The set query doesn't match the dataset schema any more — the set shows no records until it is fixed.";

export function isRecordSet(folder: FolderView): boolean {
  return folder.type === RECORD_SET_TYPE;
}

/** A folder or a record set of the Content store — what a tree node and a folder-table row stand for (the id is the uuid). */
export interface ContentEntry {
  readonly kind: 'folder' | 'set';
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  /** A folder: its own stored path (`/content_root/team/`). A set: the stored path of the folder it lives in. */
  readonly path: string;
  readonly release: ReleaseBlock;
  readonly scheduled: boolean;
  readonly revision: number | null;
  /** A set: its dataset (fixed for the set's life); a folder has none. */
  readonly datasetUuid: string | null;
  readonly datasetName: string | null;
  readonly recordCount: number;
  /** `false`: the set's stored query no longer validates against its dataset. */
  readonly queryValid: boolean;
  readonly changedAt: string | null;
}

/**
 * The Content folder tree and the record set list, indexed for the lazily loaded tree and the folder table. The fixed
 * "All Content" wrapper stands for the store root: its children have the parent `null`.
 */
export interface ContentIndex {
  readonly rootUuid: string | null;
  readonly entries: ReadonlyMap<string, ContentEntry>;
  /** The folder an entry lives in; `null` = the store root. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** The uuids directly inside a folder (`null` = the store root): sub-folders and record sets. */
  readonly childrenOf: ReadonlyMap<string | null, readonly string[]>;
}

export const EMPTY_INDEX: ContentIndex = { rootUuid: null, entries: new Map(), parentOf: new Map(), childrenOf: new Map() };

/**
 * Indexes the folder tree (its sole top level entry is the wrapper root; record sets are the leaves) with the set list,
 * which adds what the tree does not carry — the dataset, whether the query is valid and when the set changed. Pure.
 */
export function buildIndex(tree: readonly FolderView[], sets: readonly RecordSetSummaryView[]): ContentIndex {
  const root = tree[0] ?? null;
  const summaries = new Map(sets.flatMap((set) => (set.uuid ? [[set.uuid, set] as const] : [])));
  const entries = new Map<string, ContentEntry>();
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, string[]>();

  const walk = (node: FolderView, parent: string | null, parentPath: string): void => {
    if (!node.uuid) {
      return;
    }
    const entry = isRecordSet(node) ? setEntry(node, summaries.get(node.uuid), parentPath) : folderEntry(node);
    entries.set(node.uuid, entry);
    parentOf.set(node.uuid, parent);
    const siblings = childrenOf.get(parent);
    if (siblings) {
      siblings.push(node.uuid);
    } else {
      childrenOf.set(parent, [node.uuid]);
    }
    for (const child of node.children ?? []) {
      walk(child, node.uuid, node.path ?? parentPath);
    }
  };
  for (const child of root?.children ?? []) {
    walk(child, null, root?.path ?? '');
  }
  return { rootUuid: root?.uuid ?? null, entries, parentOf, childrenOf };
}

function folderEntry(folder: FolderView): ContentEntry {
  return {
    kind: 'folder',
    uuid: folder.uuid!,
    name: folder.displayName ?? folder.uid ?? '',
    uid: folder.uid ?? '',
    path: folder.path ?? '',
    release: folder.release,
    scheduled: (folder.scheduled?.length ?? 0) > 0,
    revision: folder.revision ?? null,
    datasetUuid: null,
    datasetName: null,
    recordCount: 0,
    queryValid: true,
    changedAt: null,
  };
}

function setEntry(set: FolderView, summary: RecordSetSummaryView | undefined, folderPath: string): ContentEntry {
  return {
    kind: 'set',
    uuid: set.uuid!,
    name: set.displayName ?? set.uid ?? '',
    uid: set.uid ?? '',
    path: folderPath,
    release: summary?.release ?? set.release,
    scheduled: ((summary?.scheduled ?? set.scheduled)?.length ?? 0) > 0,
    revision: summary?.revision ?? set.revision ?? null,
    datasetUuid: summary?.dataset?.uuid ?? null,
    datasetName: summary?.dataset?.displayName ?? summary?.dataset?.uid ?? null,
    recordCount: summary?.recordCount ?? set.recordCount ?? 0,
    queryValid: summary?.queryValid !== false,
    changedAt: summary?.changedAt ?? null,
  };
}

/** Whether the store has anything in it (folders or record sets below the wrapper root). */
export function isEmptyIndex(index: ContentIndex): boolean {
  return index.entries.size === 0;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The entries directly inside a folder (`null` = the store root): the sub-folders first, then the record sets, each by name. Pure. */
export function childEntries(index: ContentIndex, parentId: string | null): ContentEntry[] {
  const entries = (index.childrenOf.get(parentId) ?? []).flatMap((uuid) => {
    const entry = index.entries.get(uuid);
    return entry ? [entry] : [];
  });
  return [...entries.filter((entry) => entry.kind === 'folder').sort(byName), ...entries.filter((entry) => entry.kind === 'set').sort(byName)];
}

export interface ContentNodeOptions {
  /** Developer mode shows the UID beside the name (decision 19). */
  readonly dev: boolean;
  readonly locale: string | null;
  readonly labels: TreeStatusLabels;
  /** The text of the badge on a set whose query no longer validates. */
  readonly invalidQuery: string;
}

function nodeOf(entry: ContentEntry, index: ContentIndex, options: ContentNodeOptions): SfTreeNode<ContentEntry> {
  const folder = entry.kind === 'folder';
  const badges: SfTreeBadge[] = [];
  if (!folder) {
    badges.push({ kind: 'badge', label: String(entry.recordCount) });
    if (!entry.queryValid) {
      badges.push({ kind: 'status', tone: 'warning', icon: 'warning', label: options.invalidQuery });
    }
  }
  const status = treeBadge(entry.release, entry.scheduled, options.locale, options.labels);
  if (status) {
    badges.push(status);
  }
  return {
    id: entry.uuid,
    label: entry.name,
    icon: folder ? 'folder' : RECORD_SET_ICON,
    secondary: options.dev ? entry.uid : null,
    badges,
    hasChildren: folder && (index.childrenOf.get(entry.uuid)?.length ?? 0) > 0,
    droppable: folder,
    data: entry,
  };
}

/** The tree nodes directly inside `parentId` (`null` = the store root). */
export function childNodes(index: ContentIndex, parentId: string | null, options: ContentNodeOptions): SfTreeNode<ContentEntry>[] {
  return childEntries(index, parentId).map((entry) => nodeOf(entry, index, options));
}

/** The ids from the top down to `id` (inclusive); empty for an unknown id. */
export function idPath(index: ContentIndex, id: string): string[] {
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
 * The server-filter answer for a query: the root-to-match id path of every folder and record set whose name or UID
 * contains it (case-insensitive). The whole store is in memory, so the tree's filter is answered locally. Pure.
 */
export function searchPaths(index: ContentIndex, query: string): string[][] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const paths: string[][] = [];
  for (const entry of index.entries.values()) {
    if (entry.name.toLowerCase().includes(needle) || entry.uid.toLowerCase().includes(needle)) {
      paths.push(idPath(index, entry.uuid));
    }
  }
  return paths;
}

/** The uuid of the record set in an app URL (`/p/acme/content/sets/<uuid>?…`), or `null`. */
export function setUuidFromUrl(url: string): string | null {
  const match = /\/content\/sets\/([^/?#;]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Whether an app URL is one of the Content area's child screens: a record set or a record. */
export function isChildRoute(url: string): boolean {
  return /\/content\/(sets|records)\/[^/?#;]/.test(url);
}

/** The folders from the top level down to `uuid` (inclusive); empty for an unknown uuid. Record sets are skipped. */
export function folderChain(tree: readonly FolderView[], uuid: string, chain: readonly FolderView[] = []): FolderView[] {
  for (const node of tree) {
    if (isRecordSet(node)) {
      continue;
    }
    const next = [...chain, node];
    if (node.uuid === uuid) {
      return next;
    }
    const found = folderChain(node.children ?? [], uuid, next);
    if (found.length > 0) {
      return found;
    }
  }
  return [];
}

/** The breadcrumb of an open folder or set: the folders above it as links (the wrapper root is the area itself). */
export function folderTrail(chain: readonly FolderView[], projectKey: string, rootUuid: string | null): Crumb[] {
  return chain
    .filter((folder) => folder.uuid !== rootUuid)
    .map((folder) => ({
      id: folder.uuid ?? '',
      label: folder.displayName ?? folder.uid ?? '',
      link: ['/p', projectKey, 'content'],
      queryParams: { folder: folder.uuid ?? '' },
    }));
}

/** The folder tree without its record sets, as the "Move to…" dialog shows it: a set can only go into a folder. */
export function foldersOnly(tree: readonly FolderView[]): FolderView[] {
  return tree
    .filter((node) => !isRecordSet(node))
    .map((node) => ({ ...node, children: foldersOnly(node.children ?? []) }));
}

/**
 * A Content folder tree node's stored `path` → its store-relative path: `/content_root/team/leads/` →
 * `/team/leads/`; the root itself and nothing selected → `/`. Only for folder tree paths: a record's or set's
 * `folderPath` already arrives store-relative (see {@link storeFolderPath}).
 */
export function relativeFolderPath(storedPath: string | null | undefined): string {
  const root = '/content_root/';
  if (!storedPath || !storedPath.startsWith(root)) {
    return '/';
  }
  return '/' + storedPath.slice(root.length);
}

/**
 * A record's or record set's `folderPath` as the REST API sends it: already relative to the Content store
 * (`/team/leads/`, `/` for the store root — the server's `ContentStorePaths.relative`, the path templates and
 * the `folder=` filters use). Only a missing value needs a default; running it through
 * {@link relativeFolderPath} would turn every path into `/`.
 */
export function storeFolderPath(apiPath: string | null | undefined): string {
  return apiPath && apiPath.startsWith('/') ? apiPath : '/';
}

/** One choice of the record "Move to…" dialog. */
export interface MoveTarget {
  /** The folder or set to move into; `null` is the store root. */
  uuid: string | null;
  label: string;
  /** Secondary text, e.g. the folder a set lives in. */
  detail?: string;
  /** Indentation level (folders nest). */
  depth: number;
  /** Where the asset already is: listed, but not choosable. */
  current: boolean;
}

/**
 * Where a record set can move with the record set view's "Move to…" dialog (M25.5.1): the store root and every Content
 * folder — never another record set, which holds only records.
 */
export function folderMoveTargets(root: FolderView | null, currentFolderUuid: string | null | undefined): MoveTarget[] {
  if (!root) {
    return [];
  }
  const targets: MoveTarget[] = [
    { uuid: null, label: 'All content', depth: 0, current: currentFolderUuid == null || currentFolderUuid === root.uuid },
  ];
  const walk = (children: FolderView[], depth: number) => {
    for (const child of children) {
      if (isRecordSet(child) || !child.uuid) {
        continue;
      }
      targets.push({
        uuid: child.uuid,
        label: child.displayName ?? child.uid ?? '',
        depth,
        current: child.uuid === currentFolderUuid,
      });
      walk(child.children ?? [], depth + 1);
    }
  };
  walk(root.children ?? [], 1);
  return targets;
}

/**
 * Where a record can move (M25.5.1): only the live record sets of its own dataset — the server
 * rejects any other target (`SF-DOM-0104`).
 */
export function recordMoveTargets(
  sets: readonly RecordSetSummaryView[],
  datasetUuid: string | null | undefined,
  currentSetUuid: string | null | undefined,
): MoveTarget[] {
  if (!datasetUuid) {
    return [];
  }
  return sets
    .filter((set) => set.uuid && set.dataset?.uuid === datasetUuid)
    .map((set) => ({
      uuid: set.uuid!,
      label: set.displayName ?? set.uid ?? '',
      detail: storeFolderPath(set.folderPath),
      depth: 0,
      current: set.uuid === currentSetUuid,
    }));
}
