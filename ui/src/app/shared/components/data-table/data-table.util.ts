import type { ParamMap, Params } from '@angular/router';
import type { TableColumnsPreference } from '../../../core/preferences/preferences.types';
import type {
  SfDataTableColumn,
  SfDataTableFilter,
  SfDataTableQuery,
  SfDataTableSort,
} from './data-table.types';

/** Pure helpers of `sf-data-table` (M35.8): client sorting, search and filters, the URL format and the column layout. */

export const EMPTY_QUERY: SfDataTableQuery = { search: '', filters: {}, sort: [], page: 0 };
export const DEFAULT_MIN_WIDTH = 48;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Orders two non-empty cell values: numbers and dates by size, booleans false first, everything else as text. */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  return collator.compare(textOf(a), textOf(b));
}

/** The display text of a cell value (no template): empty for null/undefined. */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  return String(value);
}

/**
 * Sorts by every entry of `sort` in turn (stable). A column's `compare` wins over its `value`; empty values come last in
 * either direction. Entries naming unknown or unsortable columns are skipped.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: readonly SfDataTableSort[],
  columns: readonly SfDataTableColumn<T>[],
): readonly T[] {
  const keys = sort
    .map((entry) => ({ entry, column: columns.find((c) => c.id === entry.id) }))
    .filter((k): k is { entry: SfDataTableSort; column: SfDataTableColumn<T> } => !!k.column && (!!k.column.compare || !!k.column.value));
  if (keys.length === 0) {
    return rows;
  }
  return [...rows].sort((a, b) => {
    for (const { entry, column } of keys) {
      const sign = entry.direction === 'asc' ? 1 : -1;
      if (column.compare) {
        const result = column.compare(a, b);
        if (result !== 0) {
          return result * sign;
        }
        continue;
      }
      const va = column.value!(a);
      const vb = column.value!(b);
      if (isEmpty(va) || isEmpty(vb)) {
        if (isEmpty(va) !== isEmpty(vb)) {
          return isEmpty(va) ? 1 : -1;
        }
        continue;
      }
      const result = compareValues(va, vb);
      if (result !== 0) {
        return result * sign;
      }
    }
    return 0;
  });
}

/** Rows whose searchable column texts contain `search` (case-insensitive), and that pass every picked filter. */
export function filterRows<T>(
  rows: readonly T[],
  query: SfDataTableQuery,
  columns: readonly SfDataTableColumn<T>[],
  filters: readonly SfDataTableFilter<T>[],
): readonly T[] {
  const term = query.search.trim().toLocaleLowerCase();
  const searchable = columns.filter((c) => c.value && c.searchable !== false);
  const active = filters
    .map((filter) => ({ filter, values: query.filters[filter.id] ?? [] }))
    .filter((f) => f.values.length > 0);
  if (!term && active.length === 0) {
    return rows;
  }
  return rows.filter((row) => {
    for (const { filter, values } of active) {
      if (filter.match) {
        if (!filter.match(row, values)) {
          return false;
        }
        continue;
      }
      const column = columns.find((c) => c.id === filter.id);
      if (!column?.value || !values.includes(textOf(column.value(row)))) {
        return false;
      }
    }
    return !term || searchable.some((c) => textOf(c.value!(row)).toLocaleLowerCase().includes(term));
  });
}

// ── Sort cycling ──────────────────────────────────────────────────────────────

/**
 * The sort after the user activated a column header. Alone: unsorted → ascending → descending → unsorted, and any other
 * sorted column is dropped (a column of a multi-sort starts over at ascending). With `multi` (Shift) the column is added as the next key, or its entry cycles in place.
 */
export function nextSort(
  current: readonly SfDataTableSort[],
  columnId: string,
  multi: boolean,
): SfDataTableSort[] {
  const index = current.findIndex((s) => s.id === columnId);
  const direction = index >= 0 ? current[index].direction : null;
  if (!multi) {
    // A column that is not the only sort key starts over as the only one.
    if (direction === null || current.length > 1) {
      return [{ id: columnId, direction: 'asc' }];
    }
    return direction === 'asc' ? [{ id: columnId, direction: 'desc' }] : [];
  }
  if (direction === null) {
    return [...current, { id: columnId, direction: 'asc' }];
  }
  if (direction === 'asc') {
    return current.map((s, i) => (i === index ? { id: columnId, direction: 'desc' } : s));
  }
  return current.filter((_, i) => i !== index);
}

// ── Query equality ────────────────────────────────────────────────────────────

export function sameSort(a: readonly SfDataTableSort[], b: readonly SfDataTableSort[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && s.direction === b[i].direction);
}

