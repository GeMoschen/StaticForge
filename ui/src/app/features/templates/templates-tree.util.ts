import type { components } from '../../core/api/generated/schema.d.ts';
import type { Crumb } from '../../core/frame/breadcrumb.util';
import { templateKindOfFolderPath } from '../../shared/asset-route.util';
import type { SfTreeNode } from '../../shared/components/tree/tree-model';
import type { TemplateSummary } from './templates.service';
import type { TemplateAssetKind } from './types';

type FolderView = components['schemas']['FolderView'];

/** What an entry of the Templates tree and folder table is. */
export type TemplateEntryKind = 'folder' | 'page' | 'section' | 'dataset';

/** The icon of each kind (tree, table, dialog). */
export const TEMPLATE_ICONS: Readonly<Record<TemplateEntryKind, string>> = {
  folder: 'folder',
  page: 'web',
  section: 'view_agenda',
  dataset: 'dataset',
};

/** A folder, page template, section template or dataset of the Templates store — what a tree node and a table row stand for (the id is the uuid). */
export interface TemplateEntry {
  readonly kind: TemplateEntryKind;
  readonly uuid: string;
  readonly name: string;
  readonly uid: string;
  /** A folder: its own stored path. A template or dataset: the stored path of the folder it lives in. */
  readonly path: string;
  /** The fixed top-level folders (Page templates, Section templates, Datasets) cannot be renamed, moved or deleted. */
  readonly protectedFolder: boolean;
  /** The kind of things the entry holds or is (a folder: the kind of the root it lives under). */
  readonly assetKind: TemplateAssetKind;
  readonly channels: readonly string[];
  readonly usedByCount: number | null;
  readonly changedAt: string | null;
  readonly revision: number | null;
  readonly abstract: boolean;
}

/**
 * The Templates folder tree and the template / dataset list, indexed for the lazily loaded tree and the folder table. The
 * fixed "All Templates" wrapper stands for the top level: its children (the three kind roots) have the parent `null`.
 */
export interface TemplatesIndex {
  readonly rootUuid: string | null;
  readonly entries: ReadonlyMap<string, TemplateEntry>;
  /** The folder an entry lives in; `null` = the top level. */
  readonly parentOf: ReadonlyMap<string, string | null>;
  /** The uuids directly inside a folder (`null` = the top level). */
  readonly childrenOf: ReadonlyMap<string | null, readonly string[]>;
}

export const EMPTY_TEMPLATES_INDEX: TemplatesIndex = { rootUuid: null, entries: new Map(), parentOf: new Map(), childrenOf: new Map() };

/** The entry kind of a template summary's `assetType`. */
export function entryKindOf(assetType: string | undefined): TemplateEntryKind {
  const type = assetType?.toUpperCase();
  return type === 'SECTION_TEMPLATE' ? 'section' : type === 'DATASET' ? 'dataset' : 'page';
}

/** The `TemplateAssetKind` of an entry kind (a folder has none of its own). */
export function assetKindOf(kind: TemplateEntryKind): TemplateAssetKind {
  return kind === 'section' ? 'SECTION_TEMPLATE' : kind === 'dataset' ? 'DATASET' : 'PAGE_TEMPLATE';
}

function folderEntry(folder: FolderView): TemplateEntry {
  return {
    kind: 'folder',
    uuid: folder.uuid!,
    name: folder.displayName ?? folder.uid ?? '',
    uid: folder.uid ?? '',
    path: folder.path ?? '',
    protectedFolder: folder.protectedFolder === true,
    assetKind: templateKindOfFolderPath(folder.path),
    channels: [],
    usedByCount: null,
    changedAt: null,
    revision: folder.revision ?? null,
    abstract: false,
  };
}

/** The entry of a template or dataset summary (the folder table's and tree's row). */
export function entryOfSummary(summary: TemplateSummary): TemplateEntry {
  const kind = entryKindOf(summary.assetType);
  return {
    kind,
    uuid: summary.uuid!,
    name: summary.displayName ?? summary.uid ?? '',
    uid: summary.uid ?? '',
    path: summary.folderPath ?? '',
    protectedFolder: false,
    assetKind: assetKindOf(kind),
    channels: summary.channels ?? [],
    usedByCount: summary.usedByCount ?? null,
    changedAt: summary.changedAt ?? null,
    revision: summary.revision ?? null,
    abstract: summary.abstract === true,
  };
}

/** The wrapper's children are the fixed kind roots; they are listed page templates, section templates, datasets. */
const ROOT_ORDER: readonly string[] = ['page_templates', 'section_templates', 'datasets'];

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Indexes the folder tree (its sole top-level entry is the wrapper root) with the template and dataset list, which are
 * placed into the folder whose stored path is their `folderPath`. Pure.
 */
export function buildTemplatesIndex(tree: readonly FolderView[], templates: readonly TemplateSummary[]): TemplatesIndex {
  const root = tree[0] ?? null;
  const entries = new Map<string, TemplateEntry>();
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, string[]>();
  const folderByPath = new Map<string, string>();

  const add = (entry: TemplateEntry, parent: string | null): void => {
    entries.set(entry.uuid, entry);
    parentOf.set(entry.uuid, parent);
    const siblings = childrenOf.get(parent);
    if (siblings) {
      siblings.push(entry.uuid);
    } else {
      childrenOf.set(parent, [entry.uuid]);
    }
  };
  const walk = (node: FolderView, parent: string | null): void => {
    // The templates tree holds folders only; anything typed otherwise is not one.
    if (!node.uuid || (node.type && node.type !== 'FOLDER')) {
      return;
    }
    add(folderEntry(node), parent);
    if (node.path) {
      folderByPath.set(node.path, node.uuid);
    }
    for (const child of node.children ?? []) {
      walk(child, node.uuid);
    }
  };
  for (const child of root?.children ?? []) {
    walk(child, null);
  }
  for (const summary of templates) {
    if (!summary.uuid) {
      continue;
    }
    const parent = folderByPath.get(summary.folderPath ?? '');
    if (parent !== undefined) {
      add(entryOfSummary(summary), parent);
    }
  }
  return { rootUuid: root?.uuid ?? null, entries, parentOf, childrenOf };
}

