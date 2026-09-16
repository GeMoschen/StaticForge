import type { EditorDefinition, PaginationSourceKind, PaginationValue } from '../form.model';

/** The sort keys of a navigation source (mirrors `PaginationOptions.NAV_SORT_KEYS`). */
export const NAV_SORT_KEYS = ['navigation', 'position', 'date', 'displayName'];

/** The largest page size when the declaration sets no `maxPageSize` (mirrors `PaginationOptions.MAX_PAGE_SIZE`). */
export const MAX_PAGE_SIZE = 1000;

/** A folder of the Navigation store as the source picker lists it: depth-indented, tree order. */
export interface SourceOption {
  uuid: string;
  label: string;
}

interface FolderLike {
  uuid?: string;
  displayName?: string;
  uid?: string;
  children?: FolderLike[];
}

/** The source kinds the editor may pick, as stored (`NAV`/`DATASET`); navigation only when undeclared. */
export function sourceKinds(definition: EditorDefinition): PaginationSourceKind[] {
  const sources = definition.pagination?.sources?.length ? definition.pagination.sources : ['nav'];
  return sources
    .map((source) => source.toUpperCase())
    .filter((kind): kind is PaginationSourceKind => kind === 'NAV' || kind === 'DATASET');
}

/** The offered sort keys a source kind can use: navigation keys for `NAV`, field names for `DATASET`. */
export function sortKeys(definition: EditorDefinition, kind: PaginationSourceKind): string[] {
  const offered = definition.pagination?.sort?.length
    ? definition.pagination.sort
    : kind === 'NAV'
      ? ['navigation']
      : ['_displayName'];
  return kind === 'NAV'
    ? offered.filter((key) => NAV_SORT_KEYS.includes(key))
    : offered.filter((key) => key !== 'navigation' && key !== 'position' && key !== 'displayName');
}

/** The declared page size bounds: `1..maxPageSize`. */
export function maxPageSize(definition: EditorDefinition): number {
  return definition.pagination?.maxPageSize ?? MAX_PAGE_SIZE;
}

export function defaultPageSize(definition: EditorDefinition): number {
  return definition.pagination?.pageSize ?? 10;
}

/** Clamps a typed page size into `1..maxPageSize`; a non-number falls back to the declared default. */
export function clampPageSize(definition: EditorDefinition, raw: unknown): number {
  const size = Math.trunc(Number(raw));
  if (!Number.isFinite(size) || size < 1) {
    return Number.isFinite(size) && size < 1 ? 1 : defaultPageSize(definition);
  }
  return Math.min(size, maxPageSize(definition));
}

/** Reads a stored value; anything but a `PAGINATION` object is "not paginated". */
export function readPaginationValue(value: unknown): PaginationValue | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<PaginationValue>;
  return candidate.type === 'PAGINATION' && candidate.source?.uuid ? (candidate as PaginationValue) : null;
}

/** Builds the stored value; the shape `ContentValidator` accepts. */
export function paginationValue(
  kind: PaginationSourceKind,
  uuid: string,
  pageSize: number,
  sortKey: string,
  direction: 'ASC' | 'DESC',
): PaginationValue {
  return { type: 'PAGINATION', source: { kind, uuid }, pageSize, sort: { key: sortKey, direction } };
}

/** The navigation folders, depth-first in tree order, indented by depth. */
export function flattenFolders(tree: FolderLike[] | null | undefined, depth = 0): SourceOption[] {
  const out: SourceOption[] = [];
  for (const folder of tree ?? []) {
    if (folder.uuid) {
      out.push({ uuid: folder.uuid, label: `${'  '.repeat(depth)}${folder.displayName ?? folder.uid ?? folder.uuid}` });
    }
    out.push(...flattenFolders(folder.children, depth + 1));
  }
  return out;
}

/** The asset picker type that picks a source kind. */
export function pickerTypeFor(kind: PaginationSourceKind): 'NAV_FOLDER' | 'DATASET' {
  return kind === 'NAV' ? 'NAV_FOLDER' : 'DATASET';
}

/** The source kind of an asset picker result; `null` for anything that isn't a pagination source. */
export function sourceKindOf(pickerType: string): PaginationSourceKind | null {
  return pickerType === 'NAV_FOLDER' ? 'NAV' : pickerType === 'DATASET' ? 'DATASET' : null;
}

/** `7 items → 4 pages` for the editor's hint; an empty source is one page, and skipped references are named. */
export function pageCountHint(itemCount: number, pageSize: number, skipped = 0): string {
  const size = Math.max(1, pageSize);
  const pages = Math.max(1, Math.ceil(itemCount / size));
  const text = `${itemCount} ${itemCount === 1 ? 'item' : 'items'} → ${pages} ${pages === 1 ? 'page' : 'pages'}`;
  return skipped > 0
    ? `${text} (${skipped} ${skipped === 1 ? 'entry points' : 'entries point'} to no page and ${skipped === 1 ? 'is' : 'are'} skipped)`
    : text;
}

/** Human names of the sort keys. */
export function sortLabel(key: string): string {
  switch (key) {
    case 'navigation':
      return 'Navigation order';
    case 'position':
      return 'Position';
    case 'date':
      return 'Date';
    case 'displayName':
    case '_displayName':
      return 'Name';
    case '_uid':
      return 'UID';
    case '_changedAt':
      return 'Last changed';
    default:
      return key;
  }
}

/** One-line summary for read-only views and the visual diff: `Source: Blog · 10 per page · Date ↓`. */
export function summarizePagination(value: unknown, sourceName: string | null): string {
  const pagination = readPaginationValue(value);
  if (!pagination) {
    return 'Not paginated';
  }
  const arrow = pagination.sort?.direction === 'DESC' ? ' ↓' : ' ↑';
  const sort = pagination.sort?.key ? ` · ${sortLabel(pagination.sort.key)}${arrow}` : '';
  const kind = pagination.source.kind === 'DATASET' ? 'Dataset' : 'Source';
  return `${kind}: ${sourceName ?? pagination.source.uuid} · ${pagination.pageSize} per page${sort}`;
}
