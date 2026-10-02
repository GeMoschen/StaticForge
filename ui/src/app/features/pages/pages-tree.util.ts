import type { components } from '../../core/api/generated/schema.d.ts';
import type { SfStatusTone } from '../../shared/components/display/sf-status.component';
import type { SfTreeBadge, SfTreeNode } from '../../shared/components/tree/tree-model';
import { type ReleaseBlock, statusFor } from '../release/release-status.util';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** What a node of the Pages tree stands for (the node id is the uuid). */
export interface PageNodeData {
  readonly kind: 'folder' | 'page';
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  /** A folder: its own path. A page: the folder it lives in. */
  readonly path: string;
  readonly release: ReleaseBlock;
  readonly revision: number | null;
  readonly scheduled: boolean;
}

/** The folder tree and the pages, indexed for the lazily loaded tree. The fixed "All Pages" wrapper stands for the root. */
export interface PagesIndex {
  readonly rootUuid: string | null;
  readonly folders: ReadonlyMap<string, FolderView>;
  readonly pages: ReadonlyMap<string, AssetSummaryView>;
  /** The folder a folder or page lives in; `null` = the project root. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  readonly pagesByPath: ReadonlyMap<string, readonly AssetSummaryView[]>;
}

export const EMPTY_INDEX: PagesIndex = {
  rootUuid: null,
  folders: new Map(),
  pages: new Map(),
  parentOf: new Map(),
  pagesByPath: new Map(),
};

/** Indexes the store's folder tree (its sole top level entry is the wrapper root) and the page list. Pure. */
export function buildIndex(tree: readonly FolderView[], pageList: readonly AssetSummaryView[]): PagesIndex {
  const root = tree[0] ?? null;
  const folders = new Map<string, FolderView>();
  const pages = new Map<string, AssetSummaryView>();
  const parentOf = new Map<string, string | null>();
  const pagesByPath = new Map<string, AssetSummaryView[]>();
  const rootUuid = root?.uuid ?? null;

  const walk = (folder: FolderView, parent: string | null): void => {
    if (!folder.uuid) {
      return;
    }
    folders.set(folder.uuid, folder);
    parentOf.set(folder.uuid, parent);
    for (const child of folder.children ?? []) {
      walk(child, folder.uuid);
    }
  };
  for (const child of root?.children ?? []) {
    walk(child, null);
  }

  const byPath = new Map<string, string | null>([[root?.path ?? '/', null]]);
  for (const [uuid, folder] of folders) {
    byPath.set(folder.path ?? '', uuid);
  }
  for (const page of pageList) {
    if (!page.uuid || page.type === 'FOLDER') {
      continue;
    }
    const path = page.folderPath ?? root?.path ?? '/';
    pages.set(page.uuid, page);
    parentOf.set(page.uuid, byPath.get(path) ?? null);
    const list = pagesByPath.get(path);
    if (list) {
      list.push(page);
    } else {
      pagesByPath.set(path, [page]);
    }
  }
  return { rootUuid, folders, pages, parentOf, pagesByPath };
}

/** Whether the project has anything in the Pages store (pages or folders below the wrapper root). */
export function isEmptyIndex(index: PagesIndex): boolean {
  return index.folders.size === 0 && index.pages.size === 0;
}

/** The release status of a page for the tree: nothing for a released one (the common case), else a status with an icon and text. */
export interface TreeStatusLabels {
  readonly released: string;
  readonly changed: string;
  readonly draft: string;
  readonly scheduled: string;
  readonly unpublished: string;
  readonly deletion: string;
}

const TONES: Record<string, SfStatusTone> = {
  changed: 'warning',
  draft: 'neutral',
  scheduled: 'info',
  unpublished: 'info',
  deletion: 'danger',
};

const ICONS: Record<string, string> = {
  changed: 'edit',
  draft: 'radio_button_unchecked',
  scheduled: 'schedule',
  unpublished: 'cloud_off',
  deletion: 'delete_forever',
};

/**
 * The badge a tree row shows for a page or folder in the editing language: a status — Changed, Draft, Scheduled, … —
 * with its icon and text, none for a released one (a tree full of "Released" is noise). Pure.
 */
export function treeBadge(
  release: ReleaseBlock,
  scheduled: boolean,
  locale: string | null,
  labels: TreeStatusLabels,
): SfTreeBadge | null {
  const status = statusFor(release, locale);
  let key: keyof TreeStatusLabels | null;
  switch (status) {
    case 'NEW':
      key = 'draft';
      break;
    case 'CHANGED':
      key = 'changed';
      break;
    case 'UNPUBLISHED':
      key = 'unpublished';
      break;
    case 'DELETION_PENDING':
      key = 'deletion';
      break;
    default:
      key = scheduled ? 'scheduled' : null;
  }
  return key === null
    ? null
    : { label: labels[key], tone: TONES[key], icon: ICONS[key], kind: 'status' };
}

export interface TreeNodeOptions {
  /** Developer mode shows the UID beside the name (decision 19). */
  readonly dev: boolean;
  readonly locale: string | null;
  readonly labels: TreeStatusLabels;
}

function folderNode(index: PagesIndex, folder: FolderView, options: TreeNodeOptions): SfTreeNode<PageNodeData> {
  const path = folder.path ?? '';
  return {
    id: folder.uuid!,
    label: folder.displayName ?? folder.uid ?? '',
    icon: 'folder',
    secondary: options.dev ? (folder.uid ?? null) : null,
    badges: badgeList(folder.release, (folder.scheduled?.length ?? 0) > 0, options),
    hasChildren: (folder.children?.length ?? 0) > 0 || (index.pagesByPath.get(path)?.length ?? 0) > 0,
    droppable: true,
    data: {
      kind: 'folder',
      uuid: folder.uuid!,
      name: folder.displayName ?? folder.uid ?? '',
      uid: folder.uid ?? '',
      path,
      release: folder.release,
      revision: folder.revision ?? null,
      scheduled: (folder.scheduled?.length ?? 0) > 0,
    },
  };
}

function pageNode(page: AssetSummaryView, options: TreeNodeOptions): SfTreeNode<PageNodeData> {
  return {
    id: page.uuid!,
    label: page.displayName ?? page.uid ?? '',
    icon: 'description',
    secondary: options.dev ? (page.uid ?? null) : null,
    badges: badgeList(page.release, (page.scheduled?.length ?? 0) > 0, options),
    hasChildren: false,
    droppable: false,
    data: {
      kind: 'page',
      uuid: page.uuid!,
      name: page.displayName ?? page.uid ?? '',
      uid: page.uid ?? '',
      path: page.folderPath ?? '',
      release: page.release,
      revision: page.revision ?? null,
      scheduled: (page.scheduled?.length ?? 0) > 0,
    },
  };
}

function badgeList(release: ReleaseBlock, scheduled: boolean, options: TreeNodeOptions): SfTreeBadge[] {
  const badge = treeBadge(release, scheduled, options.locale, options.labels);
  return badge ? [badge] : [];
}

/** The folders and pages directly inside `parentId` (`null` = the root). */
export function childNodes(index: PagesIndex, parentId: string | null, options: TreeNodeOptions): SfTreeNode<PageNodeData>[] {
  const root = parentId === null;
  const folder = root ? null : (index.folders.get(parentId) ?? null);
  if (!root && !folder) {
    return [];
  }
  const subfolders = root ? [...index.folders.values()].filter((f) => index.parentOf.get(f.uuid!) === null) : (folder!.children ?? []);
  const pages = root
    ? [...index.pages.values()].filter((page) => index.parentOf.get(page.uuid!) === null)
    : (index.pagesByPath.get(folder!.path ?? '') ?? []);
  return [
    ...subfolders.filter((f) => !!f.uuid).map((f) => folderNode(index, f, options)),
    ...pages.map((p) => pageNode(p, options)),
  ];
}

/** The ids from the top down to `id` (inclusive); empty for an unknown id. */
export function idPath(index: PagesIndex, id: string): string[] {
  const path: string[] = [];
  let current: string | null | undefined = id;
  while (current != null) {
    if (!index.folders.has(current) && !index.pages.has(current)) {
      return [];
    }
    path.unshift(current);
    current = index.parentOf.get(current);
  }
  return path;
}

/**
 * The server-filter answer for a query: the root-to-match id path of every page and folder whose name or UID contains
 * it (case-insensitive). The whole store is in memory, so this is answered locally. Pure.
 */
export function searchPaths(index: PagesIndex, query: string): string[][] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  const matches = (name: string | undefined, uid: string | undefined): boolean =>
    (name ?? '').toLowerCase().includes(needle) || (uid ?? '').toLowerCase().includes(needle);
  const paths: string[][] = [];
  for (const folder of index.folders.values()) {
    if (matches(folder.displayName, folder.uid)) {
      paths.push(idPath(index, folder.uuid!));
    }
  }
  for (const page of index.pages.values()) {
    if (matches(page.displayName, page.uid)) {
      paths.push(idPath(index, page.uuid!));
    }
  }
  return paths;
}

/** The uuid of the page in an app URL (`/p/acme/pages/<uuid>?…`), or `null`. */
export function pageUuidFromUrl(url: string): string | null {
  const match = /\/pages\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(url);
  return match ? match[1] : null;
}
