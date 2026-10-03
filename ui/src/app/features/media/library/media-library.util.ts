import type { components } from '../../../core/api/generated/schema.d.ts';

type FolderView = components['schemas']['FolderView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];

/** How many media items one request of a folder's file list loads (the list is read page by page until it is complete). */
export const PAGE_SIZE = 200;
/** How many cards the grid renders at first, and how many more each time its end scrolls into view. */
export const GRID_CHUNK = 60;

export type MediaTypeFilter = 'all' | 'images' | 'documents' | 'text';
export const MEDIA_TYPE_FILTERS: readonly MediaTypeFilter[] = ['all', 'images', 'documents', 'text'];
export type MediaSort = 'name' | 'date' | 'size' | 'type';
export const MEDIA_SORTS: readonly MediaSort[] = ['name', 'date', 'size', 'type'];
export type MediaSortDirection = 'asc' | 'desc';
export type MediaViewMode = 'grid' | 'list';
export const MEDIA_VIEWS: readonly MediaViewMode[] = ['grid', 'list'];

/** What a file is for the type filter and its icon: a picture, text (CSS, SVG, …) or any other document. */
export type MediaKind = 'image' | 'text' | 'document';

export function mediaKind(item: Pick<MediaSummaryView, 'mimeType' | 'textEditable'>): MediaKind {
  if (item.textEditable) {
    return 'text';
  }
  return (item.mimeType ?? '').startsWith('image/') ? 'image' : 'document';
}

/** Rasters get a server thumbnail; SVG is text, PDFs and the rest show an icon. */
export function isRaster(mimeType: string | undefined | null): boolean {
  return /^image\/(jpeg|png|gif|webp|avif|bmp|tiff)$/.test(mimeType ?? '');
}

/** Whether a picture may have transparent areas, so its thumbnail sits on a checkerboard. */
export function isTransparent(mimeType: string | undefined | null): boolean {
  return /^image\/(png|gif|webp|svg\+xml)$/.test(mimeType ?? '');
}

const FORMATS: Readonly<Record<string, string>> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WEBP',
  'image/avif': 'AVIF',
  'image/svg+xml': 'SVG',
  'application/pdf': 'PDF',
  'text/css': 'CSS',
  'text/html': 'HTML',
  'text/plain': 'TXT',
  'text/javascript': 'JS',
  'application/javascript': 'JS',
  'application/json': 'JSON',
  'application/xml': 'XML',
  'text/xml': 'XML',
  'text/markdown': 'MD',
  'application/zip': 'ZIP',
};

/** The short format name of a file ("JPG", "CSS"): from its media type, else from its name's extension. */
export function formatOf(item: Pick<MediaSummaryView, 'mimeType' | 'displayName' | 'uid'>): string {
  const known = FORMATS[(item.mimeType ?? '').toLowerCase()];
  if (known) {
    return known;
  }
  const name = item.displayName ?? item.uid ?? '';
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toUpperCase();
  }
  const subtype = (item.mimeType ?? '').split('/')[1];
  return subtype ? subtype.split(/[+;]/)[0].toUpperCase() : '';
}

/** Whether a file passes the toolbar's type filter (an SVG is both a picture and text). */
export function matchesType(item: MediaSummaryView, filter: MediaTypeFilter): boolean {
  switch (filter) {
    case 'images':
      return (item.mimeType ?? '').startsWith('image/');
    case 'documents':
      return mediaKind(item) === 'document';
    case 'text':
      return mediaKind(item) === 'text';
    default:
      return true;
  }
}

/** Whether a file's name contains the search text (lower case, trimmed). */
export function matchesQuery(item: MediaSummaryView, query: string): boolean {
  return !query || (item.displayName ?? item.uid ?? '').toLowerCase().includes(query);
}

const byName = (a: MediaSummaryView, b: MediaSummaryView): number =>
  (a.displayName ?? a.uid ?? '').localeCompare(b.displayName ?? b.uid ?? '', undefined, { numeric: true, sensitivity: 'base' });

