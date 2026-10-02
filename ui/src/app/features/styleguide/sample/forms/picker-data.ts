import { MEDIA_FILES, MEDIA_FOLDERS, SampleMediaFolder } from '../media/sample-media-data';
import { CONTENT, DATASETS, SampleContentEntry, TEMPLATES, SampleTemplateEntry, datasetById } from '../sample-content-data';
import { SITE, SampleEntry } from '../sample-data';

/**
 * The fake stores the asset picker (M35.17 sample) chooses from — the real picker's types: assets (pages, media, page and
 * section templates, records, record sets) and the two **pagination sources** (a folder of the Navigation store, a dataset).
 */
export type PickerType = 'PAGE' | 'MEDIA' | 'PAGE_REFERENCE' | 'PAGE_TEMPLATE' | 'SECTION_TEMPLATE' | 'RECORD' | 'RECORD_SET' | 'NAV_FOLDER' | 'DATASET';

/** The default type switch, in the real picker's order; the sources are offered only when asked for by name. */
export const ASSET_TYPES: readonly PickerType[] = ['PAGE', 'MEDIA', 'PAGE_REFERENCE', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'RECORD', 'RECORD_SET'];
export const SOURCE_TYPES: readonly PickerType[] = ['NAV_FOLDER', 'DATASET'];

/** What a value shows of a chosen asset: the icon family. */
export type PickerKind = 'page' | 'media' | 'naventry' | 'record' | 'recordset' | 'template' | 'navfolder' | 'dataset';

export type PickerStatus = 'released' | 'changed' | 'draft';

/** A sample status as the picker shows it: a scheduled item is one with changes still to go out. */
function pickerStatus(status: string): PickerStatus {
  return status === 'released' ? 'released' : status === 'draft' ? 'draft' : 'changed';
}

/** One pickable row, and what a reference or link remembers of its target (its name and place — never a UUID). */
export interface PickerItem {
  readonly id: string;
  readonly kind: PickerKind;
  readonly type: PickerType;
  readonly name: string;
  readonly uid: string;
  /** The target's address or place, shown muted under a chosen target ("/news/", "Products"). */
  readonly path: string;
  /** Where it lives in its store ("News › Archive"); the row's meta line outside developer mode. */
  readonly folderPath: string;
  /** A second muted fact: pixel size and file size of a file, the parents of a page. */
  readonly detail?: string;
  readonly folderId: string | null;
  /** Records and record sets: their dataset's name and uid. */
  readonly dataset?: string;
  readonly datasetUid?: string;
  /** A record set's record count. */
  readonly recordCount?: number;
  readonly status?: PickerStatus;
  /** Indentation of a navigation folder row. */
  readonly depth?: number;
  /** A file: its format and size ("JPG", "1.2 MB") and whether it has a picture. */
  readonly format?: string;
  readonly size?: string;
  readonly image?: boolean;
}

/** A folder of a store; the tree loads its children when a node opens. */
export interface PickerFolder {
  readonly id: string;
  readonly name: string;
  readonly children: readonly PickerFolder[];
}

const MB = 1024 * 1024;
const KB = 1024;