/** Whether the store has no folder and no template. */
export function isEmptyTemplatesIndex(index: TemplatesIndex): boolean {
  return index.entries.size === 0;
}

/** The entries directly inside a folder (`null` = top level): the sub-folders first, then the templates and datasets, each by name. Pure. */
export function childEntries(index: TemplatesIndex, parentId: string | null): TemplateEntry[] {
  const entries = (index.childrenOf.get(parentId) ?? []).flatMap((uuid) => {
    const entry = index.entries.get(uuid);
    return entry ? [entry] : [];
  });
  const folders = entries.filter((entry) => entry.kind === 'folder');
  const sortedFolders =
    parentId === null
      ? [...folders].sort((a, b) => rank(a) - rank(b) || byName(a, b))
      : [...folders].sort(byName);
  return [...sortedFolders, ...entries.filter((entry) => entry.kind !== 'folder').sort(byName)];
}

function rank(entry: TemplateEntry): number {
  const index = ROOT_ORDER.indexOf(entry.uid);
  return index < 0 ? ROOT_ORDER.length : index;
}

export interface TemplateNodeOptions {
  /** Developer mode shows the UID beside the name of a template or dataset. */
  readonly dev: boolean;
}

function nodeOf(entry: TemplateEntry, index: TemplatesIndex, options: TemplateNodeOptions): SfTreeNode<TemplateEntry> {
  const folder = entry.kind === 'folder';
  return {
    id: entry.uuid,
    label: entry.name,
    icon: TEMPLATE_ICONS[entry.kind],
    secondary: options.dev && !folder ? entry.uid : null,
    hasChildren: folder && (index.childrenOf.get(entry.uuid)?.length ?? 0) > 0,
    droppable: folder,
    draggable: !entry.protectedFolder,
    data: entry,
  };
}

/** The tree nodes directly inside `parentId` (`null` = top level). */
export function childNodes(index: TemplatesIndex, parentId: string | null, options: TemplateNodeOptions): SfTreeNode<TemplateEntry>[] {
  return childEntries(index, parentId).map((entry) => nodeOf(entry, index, options));
}

/** The ids from the top down to `id` (inclusive); empty for an unknown id. */
export function idPath(index: TemplatesIndex, id: string): string[] {
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

/** The root-to-match id path of every entry whose name or UID contains the query (case-insensitive). Pure. */
export function searchPaths(index: TemplatesIndex, query: string): string[][] {
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

/** Every template and dataset inside a folder, at any depth (a folder delete takes them all). */
export function templatesInside(index: TemplatesIndex, folderUuid: string): TemplateEntry[] {
  const found: TemplateEntry[] = [];
  const visit = (uuid: string): void => {
    for (const childUuid of index.childrenOf.get(uuid) ?? []) {
      const child = index.entries.get(childUuid);
      if (!child) {
        continue;
      }
      if (child.kind === 'folder') {
        visit(child.uuid);
      } else {
        found.push(child);
      }
    }
  };
  visit(folderUuid);
  return found;
}

/** The uuid of the template or dataset in an app URL (`/p/acme/templates/<uuid>?…`), or `null`. */
export function templateUuidFromUrl(url: string): string | null {
  const match = /\/templates\/([^/?#;]+)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The folders from the top level down to `uuid` (inclusive); empty for an unknown uuid. */
export function folderChain(tree: readonly FolderView[], uuid: string, chain: readonly FolderView[] = []): FolderView[] {
  for (const node of tree) {
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

/** The breadcrumb of an open folder or template: the folders above it as links (the wrapper root is the area itself). */
export function folderTrail(chain: readonly FolderView[], projectKey: string, rootUuid: string | null): Crumb[] {
  return chain
    .filter((folder) => folder.uuid !== rootUuid)
    .map((folder) => ({
      id: folder.uuid ?? '',
      label: folder.displayName ?? folder.uid ?? '',
      link: ['/p', projectKey, 'templates'],
      queryParams: { folder: folder.uuid ?? '' },
    }));
}

/** The folder tree as the "Move to…" dialog shows it. */
export function foldersOnly(tree: readonly FolderView[]): FolderView[] {
  return tree.filter((node) => !node.type || node.type === 'FOLDER').map((node) => ({ ...node, children: foldersOnly(node.children ?? []) }));
}

/** Every folder uuid below (and including) `uuid` in the tree. */
export function folderSubtree(tree: readonly FolderView[], uuid: string): string[] {
  const chain = folderChain(tree, uuid);
  const node = chain.at(-1);
  if (!node) {
    return [];
  }
  const out: string[] = [];
  const visit = (folder: FolderView): void => {
    if (folder.uuid) {
      out.push(folder.uuid);
    }
    (folder.children ?? []).forEach(visit);
  };
  visit(node);
  return out;
}
