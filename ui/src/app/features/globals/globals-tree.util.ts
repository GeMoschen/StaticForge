import type { SfTreeBadge, SfTreeNode } from '../../shared/components/tree/tree-model';
import { type TreeStatusLabels, treeBadge } from '../pages/pages-tree.util';
import type { ReleaseBlock } from '../release/release-status.util';
import type { FolderView, GlobalSetSummaryView } from './globals.service';

/** Tree icon of a global set. */
export const GLOBAL_SET_ICON = 'tune';

/** A folder or a global set of the Globals store — what a tree node stands for (the id is the uuid). */
export interface GlobalEntry {
  readonly kind: 'folder' | 'set';
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  /** A folder: its own stored path. A set: the stored path of the folder it lives in. */
  readonly path: string;
  readonly release: ReleaseBlock;
  readonly scheduled: boolean;
  readonly revision: number | null;
}

/**
 * The Globals folder tree and the set list, indexed for the lazily loaded tree. The fixed "All Globals" wrapper stands
 * for the store root: its children have the parent `null`. The folder endpoint carries folders only, so the sets are
 * bucketed into them by `folderPath`.
 */
export interface GlobalsIndex {
  readonly rootUuid: string | null;
  readonly entries: ReadonlyMap<string, GlobalEntry>;
  /** The folder an entry lives in; `null` = the store root. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** The uuids directly inside a folder (`null` = the store root). */
  readonly childrenOf: ReadonlyMap<string | null, readonly string[]>;
}

export const EMPTY_INDEX: GlobalsIndex = { rootUuid: null, entries: new Map(), parentOf: new Map(), childrenOf: new Map() };

/** Indexes the folder tree (its sole top level entry is the wrapper root) and the sets that live in its folders. Pure. */
export function buildIndex(tree: readonly FolderView[], sets: readonly GlobalSetSummaryView[]): GlobalsIndex {
  const root = tree[0] ?? null;
  const entries = new Map<string, GlobalEntry>();
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, string[]>();
  const byPath = new Map<string, GlobalSetSummaryView[]>();
  for (const set of sets) {
    const bucket = byPath.get(set.folderPath ?? '');
    if (bucket) {
      bucket.push(set);
    } else {
      byPath.set(set.folderPath ?? '', [set]);
    }
  }

  const add = (entry: GlobalEntry, parent: string | null): void => {
    entries.set(entry.uuid, entry);
    parentOf.set(entry.uuid, parent);
    const siblings = childrenOf.get(parent);
    if (siblings) {
      siblings.push(entry.uuid);
    } else {
      childrenOf.set(parent, [entry.uuid]);
    }
  };
  const walk = (folder: FolderView, parent: string | null): void => {
    if (!folder.uuid) {
      return;
    }
    add(folderEntry(folder), parent);
    for (const child of folder.children ?? []) {
      walk(child, folder.uuid);
    }
    addSets(folder, folder.uuid);
  };
  const addSets = (folder: FolderView, parent: string | null): void => {
    for (const set of byPath.get(folder.path ?? '') ?? []) {
      if (set.uuid) {
        add(setEntry(set), parent);
      }
    }
  };
  for (const child of root?.children ?? []) {
    walk(child, null);
  }
  if (root) {
    addSets(root, null);
  }
  return { rootUuid: root?.uuid ?? null, entries, parentOf, childrenOf };
}

function folderEntry(folder: FolderView): GlobalEntry {
  return {
    kind: 'folder',
    uuid: folder.uuid!,
    name: folder.displayName ?? folder.uid ?? '',
    uid: folder.uid ?? '',
    path: folder.path ?? '',
    release: folder.release,
    scheduled: (folder.scheduled?.length ?? 0) > 0,
    revision: folder.revision ?? null,
  };
}

function setEntry(set: GlobalSetSummaryView): GlobalEntry {
  return {
    kind: 'set',
    uuid: set.uuid!,
    name: set.displayName ?? set.uid ?? '',
    uid: set.uid ?? '',
    path: set.folderPath ?? '',
    release: set.release,
    scheduled: (set.scheduled?.length ?? 0) > 0,
    revision: set.revision ?? null,
  };
}

export function isEmptyIndex(index: GlobalsIndex): boolean {
  return index.entries.size === 0;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** The entries directly inside a folder (`null` = the store root): sub-folders first, then sets, each by name. Pure. */
export function childEntries(index: GlobalsIndex, parentId: string | null): GlobalEntry[] {
  const entries = (index.childrenOf.get(parentId) ?? []).flatMap((uuid) => {
    const entry = index.entries.get(uuid);
    return entry ? [entry] : [];
  });
  return [...entries.filter((entry) => entry.kind === 'folder').sort(byName), ...entries.filter((entry) => entry.kind === 'set').sort(byName)];
}

export interface GlobalsNodeOptions {
  /** Developer mode shows the UID beside the name. */
  readonly dev: boolean;
  readonly locale: string | null;
  readonly labels: TreeStatusLabels;
}

function nodeOf(entry: GlobalEntry, index: GlobalsIndex, options: GlobalsNodeOptions): SfTreeNode<GlobalEntry> {
  const folder = entry.kind === 'folder';
  const badges: SfTreeBadge[] = [];
  const status = treeBadge(entry.release, entry.scheduled, options.locale, options.labels);
  if (status) {
    badges.push(status);
  }
  return {
    id: entry.uuid,
    label: entry.name,
    icon: folder ? 'folder' : GLOBAL_SET_ICON,
    secondary: options.dev ? entry.uid : null,
    badges,
    hasChildren: folder && (index.childrenOf.get(entry.uuid)?.length ?? 0) > 0,
    droppable: folder,
    data: entry,
  };
}

/** The tree nodes directly inside `parentId` (`null` = the store root). */
export function childNodes(index: GlobalsIndex, parentId: string | null, options: GlobalsNodeOptions): SfTreeNode<GlobalEntry>[] {
  return childEntries(index, parentId).map((entry) => nodeOf(entry, index, options));
}

/** The ids from the top down to `id` (inclusive); empty for an unknown id. */
export function idPath(index: GlobalsIndex, id: string): string[] {
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

/** The root-to-match id path of every folder and set whose name or UID contains the query (case-insensitive). Pure. */
export function searchPaths(index: GlobalsIndex, query: string): string[][] {
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

/** The folder tree without sets (the "Move to…" dialog's choices). */
export function foldersOnly(tree: readonly FolderView[]): FolderView[] {
  return tree.map((node) => ({ ...node, children: foldersOnly(node.children ?? []) }));
}
