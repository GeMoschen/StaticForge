import type { RecordSetQuery, RecordSetQueryDiagnostic, RecordSort } from './content.service';

/**
 * A record set query as the query panel edits it (M25.5.1): the text of each part as typed, sort
 * keys as rows. `limit`/`offset` stay strings so a half-typed number is never silently dropped.
 */
export interface SetQueryDraft {
  where: string;
  sort: RecordSort[];
  limit: string;
  offset: string;
}

export const EMPTY_DRAFT: SetQueryDraft = { where: '', sort: [], limit: '', offset: '' };

/**
 * `"role,-joined"` → sort rows. Mirrors `DatasetQueryParser.parseSort`: comma-separated field names,
 * `-` for descending, duplicates keep their first occurrence.
 */
export function parseSortSpec(spec: string | null | undefined): RecordSort[] {
  const keys: RecordSort[] = [];
  for (const raw of (spec ?? '').split(',')) {
    const part = raw.trim();
    const descending = part.startsWith('-');
    const field = (descending ? part.slice(1) : part).trim();
    if (field && !keys.some((k) => k.field === field)) {
      keys.push({ field, direction: descending ? 'desc' : 'asc' });
    }
  }
  return keys;
}

/** Sort rows → the stored sort spec (`"role,-joined"`), or `undefined` for none. */
export function sortSpec(sort: readonly RecordSort[]): string | undefined {
  const parts = sort.filter((s) => s.field).map((s) => (s.direction === 'desc' ? '-' : '') + s.field);
  return parts.length > 0 ? parts.join(',') : undefined;
}

/** The stored query as an editable draft. */
export function draftOf(query: RecordSetQuery | null | undefined): SetQueryDraft {
  return {
    where: query?.where ?? '',
    sort: parseSortSpec(query?.sort),
    limit: query?.limit != null ? String(query.limit) : '',
    offset: query?.offset != null ? String(query.offset) : '',
  };
}

/**
 * Local findings the server never needs to see: `limit`/`offset` must be whole numbers, 0 or more.
 * Same shape as the server's diagnostics so the panel lists both the same way.
 */
export function localDiagnostics(draft: SetQueryDraft): RecordSetQueryDiagnostic[] {
  const findings: RecordSetQueryDiagnostic[] = [];
  for (const field of ['limit', 'offset'] as const) {
    const text = draft[field].trim();
    if (text && !/^\d+$/.test(text)) {
      findings.push({
        field,
        severity: 'ERROR',
        message: `${field === 'limit' ? 'Limit' : 'Offset'} must be a whole number, 0 or more.`,
        line: 0,
        column: 0,
      });
    }
  }
  return findings;
}

/**
 * The draft as the wire query: blank parts left out, exactly as the server stores and returns a
 * query. Only meaningful when {@link localDiagnostics} is empty.
 */
export function queryOf(draft: SetQueryDraft): RecordSetQuery {
  const query: RecordSetQuery = {};
  const where = draft.where.trim();
  if (where) {
    query.where = where;
  }
  const sort = sortSpec(draft.sort);
  if (sort) {
    query.sort = sort;
  }
  const limit = draft.limit.trim();
  if (limit) {
    query.limit = Number(limit);
  }
  const offset = draft.offset.trim();
  if (offset) {
    query.offset = Number(offset);
  }
  return query;
}

/** Whether two drafts mean the same stored query (whitespace and blank parts don't count). */
export function sameQuery(a: SetQueryDraft, b: SetQueryDraft): boolean {
  const left = queryOf(a);
  const right = queryOf(b);
  return (
    left.where === right.where &&
    left.sort === right.sort &&
    a.limit.trim() === b.limit.trim() &&
    a.offset.trim() === b.offset.trim()
  );
}

/**
 * The grid's own filter and sort as a set query draft ("Use current filter as set query"): `where`
 * and sort keys replace the draft's, `limit`/`offset` are kept — the grid has neither.
 */
export function adoptGridFilter(draft: SetQueryDraft, where: string, sort: readonly RecordSort[]): SetQueryDraft {
  return { ...draft, where: where.trim(), sort: sort.map((s) => ({ ...s })) };
}

/** Moves the sort key at `index` by `delta` (−1 up, +1 down); out-of-range moves change nothing. */
export function moveSortKey(sort: readonly RecordSort[], index: number, delta: number): RecordSort[] {
  const target = index + delta;
  if (index < 0 || index >= sort.length || target < 0 || target >= sort.length) {
    return [...sort];
  }
  const next = [...sort];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** "3 of 12 records match" wording for the panel's live count. */
export function matchSummary(matchCount: number, total: number, selectedCount: number): string {
  const noun = total === 1 ? 'record' : 'records';
  const verb = matchCount === 1 ? 'matches' : 'match';
  const base = `${matchCount} of ${total} ${noun} ${verb}`;
  return selectedCount !== matchCount ? `${base} · the set shows ${selectedCount}` : base;
}