function sizeLabel(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / KB)} KB`;
}

// ── Pages ────────────────────────────────────────────────────────────────────

function pageFolders(entries: readonly SampleEntry[]): PickerFolder[] {
  return entries
    .filter((entry) => entry.kind === 'folder')
    .map((entry) => ({ id: entry.id, name: entry.name, children: pageFolders(entry.children ?? []) }));
}

function pageItems(entries: readonly SampleEntry[], parents: readonly { id: string; name: string }[] = []): PickerItem[] {
  return entries.flatMap((entry): PickerItem[] => {
    if (entry.kind === 'folder') {
      return pageItems(entry.children ?? [], [...parents, { id: entry.id, name: entry.name }]);
    }
    const names = parents.map((p) => p.name).join(' › ');
    return [
      {
        id: entry.id,
        kind: 'page',
        type: 'PAGE',
        name: entry.name,
        uid: entry.uid,
        path: entry.url,
        folderPath: names,
        detail: names,
        folderId: parents.at(-1)?.id ?? null,
        status: pickerStatus(entry.status.en),
      },
    ];
  });
}

// ── Media ────────────────────────────────────────────────────────────────────

function mediaFolders(list: readonly SampleMediaFolder[]): PickerFolder[] {
  return list.map((f) => ({ id: f.id, name: f.name, children: mediaFolders(f.children ?? []) }));
}

function mediaFolderNames(id: string, list: readonly SampleMediaFolder[] = MEDIA_FOLDERS, parents: readonly string[] = []): string[] | null {
  for (const folder of list) {
    if (folder.id === id) {
      return [...parents, folder.name];
    }
    const inner = mediaFolderNames(id, folder.children ?? [], [...parents, folder.name]);
    if (inner) {
      return inner;
    }
  }
  return null;
}

function mediaItems(): PickerItem[] {
  return MEDIA_FILES.map((file) => {
    const folderPath = (mediaFolderNames(file.folderId) ?? []).join(' › ');
    const dims = file.width && file.height ? `${file.width} × ${file.height}` : '';
    const size = sizeLabel(file.sizeBytes);
    return {
      id: file.id,
      kind: 'media',
      type: 'MEDIA',
      name: file.name,
      uid: file.uid,
      path: folderPath,
      folderPath,
      detail: [dims, size].filter(Boolean).join(' · '),
      folderId: file.folderId,
      status: pickerStatus(file.status),
      format: file.format,
      size,
      image: file.art !== null && file.kind === 'image',
    } satisfies PickerItem;
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

function templateFolders(): PickerFolder[] {
  return TEMPLATES.filter((t) => t.id === 'tf-page' || t.id === 'tf-section').map((t) => ({ id: t.id, name: t.name, children: [] }));
}

function templateItems(): PickerItem[] {
  return TEMPLATES.flatMap((folder) =>
    (folder.children ?? [])
      .filter((child: SampleTemplateEntry) => child.kind === 'page' || child.kind === 'section')
      .map(
        (child): PickerItem => ({
          id: child.id,
          kind: 'template',
          type: child.kind === 'page' ? 'PAGE_TEMPLATE' : 'SECTION_TEMPLATE',
          name: child.name,
          uid: child.uid,
          path: folder.name,
          folderPath: folder.name,
          folderId: folder.id,
        }),
      ),
  );
}

// ── Content: datasets, records, record sets ──────────────────────────────────

function contentFolders(entries: readonly SampleContentEntry[]): PickerFolder[] {
  return entries.filter((e) => e.kind === 'folder').map((e) => ({ id: e.id, name: e.name, children: contentFolders(e.children ?? []) }));
}

function recordSetItems(entries: readonly SampleContentEntry[] = CONTENT, parents: readonly { id: string; name: string }[] = []): PickerItem[] {
  return entries.flatMap((entry): PickerItem[] => {
    if (entry.kind === 'folder') {
      return recordSetItems(entry.children ?? [], [...parents, { id: entry.id, name: entry.name }]);
    }
    const dataset = datasetById(entry.dataset);
    const folderPath = parents.map((p) => p.name).join(' › ');
    return [
      {
        id: entry.id,
        kind: 'recordset',
        type: 'RECORD_SET',
        name: entry.name,
        uid: entry.uid,
        path: folderPath,
        folderPath,
        folderId: parents.at(-1)?.id ?? null,
        dataset: dataset?.name,
        datasetUid: dataset?.uid,
        recordCount: entry.records?.length ?? 0,
      },
    ];
  });
}

function recordItems(sets: readonly PickerItem[]): PickerItem[] {
  const all: PickerItem[] = [];
  const walk = (entries: readonly SampleContentEntry[]): void => {
    for (const entry of entries) {
      if (entry.kind === 'folder') {
        walk(entry.children ?? []);
        continue;
      }
      const set = sets.find((s) => s.id === entry.id);
      const dataset = datasetById(entry.dataset);
      for (const record of entry.records ?? []) {
        all.push({
          id: record.id,
          kind: 'record',
          type: 'RECORD',
          name: String(record.values['name']),
          uid: record.uid,
          path: set ? `${set.folderPath} › ${set.name}` : '',
          folderPath: set ? `${set.folderPath} › ${set.name}` : '',
          folderId: entry.id,
          dataset: dataset?.name,
          datasetUid: dataset?.uid,
          status: pickerStatus(record.status.en),
        });
      }
    }
  };
  walk(CONTENT);
  return all;
}

// ── Navigation folders (a pagination source) ─────────────────────────────────

const NAV_FOLDERS: readonly { id: string; name: string; uid: string; depth: number; path: string }[] = [
  { id: 'n-main', name: 'Main menu', uid: 'main_menu', depth: 0, path: 'Main menu' },
  { id: 'n-coffee', name: 'Coffee', uid: 'nav_coffee', depth: 1, path: 'Main menu › Coffee' },
  { id: 'n-single', name: 'Single origins', uid: 'nav_single_origins', depth: 2, path: 'Main menu › Coffee › Single origins' },
  { id: 'n-roastery', name: 'Roastery', uid: 'nav_roastery', depth: 1, path: 'Main menu › Roastery' },
  { id: 'n-footer', name: 'Footer', uid: 'footer', depth: 0, path: 'Footer' },
  { id: 'n-legal', name: 'Legal', uid: 'nav_legal', depth: 1, path: 'Footer › Legal' },
];

function navFolderItems(): PickerItem[] {
  return NAV_FOLDERS.map((f) => ({
    id: f.id,
    kind: 'navfolder',
    type: 'NAV_FOLDER',
    name: f.name,
    uid: f.uid,
    path: f.path,
    folderPath: f.path,
    folderId: null,
    depth: f.depth,
  }));
}

function datasetItems(): PickerItem[] {
  return DATASETS.map((d) => ({ id: d.id, kind: 'dataset', type: 'DATASET', name: d.name, uid: d.uid, path: d.uid, folderPath: '', folderId: null }));
}

// ── Navigation entries (menu items that point at a page) ─────────────────────

/** The Navigation store's folders as a tree (the entries live in them). */
const NAV_TREE: readonly PickerFolder[] = [
  {
    id: 'n-main',
    name: 'Main menu',
    children: [
      { id: 'n-coffee', name: 'Coffee', children: [{ id: 'n-single', name: 'Single origins', children: [] }] },
      { id: 'n-roastery', name: 'Roastery', children: [] },
    ],
  },
  { id: 'n-footer', name: 'Footer', children: [{ id: 'n-legal', name: 'Legal', children: [] }] },
];

const NAV_ENTRIES: readonly { id: string; name: string; uid: string; target: string; folderId: string; folderPath: string; status: PickerStatus }[] = [
  { id: 'ne-home', name: 'Home', uid: 'nav_home', target: '/', folderId: 'n-main', folderPath: 'Main menu', status: 'released' },
  { id: 'ne-shop', name: 'Shop', uid: 'nav_shop', target: '/shop/', folderId: 'n-main', folderPath: 'Main menu', status: 'released' },
  { id: 'ne-single', name: 'Yirgacheffe', uid: 'nav_yirgacheffe', target: '/shop/single-origins', folderId: 'n-single', folderPath: 'Main menu › Coffee › Single origins', status: 'changed' },
  { id: 'ne-roastery', name: 'Our roastery', uid: 'nav_roastery', target: '/about/our-story', folderId: 'n-roastery', folderPath: 'Main menu › Roastery', status: 'released' },
  { id: 'ne-imprint', name: 'Imprint', uid: 'nav_imprint', target: '/imprint', folderId: 'n-legal', folderPath: 'Footer › Legal', status: 'released' },
  { id: 'ne-privacy', name: 'Privacy policy', uid: 'nav_privacy', target: '/privacy', folderId: 'n-legal', folderPath: 'Footer › Legal', status: 'draft' },
];

function navEntryItems(): PickerItem[] {
  return NAV_ENTRIES.map((e) => ({
    id: e.id,
    kind: 'naventry',
    type: 'PAGE_REFERENCE',
    name: e.name,
    uid: e.uid,
    path: e.target,
    folderPath: e.folderPath,
    folderId: e.folderId,
    status: e.status,
  }));
}

// ── The stores ───────────────────────────────────────────────────────────────

const RECORD_SETS = recordSetItems();

/** Every pickable item, per type, in the stores' own order. */
const ITEMS: Readonly<Record<PickerType, readonly PickerItem[]>> = {
  PAGE: pageItems(SITE),
  MEDIA: mediaItems(),
  PAGE_REFERENCE: navEntryItems(),
  PAGE_TEMPLATE: templateItems().filter((i) => i.type === 'PAGE_TEMPLATE'),
  SECTION_TEMPLATE: templateItems().filter((i) => i.type === 'SECTION_TEMPLATE'),
  RECORD: recordItems(RECORD_SETS),
  RECORD_SET: RECORD_SETS,
  NAV_FOLDER: navFolderItems(),
  DATASET: datasetItems(),
};

/** The folder trees of the stores that have folders (the others list flat). */
const FOLDERS: Partial<Record<PickerType, readonly PickerFolder[]>> = {
  PAGE: pageFolders(SITE),
  MEDIA: mediaFolders(MEDIA_FOLDERS),
  PAGE_REFERENCE: NAV_TREE,
  PAGE_TEMPLATE: templateFolders().filter((f) => f.id === 'tf-page'),
  SECTION_TEMPLATE: templateFolders().filter((f) => f.id === 'tf-section'),
  RECORD_SET: contentFolders(CONTENT),
};

export function pickerFolders(type: PickerType): readonly PickerFolder[] {
  return FOLDERS[type] ?? [];
}

/** Whether the store of a type has a folder tree (pages, media, templates, content) — navigation lists indented rows. */
export function hasFolders(type: PickerType): boolean {
  return (FOLDERS[type]?.length ?? 0) > 0;
}

export function allPickerItems(type: PickerType): readonly PickerItem[] {
  return ITEMS[type];
}

function descendantIds(folder: PickerFolder): string[] {
  return [folder.id, ...folder.children.flatMap(descendantIds)];
}

function findFolder(list: readonly PickerFolder[], id: string): PickerFolder | null {
  for (const folder of list) {
    if (folder.id === id) {
      return folder;
    }
    const inner = findFolder(folder.children, id);
    if (inner) {
      return inner;
    }
  }
  return null;
}

/** The names from the store's root down to a folder (for the breadcrumb). */
export function folderTrail(type: PickerType, id: string | null): PickerFolder[] {
  const trail: PickerFolder[] = [];
  const walk = (list: readonly PickerFolder[]): boolean => {
    for (const folder of list) {
      trail.push(folder);
      if (folder.id === id || walk(folder.children)) {
        return true;
      }
      trail.pop();
    }
    return false;
  };
  if (id) {
    walk(pickerFolders(type));
  }
  return trail;
}

export interface PickerQuery {
  readonly type: PickerType;
  readonly folderId: string | null;
  readonly search: string;
  /** Records: the dataset (id) whose records are listed. */
  readonly datasetId: string | null;
  /** The reference editor's `dataset "uid"` restriction: records and sets of that dataset only. */
  readonly datasetUid: string | null;
}

/**
 * What the picker lists for a query. A **search looks through every folder** (the folder filter is ignored while typing),
 * matching name or uid; a folder shows its own items and those of its sub-folders; records are those of the chosen
 * dataset; record sets narrow to the restricted dataset. Pure.
 */
export function queryPicker(query: PickerQuery): PickerItem[] {
  const needle = query.search.trim().toLowerCase();
  let items = [...ITEMS[query.type]];
  if (query.type === 'RECORD') {
    const dataset = datasetById(query.datasetId);
    items = dataset ? items.filter((item) => item.datasetUid === dataset.uid) : items;
  }
  if (query.type === 'RECORD' || query.type === 'RECORD_SET') {
    items = query.datasetUid ? items.filter((item) => item.datasetUid === query.datasetUid) : items;
  }
  if (needle) {
    if (query.type === 'NAV_FOLDER') {
      return items.filter((item) => matchesNavFolder(item, needle, items));
    }
    return items.filter((item) => `${item.name} ${item.uid}`.toLowerCase().includes(needle));
  }
  if (query.folderId && hasFolders(query.type)) {
    const folder = findFolder(pickerFolders(query.type), query.folderId);
    const ids = folder ? new Set(descendantIds(folder)) : new Set<string>();
    items = items.filter((item) => item.folderId !== null && ids.has(item.folderId));
  }
  return items;
}

/** A navigation folder matches when it does, or a folder below it does (it keeps its place in the tree). */
function matchesNavFolder(item: PickerItem, needle: string, all: readonly PickerItem[]): boolean {
  const own = `${item.name} ${item.uid}`.toLowerCase().includes(needle);
  if (own) {
    return true;
  }
  const index = all.indexOf(item);
  for (let i = index + 1; i < all.length && (all[i].depth ?? 0) > (item.depth ?? 0); i++) {
    if (`${all[i].name} ${all[i].uid}`.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

/** The datasets of the dataset select (only the restricted one when the field names one). */
export function pickerDatasets(datasetUid: string | null): { id: string; name: string; uid: string }[] {
  return DATASETS.filter((d) => !datasetUid || d.uid === datasetUid).map((d) => ({ id: d.id, name: d.name, uid: d.uid }));
}

/**
 * The type switch's types, as the real picker decides: a `dataset` restriction narrows to records (and record sets when
 * `allowedTypes` names them); otherwise `allowedTypes` filters the list (the pagination sources only when asked for by name),
 * and nothing allowed offers every asset type.
 */
export function pickerTypes(allowedTypes: readonly PickerType[] | null | undefined, datasetUid: string | null | undefined): PickerType[] {
  if (datasetUid) {
    const allowed = ASSET_TYPES.filter((t) => (t === 'RECORD' || t === 'RECORD_SET') && allowedTypes?.includes(t));
    return allowed.length > 0 ? allowed : ['RECORD'];
  }
  if (!allowedTypes || allowedTypes.length === 0) {
    return [...ASSET_TYPES];
  }
  const filtered = [...ASSET_TYPES, ...SOURCE_TYPES].filter((t) => allowedTypes.includes(t));
  return filtered.length > 0 ? filtered : [...ASSET_TYPES];
}

// ── What the older sample fields remember of a target ────────────────────────

/** The pages, files and records the editors start with (a target's name and place). */
export const PICKER_PAGES: readonly PickerItem[] = ITEMS.PAGE;
export const PICKER_MEDIA: readonly PickerItem[] = ITEMS.MEDIA;
export const PICKER_RECORDS: readonly PickerItem[] = ITEMS.RECORD;
