import type { components } from '../../core/api/generated/schema.d.ts';

export type SearchResultView = components['schemas']['SearchResultView'];
export type SearchHitView = components['schemas']['SearchHitView'];
export type SearchHighlight = components['schemas']['SearchHighlight'];
export type SearchStatusView = components['schemas']['SearchStatusView'];

/** Types in the order results are grouped, most edited first. */
export const TYPE_ORDER = [
  'PAGE',
  'RECORD',
  'MEDIA',
  'GLOBAL_SET',
  'PAGE_REFERENCE',
  'FOLDER',
  'PAGE_TEMPLATE',
  'SECTION_TEMPLATE',
  'DATASET',
] as const;

export const TYPE_LABELS: Record<string, string> = {
  PAGE: 'Pages',
  RECORD: 'Records',
  MEDIA: 'Media',
  GLOBAL_SET: 'Globals',
  PAGE_REFERENCE: 'Navigation',
  FOLDER: 'Folders',
  PAGE_TEMPLATE: 'Page templates',
  SECTION_TEMPLATE: 'Section templates',
  DATASET: 'Datasets',
};

export const TYPE_ICONS: Record<string, string> = {
  PAGE: 'description',
  RECORD: 'dataset',
  MEDIA: 'perm_media',
  GLOBAL_SET: 'tune',
  PAGE_REFERENCE: 'account_tree',
  FOLDER: 'folder',
  PAGE_TEMPLATE: 'dashboard_customize',
  SECTION_TEMPLATE: 'view_agenda',
  DATASET: 'table_view',
};

export const MATCHED_IN_LABELS: Record<string, string> = {
  TITLE: 'Title',
  UID: 'UID',
  CONTENT: 'Content',
  SOURCE: 'Source',
};

export const DEFAULT_PAGE_SIZE = 20;
export const PALETTE_SIZE = 20;
export const PALETTE_GROUP_LIMIT = 5;

/** A snippet split into plain and highlighted runs, rendered as text nodes and `<mark>`s (never as HTML). */
export interface SnippetPart {
  text: string;
  mark: boolean;
}

export function highlightParts(text: string | undefined, ranges: SearchHighlight[] | undefined): SnippetPart[] {
  const value = text ?? '';
  const sorted = (ranges ?? [])
    .map((r) => ({ start: Math.max(0, r.start ?? 0), end: Math.min(value.length, r.end ?? 0) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const range of sorted) {
    const start = Math.max(range.start, cursor);
    if (range.end <= start) {
      continue;
    }
    if (start > cursor) {
      parts.push({ text: value.slice(cursor, start), mark: false });
    }
    parts.push({ text: value.slice(start, range.end), mark: true });
    cursor = range.end;
  }
  if (cursor < value.length) {
    parts.push({ text: value.slice(cursor), mark: false });
  }
  return parts;
}

export interface HitGroup {
  type: string;
  label: string;
  icon: string;
  hits: SearchHitView[];
  /** Every hit of this type (facet count), at least the number shown. */
  total: number;
}

/** Hits grouped by type in {@link TYPE_ORDER}, at most `limit` per group; unknown types come last. */
export function groupHits(result: SearchResultView | null, limit = PALETTE_GROUP_LIMIT): HitGroup[] {
  if (!result) {
    return [];
  }
  const byType = new Map<string, SearchHitView[]>();
  for (const hit of result.content ?? []) {
    const type = hit.type ?? 'UNKNOWN';
    byType.set(type, [...(byType.get(type) ?? []), hit]);
  }
  const order = [...TYPE_ORDER, ...[...byType.keys()].filter((t) => !(TYPE_ORDER as readonly string[]).includes(t))];
  const facets = result.facets?.types ?? {};
  return order
    .filter((type) => byType.has(type))
    .map((type) => {
      const hits = byType.get(type) ?? [];
      return {
        type,
        label: TYPE_LABELS[type] ?? type,
        icon: TYPE_ICONS[type] ?? 'draft',
        hits: hits.slice(0, limit),
        total: Math.max(facets[type] ?? 0, hits.length),
      };
    });
}

/**
 * Whether the palette searches this input: at least two characters, or a single digit (uids like `1` or `7` are
 * the only one-character inputs that name something).
 */
export function shouldSearch(q: string): boolean {
  const trimmed = q.trim();
  return trimmed.length >= 2 || /^\d$/.test(trimmed);
}

/** The search page's state, entirely in query params. */
export interface SearchPageState {
  q: string;
  types: string[];
  folder: string;
  page: number;
  size: number;
}

export interface QueryParamSource {
  get(name: string): string | null;
  getAll(name: string): string[];
}

export function stateFromParams(params: QueryParamSource): SearchPageState {
  const page = Number.parseInt(params.get('page') ?? '', 10);
  const size = Number.parseInt(params.get('size') ?? '', 10);
  return {
    q: params.get('q') ?? '',
    types: normalizeTypes(params.getAll('type')),
    folder: params.get('folder') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 0,
    size: Number.isFinite(size) && size > 0 && size <= 100 ? size : DEFAULT_PAGE_SIZE,
  };
}

/** Query params for a state: defaults are `null` (removed from the URL) and types are sorted, so equal states give
 * equal URLs and no history entry is pushed twice. */
export function paramsFromState(state: SearchPageState): Record<string, string | string[] | null> {
  const types = normalizeTypes(state.types);
  return {
    q: state.q.trim() === '' ? null : state.q,
    type: types.length === 0 ? null : types,
    folder: state.folder.trim() === '' ? null : state.folder.trim(),
    page: state.page > 0 ? String(state.page) : null,
    size: state.size !== DEFAULT_PAGE_SIZE ? String(state.size) : null,
  };
}

export function normalizeTypes(types: string[]): string[] {
  return [...new Set(types.map((t) => t.trim().toUpperCase()).filter((t) => t.length > 0))].sort();
}

/** `types` with `type` switched on or off. */
export function toggleType(types: string[], type: string): string[] {
  return types.includes(type) ? types.filter((t) => t !== type) : normalizeTypes([...types, type]);
}

export function hasFilters(state: SearchPageState): boolean {
  return state.types.length > 0 || state.folder.trim() !== '';
}

/** "Index is catching up (3 revisions behind)", or `null` when current. */
export function lagMessage(status: SearchStatusView | null): string | null {
  const lag = status?.lag ?? 0;
  if (!status || lag <= 0 || status.state === 'UNAVAILABLE') {
    return null;
  }
  return `Index is catching up (${lag} ${lag === 1 ? 'revision' : 'revisions'} behind)`;
}
