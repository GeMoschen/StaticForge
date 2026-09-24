import type { StoreTreeNode } from '../../shared/components/sf-store-tree-node.component';
import { RECORD_SET_TYPE, type FolderView, type RecordSetSummaryView } from './content.service';

/** Tree icon of a record set leaf (M25.5.1). */
export const RECORD_SET_ICON = 'table_rows';

/** Tooltip of a set whose stored query no longer validates against its dataset. */
export const INVALID_QUERY_WARNING = "The set query doesn't match the dataset schema any more — the set shows no records until it is fixed.";

export function isRecordSet(folder: FolderView): boolean {
  return folder.type === RECORD_SET_TYPE;
}

/**
 * The Content tree below the fixed root (M25.5.1): folders first, then the record sets in them as
 * leaves with their record count and — from the set list, since the folder tree doesn't carry it —
 * a warning when the set's query is invalid.
 */
export function contentTreeNodes(
  root: FolderView | null,
  sets: ReadonlyMap<string, RecordSetSummaryView>,
): StoreTreeNode[] {
  return childNodes(root?.children ?? [], sets);
}

function childNodes(children: FolderView[], sets: ReadonlyMap<string, RecordSetSummaryView>): StoreTreeNode[] {
  const folders = children.filter((child) => !isRecordSet(child)).map((folder) => folderNode(folder, sets));
  const leaves = children.filter(isRecordSet).map((set) => setNode(set, sets.get(set.uuid ?? '')));
  return [...folders, ...leaves];
}

function folderNode(folder: FolderView, sets: ReadonlyMap<string, RecordSetSummaryView>): StoreTreeNode {
  return {
    uuid: folder.uuid,
    uid: folder.uid,
    displayName: folder.displayName,
    kind: 'FOLDER',
    protectedFolder: folder.protectedFolder === true,
    revision: folder.revision,
    children: childNodes(folder.children ?? [], sets),
  };
}

function setNode(set: FolderView, summary: RecordSetSummaryView | undefined): StoreTreeNode {
  const count = summary?.recordCount ?? set.recordCount ?? 0;
  return {
    uuid: set.uuid,
    uid: set.uid,
    displayName: set.displayName,
    kind: 'LEAF',
    icon: RECORD_SET_ICON,
    badge: { text: String(count), label: `${count} ${count === 1 ? 'record' : 'records'}` },
    warning: summary?.queryValid === false ? INVALID_QUERY_WARNING : undefined,
    revision: summary?.revision,
  };
}

/** A folder anywhere in the tree by uuid (record sets included). */
export function findFolder(nodes: FolderView[], uuid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const found = findFolder(node.children ?? [], uuid);
    if (found) {
      return found;
    }
  }
  return null;
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

/** One choice of a "Move to…" dialog. */
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
 * Where a record set can move (M25.5.1): the store root and every Content folder — never another
 * record set, which holds only records.
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

/** The delete confirmation of a record set: a non-empty set says how many records go with it. */
export function deleteSetQuestion(name: string, recordCount: number): string {
  if (recordCount <= 0) {
    return `Delete the record set "${name}"? You can restore it from its history.`;
  }
  const records = recordCount === 1 ? '1 record' : `${recordCount} records`;
  return `Delete the record set "${name}" and its ${records}? Restoring the set from its history brings them back.`;
}
