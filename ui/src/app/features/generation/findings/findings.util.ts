import type { Params } from '@angular/router';
import type { components } from '../../../core/api/generated/schema.d.ts';

export type FindingView = components['schemas']['FindingView'];
export type FindingPageView = components['schemas']['FindingPageView'];
export type FindingCountsView = components['schemas']['FindingCountsView'];
export type QualityRuleItem = components['schemas']['QualityRuleItem'];

export type FindingSeverity = 'ERROR' | 'WARNING';

/** The categories of the quality rules, as the findings filter takes them, in display order. */
export const FINDING_CATEGORIES = ['LINKS', 'SEO', 'ACCESSIBILITY'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  LINKS: 'Links',
  SEO: 'SEO',
  ACCESSIBILITY: 'Accessibility',
};

export const FINDINGS_PAGE_SIZE = 25;

/** The run details tab the findings live in, as `?tab=` names it. */
export const FINDINGS_TAB = 'findings';

/**
 * A run's findings filters as they live in the URL query (like the M26 audit view), so a findings view can be shared.
 * Every filter narrows the result; `null` / empty means "any".
 */
export interface FindingFilter {
  severity: FindingSeverity | null;
  category: FindingCategory | null;
  /** Rule codes (`SF-CHK-0201`); several match any of them. */
  codes: string[];
  /** The uuid of the page the findings are on. */
  asset: string | null;
  channel: string | null;
  locale: string | null;
  /** The start of the output path (`blog/`). */
  path: string | null;
  page: number;
}

export const NO_FINDING_FILTER: FindingFilter = {
  severity: null,
  category: null,
  codes: [],
  asset: null,
  channel: null,
  locale: null,
  path: null,
  page: 0,
};

/**
 * The query parameter of each filter. Prefixed, because the findings share the Generation screen's URL with `run`
 * and `tab`.
 */
const PARAMS = {
  severity: 'fSeverity',
  category: 'fCategory',
  codes: 'fCode',
  asset: 'fAsset',
  channel: 'fChannel',
  locale: 'fLocale',
  path: 'fPath',
  page: 'fPage',
} as const satisfies Record<keyof FindingFilter, string>;

/** Every query parameter the findings view owns (to clear them all when it closes). */
export const FINDING_PARAM_NAMES: readonly string[] = Object.values(PARAMS);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the filters from query parameters; anything malformed is dropped rather than sent. */
export function findingFilterFromParams(params: Params): FindingFilter {
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  const severity = text(params[PARAMS.severity])?.toUpperCase();
  const category = text(params[PARAMS.category])?.toUpperCase();
  const rawCodes: unknown[] = Array.isArray(params[PARAMS.codes]) ? params[PARAMS.codes] : [params[PARAMS.codes]];
  const codes = rawCodes.map(text).filter((code): code is string => code !== null);
  const asset = text(params[PARAMS.asset]);
  const page = Number(params[PARAMS.page]);
  return {
    severity: severity === 'ERROR' || severity === 'WARNING' ? severity : null,
    category: (FINDING_CATEGORIES as readonly string[]).includes(category ?? '') ? (category as FindingCategory) : null,
    codes: [...new Set(codes)],
    asset: asset && UUID.test(asset) ? asset : null,
    channel: text(params[PARAMS.channel]),
    locale: text(params[PARAMS.locale]),
    // The path prefix keeps its spaces: it is compared with output paths as typed.
    path: typeof params[PARAMS.path] === 'string' && params[PARAMS.path] !== '' ? params[PARAMS.path] : null,
    page: Number.isInteger(page) && page > 0 ? page : 0,
  };
}

/** The query parameters for `filter`; empty filters are `null`, so a merge removes them and the URL stays short. */
export function paramsFromFindingFilter(filter: FindingFilter): Params {
  return {
    [PARAMS.severity]: filter.severity,
    [PARAMS.category]: filter.category,
    [PARAMS.codes]: filter.codes.length > 0 ? filter.codes : null,
    [PARAMS.asset]: filter.asset,
    [PARAMS.channel]: filter.channel,
    [PARAMS.locale]: filter.locale,
    [PARAMS.path]: filter.path,
    [PARAMS.page]: filter.page > 0 ? filter.page : null,
  };
}

/** The `GET /generations/{runId}/findings` query for `filter`, without empty filters. */
export function findingApiParams(filter: FindingFilter, size = FINDINGS_PAGE_SIZE): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = { page: String(filter.page), size: String(size) };
  if (filter.severity) {
    params['severity'] = filter.severity;
  }
  if (filter.category) {
    params['category'] = filter.category;
  }
  if (filter.codes.length > 0) {
    params['code'] = filter.codes;
  }
  if (filter.asset) {
    params['assetUuid'] = filter.asset;
  }
  if (filter.channel) {
    params['channel'] = filter.channel;
  }
  if (filter.locale) {
    params['locale'] = filter.locale;
  }
  if (filter.path) {
    params['pathPrefix'] = filter.path;
  }
  return params;
}

/** Whether any filter narrows the findings (the page number doesn't). */
export function hasFindingFilters(filter: FindingFilter): boolean {
  return (
    filter.severity !== null ||
    filter.category !== null ||
    filter.codes.length > 0 ||
    filter.asset !== null ||
    filter.channel !== null ||
    filter.locale !== null ||
    filter.path !== null
  );
}

export function categoryLabel(category: string | null | undefined): string {
  const key = (category ?? '').toUpperCase() as FindingCategory;
  return CATEGORY_LABELS[key] ?? category ?? '';
}

/** A category's count in a run's counts (`byCategory` is keyed by the lower-case name). */
export function categoryCount(counts: FindingCountsView | null | undefined, category: FindingCategory): number {
  return counts?.byCategory?.[category.toLowerCase()] ?? 0;
}

const NUMBER = new Intl.NumberFormat('en-US');

/** "3 errors" / "1 warning". */
export function severityCountLabel(count: number | undefined, severity: FindingSeverity): string {
  const n = count ?? 0;
  const noun = severity === 'ERROR' ? 'error' : 'warning';
  return `${NUMBER.format(n)} ${n === 1 ? noun : `${noun}s`}`;
}

/** The run list's summary of a run's findings: "3 errors · 41 warnings", "41 warnings", "No findings". */
export function findingCountsLabel(counts: FindingCountsView | null | undefined): string {
  if (!counts) {
    return '';
  }
  const parts: string[] = [];
  if ((counts.errors ?? 0) > 0) {
    parts.push(severityCountLabel(counts.errors, 'ERROR'));
  }
  if ((counts.warnings ?? 0) > 0) {
    parts.push(severityCountLabel(counts.warnings, 'WARNING'));
  }
  return parts.length > 0 ? parts.join(' · ') : 'No findings';
}