/** The comparison of one sort field, ascending (a tie falls back to the name). Dates ascend newest first. */
export function compareMedia(sort: MediaSort): (a: MediaSummaryView, b: MediaSummaryView) => number {
  switch (sort) {
    case 'date':
      return (a, b) => changedTime(b) - changedTime(a) || byName(a, b);
    case 'size':
      return (a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0) || byName(a, b);
    case 'type':
      return (a, b) => formatOf(a).localeCompare(formatOf(b)) || byName(a, b);
    default:
      return byName;
  }
}

/** When a file last changed, ms since the epoch (0 when the list does not say). */
export function changedTime(item: Pick<MediaSummaryView, 'changedAt'>): number {
  const time = item.changedAt ? Date.parse(item.changedAt) : 0;
  return Number.isNaN(time) ? 0 : time;
}

/** The files after search and type filter, sorted. Pure: the input is not changed. */
export function visibleMedia(
  items: readonly MediaSummaryView[],
  query: string,
  type: MediaTypeFilter,
  sort: MediaSort,
  direction: MediaSortDirection,
): MediaSummaryView[] {
  const needle = query.trim().toLowerCase();
  const compare = compareMedia(sort);
  const sign = direction === 'asc' ? 1 : -1;
  return items.filter((item) => matchesType(item, type) && matchesQuery(item, needle)).sort((a, b) => sign * compare(a, b));
}

const SORT_PARAM = new RegExp(`^(${MEDIA_SORTS.join('|')})-(asc|desc)$`);

/** `sort=size-desc` → its field and direction, `null` for anything else. */
export function parseSort(param: string | null | undefined): { sort: MediaSort; direction: MediaSortDirection } | null {
  const match = SORT_PARAM.exec(param ?? '');
  return match ? { sort: match[1] as MediaSort, direction: match[2] as MediaSortDirection } : null;
}

/** The `sort` URL value of a sort; `null` for the default (name, ascending), which the URL leaves out. */
export function sortParam(sort: MediaSort, direction: MediaSortDirection): string | null {
  return sort === 'name' && direction === 'asc' ? null : `${sort}-${direction}`;
}

/** The folders from the top level down to `uuid` (inclusive); empty for an unknown uuid. */
export function folderChain(nodes: readonly FolderView[], uuid: string, chain: readonly FolderView[] = []): FolderView[] {
  for (const node of nodes) {
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

/** The folder that holds the folder `uuid` (`null` for a top-level entry of `nodes`, or an unknown uuid). */
export function findParentFolder(nodes: FolderView[], uuid: string, parent: FolderView | null = null): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return parent;
    }
    const found = findParentFolder(node.children ?? [], uuid, node);
    if (found) {
      return found;
    }
  }
  return null;
}

/** How many sub-folders and media items a folder holds in all its levels — what deleting it takes along. */
export function folderContentCount(
  folder: FolderView,
  mediaByFolder: ReadonlyMap<string, readonly unknown[]>,
): { folders: number; media: number } {
  let folders = 0;
  let media = mediaByFolder.get(folder.path ?? '')?.length ?? 0;
  for (const child of folder.children ?? []) {
    const inner = folderContentCount(child, mediaByFolder);
    folders += 1 + inner.folders;
    media += inner.media;
  }
  return { folders, media };
}

export function findFolderByPath(nodes: FolderView[], path: string): FolderView | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const found = findFolderByPath(node.children ?? [], path);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Material Symbols icon for a mime type that has no thumbnail preview (anything non-image). */
export function mediaIconFor(mimeType?: string): string {
  const mime = mimeType ?? '';
  if (mime.startsWith('video/')) {
    return 'movie';
  }
  if (mime.startsWith('audio/')) {
    return 'audiotrack';
  }
  if (mime.startsWith('font/')) {
    return 'font_download';
  }
  if (mime === 'application/pdf') {
    return 'picture_as_pdf';
  }
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || mime === 'application/gzip') {
    return 'folder_zip';
  }
  if (mime === 'text/css' || mime === 'application/javascript' || mime === 'application/json' || mime === 'text/html') {
    return 'code';
  }
  if (mime.startsWith('text/')) {
    return 'description';
  }
  return 'draft';
}
