/**
 * The vocabulary of the History screens (M35.12, signed off in the style guide): the kinds of change a person
 * filters by, the date filter, and the pure rules that turn them into API parameters. No Angular here.
 */

/** What a revision was, as the History filter names it: groups of the API's change types. */
export type HistoryKind = 'edit' | 'release' | 'restore' | 'create' | 'delete' | 'import';
export const HISTORY_KINDS: readonly HistoryKind[] = ['edit', 'release', 'restore', 'create', 'delete', 'import'];

export const HISTORY_KIND_ICONS: Readonly<Record<HistoryKind, string>> = {
  edit: 'edit_note',
  release: 'publish',
  restore: 'restore',
  create: 'add_circle',
  delete: 'delete',
  import: 'upload',
};

/** The API change types (`RevisionView.changeType`) behind each kind. */
export const KIND_CHANGE_TYPES: Readonly<Record<HistoryKind, readonly string[]>> = {
  edit: ['UPDATE', 'MOVE', 'RENAME', 'UID_CHANGE', 'BULK', 'DISCARD'],
  release: ['RELEASE', 'UNPUBLISH'],
  restore: ['RESTORE'],
  create: ['CREATE'],
  delete: ['DELETE'],
  import: ['IMPORT'],
};

/** The kind a change type belongs to (an unknown one counts as an edit). */
export function kindOf(changeType: string | null | undefined): HistoryKind {
  const type = (changeType ?? '').toUpperCase();
  return HISTORY_KINDS.find((kind) => KIND_CHANGE_TYPES[kind].includes(type)) ?? 'edit';
}

/** The date filter: a preset, or **custom** — an own from–to range (inclusive days, `yyyy-MM-dd`; either end may be open). */
export const HISTORY_RANGES = ['any', 'today', 'week', 'month', 'custom'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export interface HistoryDateFilter {
  readonly range: HistoryRange;
  readonly from: string | null;
  readonly to: string | null;
}

export const NO_DATE_FILTER: HistoryDateFilter = { range: 'any', from: null, to: null };

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_DAYS = { today: 1, week: 7, month: 30 } as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a calendar day written `yyyy-MM-dd`. */
export function isIsoDay(value: string | null | undefined): value is string {
  return !!value && ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

/** Start of the local day `iso` names, as an instant. */
function startOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * The API's `from` (inclusive) and `to` (exclusive) instants for a date filter. A preset counts back from `now`; a
 * custom range covers whole local days, so its `to` is the start of the day after.
 */
export function dateBounds(filter: HistoryDateFilter, now = Date.now()): { from?: string; to?: string } {
  if (filter.range === 'any') {
    return {};
  }
  if (filter.range !== 'custom') {
    return { from: new Date(now - PRESET_DAYS[filter.range] * DAY_MS).toISOString() };
  }
  const bounds: { from?: string; to?: string } = {};
  if (isIsoDay(filter.from)) {
    bounds.from = startOfDay(filter.from).toISOString();
  }
  if (isIsoDay(filter.to)) {
    bounds.to = new Date(startOfDay(filter.to).getTime() + DAY_MS).toISOString();
  }
  return bounds;
}

/** What the History page and drawer filter by. */
export interface HistoryFilter {
  /** The author's user id. */
  readonly by: number | null;
  readonly kind: HistoryKind | null;
  readonly date: HistoryDateFilter;
  readonly q: string;
}

export const NO_HISTORY_FILTER: HistoryFilter = { by: null, kind: null, date: NO_DATE_FILTER, q: '' };

export function isFiltered(filter: HistoryFilter): boolean {
  return filter.by !== null || filter.kind !== null || filter.date.range !== 'any' || filter.q.trim() !== '';
}

/** The filter as URL query parameters (only what is set). */
export function filterToQuery(filter: HistoryFilter): Record<string, string | null> {
  const custom = filter.date.range === 'custom';
  return {
    by: filter.by === null ? null : String(filter.by),
    type: filter.kind,
    range: filter.date.range === 'any' ? null : filter.date.range,
    from: custom ? filter.date.from : null,
    to: custom ? filter.date.to : null,
    q: filter.q.trim() || null,
  };
}

/** The filter from URL query parameters; anything invalid is dropped. */
export function filterFromQuery(get: (name: string) => string | null): HistoryFilter {
  const by = Number(get('by'));
  const kind = HISTORY_KINDS.find((k) => k === get('type')) ?? null;
  const range = HISTORY_RANGES.find((r) => r === get('range')) ?? 'any';
  const from = isIsoDay(get('from')) ? get('from') : null;
  const to = isIsoDay(get('to')) ? get('to') : null;
  const date: HistoryDateFilter =
    range === 'custom' ? (from || to ? { range, from, to } : NO_DATE_FILTER) : { range, from: null, to: null };
  return { by: get('by') !== null && Number.isInteger(by) && by > 0 ? by : null, kind, date, q: get('q') ?? '' };
}

/** The API query for a filter (`changeType` lists every change type of the kind). */
export function filterToApi(filter: HistoryFilter, now = Date.now()): {
  userId?: number;
  changeType?: readonly string[];
  q?: string;
  from?: string;
  to?: string;
} {
  const api: { userId?: number; changeType?: readonly string[]; q?: string; from?: string; to?: string } = {
    ...dateBounds(filter.date, now),
  };
  if (filter.by !== null) {
    api.userId = filter.by;
  }
  if (filter.kind) {
    api.changeType = KIND_CHANGE_TYPES[filter.kind];
  }
  if (filter.q.trim()) {
    api.q = filter.q.trim();
  }
  return api;
}
