import type { ChangesQuery } from '../../core/api/api.client';

/** The Changes view's state as it lives in the URL (lessons: filters as chips, their chosen values visible). */
export interface ChangesState {
  type: string[];
  status: string[];
  locale: string[];
  changedBy: number | null;
  folder: string | null;
  q: string;
  sort: ChangesSort;
  page: number;
}

export type ChangesSort = 'changedAt,desc' | 'changedAt,asc' | 'displayName,asc' | 'displayName,desc';

export const SORTS: readonly { value: ChangesSort; label: string }[] = [
  { value: 'changedAt,desc', label: 'Newest change first' },
  { value: 'changedAt,asc', label: 'Oldest change first' },
  { value: 'displayName,asc', label: 'Name A–Z' },
  { value: 'displayName,desc', label: 'Name Z–A' },
];

/** The releasable types (epic decision 1), as the type filter offers them. */
export const CHANGE_TYPES: readonly { value: string; label: string; icon: string }[] = [
  { value: 'PAGE', label: 'Page', icon: 'description' },
  { value: 'RECORD', label: 'Record', icon: 'table_rows' },
  { value: 'RECORD_SET', label: 'Record set', icon: 'dataset' },
  { value: 'GLOBAL_SET', label: 'Global set', icon: 'tune' },
  { value: 'MEDIA', label: 'Media', icon: 'image' },
  { value: 'PAGE_REFERENCE', label: 'Navigation reference', icon: 'link' },
  { value: 'FOLDER', label: 'Folder', icon: 'folder' },
];

/** The statuses a pending change can have (everything but `PUBLISHED`). */
export const CHANGE_STATUSES: readonly string[] = ['NEW', 'CHANGED', 'DELETION_PENDING', 'UNPUBLISHED'];

export const PAGE_SIZE = 50;

/** A repeatable query parameter as Angular binds it: absent, one value, or several. */
export type QueryValue = string | string[] | null | undefined;

export function asList(value: QueryValue): string[] {
  if (value == null || value === '') {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).filter((v) => v.length > 0);
}

function isSort(value: string | undefined): value is ChangesSort {
  return SORTS.some((sort) => sort.value === value);
}

/** The state of the URL's query parameters; unknown or malformed values fall back to the defaults. */
export function stateFromParams(params: {
  type?: QueryValue;
  status?: QueryValue;
  locale?: QueryValue;
  changedBy?: string | null;
  folder?: string | null;
  q?: string | null;
  sort?: string | null;
  page?: string | null;
}): ChangesState {
  const changedBy = Number(params.changedBy);
  const page = Number(params.page);
  return {
    type: asList(params.type),
    status: asList(params.status),
    locale: asList(params.locale),
    changedBy: params.changedBy && Number.isInteger(changedBy) ? changedBy : null,
    folder: params.folder || null,
    q: params.q ?? '',
    sort: isSort(params.sort ?? undefined) ? (params.sort as ChangesSort) : 'changedAt,desc',
    page: Number.isInteger(page) && page > 0 ? page : 0,
  };
}

/** The query parameters of a state: defaults are left out, so a plain view has a plain URL. */
export function paramsFromState(state: ChangesState): Record<string, string | string[] | null> {
  return {
    type: state.type.length > 0 ? state.type : null,
    status: state.status.length > 0 ? state.status : null,
    locale: state.locale.length > 0 ? state.locale : null,
    changedBy: state.changedBy != null ? String(state.changedBy) : null,
    folder: state.folder,
    q: state.q.trim() || null,
    sort: state.sort === 'changedAt,desc' ? null : state.sort,
    page: state.page > 0 ? String(state.page) : null,
  };
}

/** The API request of a state. */
export function queryFromState(state: ChangesState): ChangesQuery {
  return {
    type: state.type,
    status: state.status,
    // The shared key ("every language") travels as an empty locale parameter.
    locale: state.locale,
    changedBy: state.changedBy ?? undefined,
    folderUuid: state.folder ?? undefined,
    q: state.q.trim() || undefined,
    sort: state.sort,
    page: state.page,
    size: PAGE_SIZE,
  };
}

export function typeInfo(type: string | null | undefined): { label: string; icon: string } {
  return CHANGE_TYPES.find((t) => t.value === type) ?? { label: type ?? 'Asset', icon: 'draft' };
}

/** What the nav rail counts: everything that isn't live as it is — new, changed, pending deletion (M27.6.2). */
export function pendingCount(counts: Record<string, number> | null | undefined): number {
  if (!counts) {
    return 0;
  }
  return (counts['CHANGED'] ?? 0) + (counts['NEW'] ?? 0) + (counts['DELETION_PENDING'] ?? 0);
}