export function sameFilters(
  a: Readonly<Record<string, readonly string[]>>,
  b: Readonly<Record<string, readonly string[]>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key] ?? [];
    const y = b[key] ?? [];
    if (x.length !== y.length || x.some((v, i) => v !== y[i])) {
      return false;
    }
  }
  return true;
}

export function sameQuery(a: SfDataTableQuery, b: SfDataTableQuery): boolean {
  return a.search === b.search && a.page === b.page && sameSort(a.sort, b.sort) && sameFilters(a.filters, b.filters);
}

// ── URL format ────────────────────────────────────────────────────────────────

/** The query param name of `name` under `prefix` (`''`: no namespace). */
export function paramName(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

/** `name,-changed`: ids in priority order, `-` for descending. */
export function encodeSort(sort: readonly SfDataTableSort[]): string {
  return sort.map((s) => (s.direction === 'desc' ? `-${s.id}` : s.id)).join(',');
}

export function decodeSort(text: string): SfDataTableSort[] {
  return text
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token !== '-')
    .map((token) =>
      token.startsWith('-') ? { id: token.slice(1), direction: 'desc' as const } : { id: token, direction: 'asc' as const },
    );
}

/**
 * The query params of a query (for `queryParamsHandling: 'merge'`: a param at its default is `null`, which removes it).
 * `q` search, `sort` (omitted at `initialSort`; empty when the user removed every sort), `page` one-based (omitted on
 * the first page), and one repeated param per filter id.
 */
export function queryToParams(
  query: SfDataTableQuery,
  prefix: string,
  filterIds: readonly string[],
  initialSort: readonly SfDataTableSort[],
  withPage: boolean,
): Params {
  const params: Params = {
    [paramName(prefix, 'q')]: query.search || null,
    [paramName(prefix, 'sort')]: sameSort(query.sort, initialSort) ? null : encodeSort(query.sort),
    [paramName(prefix, 'page')]: withPage && query.page > 0 ? String(query.page + 1) : null,
  };
  for (const id of filterIds) {
    const values = query.filters[id] ?? [];
    params[paramName(prefix, id)] = values.length > 0 ? [...values] : null;
  }
  return params;
}

/** Reads a query back from the URL (see {@link queryToParams}); anything missing or malformed takes its default. */
export function paramsToQuery(
  params: ParamMap,
  prefix: string,
  filterIds: readonly string[],
  initialSort: readonly SfDataTableSort[],
  withPage: boolean,
): SfDataTableQuery {
  const sortParam = params.get(paramName(prefix, 'sort'));
  const page = withPage ? Number.parseInt(params.get(paramName(prefix, 'page')) ?? '', 10) : NaN;
  const filters: Record<string, string[]> = {};
  for (const id of filterIds) {
    const values = params.getAll(paramName(prefix, id)).filter((v) => typeof v === 'string' && v.length > 0);
    if (values.length > 0) {
      filters[id] = values;
    }
  }
  return {
    search: params.get(paramName(prefix, 'q')) ?? '',
    filters,
    sort: sortParam === null ? [...initialSort] : decodeSort(sortParam),
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
  };
}

// ── Column layout ─────────────────────────────────────────────────────────────

export interface ResolvedColumns<T> {
  /** All columns in display order. */
  ordered: SfDataTableColumn<T>[];
  hidden: ReadonlySet<string>;
  widths: Readonly<Record<string, number>>;
}

export function isHideable<T>(column: SfDataTableColumn<T>): boolean {
  return column.hideable !== false;
}

/**
 * Applies a stored layout to the column definitions: stored order first (unknown ids dropped, new columns appended in
 * definition order), stored hidden ids (or the columns' own `hidden` when nothing is stored; a column that is not
 * hideable is never hidden) and stored widths.
 */
export function resolveColumns<T>(
  columns: readonly SfDataTableColumn<T>[],
  layout: TableColumnsPreference,
): ResolvedColumns<T> {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const ordered: SfDataTableColumn<T>[] = [];
  for (const id of layout.order ?? []) {
    const column = byId.get(id);
    if (column && !ordered.includes(column)) {
      ordered.push(column);
    }
  }
  for (const column of columns) {
    if (!ordered.includes(column)) {
      ordered.push(column);
    }
  }
  const hiddenIds = layout.hidden ?? columns.filter((c) => c.hidden).map((c) => c.id);
  const hidden = new Set(hiddenIds.filter((id) => byId.has(id) && isHideable(byId.get(id)!)));
  return { ordered, hidden, widths: layout.widths ?? {} };
}

/** `order` with `id` moved by `delta` places (clamped). */
export function moveInOrder(order: readonly string[], id: string, delta: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) {
    return [...order];
  }
  const to = Math.max(0, Math.min(order.length - 1, from + delta));
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
