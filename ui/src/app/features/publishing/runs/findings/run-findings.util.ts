import type { ParamMap } from '@angular/router';
import type { components } from '../../../../core/api/generated/schema.d.ts';

export type FindingView = components['schemas']['FindingView'];
export type FindingPageView = components['schemas']['FindingPageView'];
export type QualityRuleItem = components['schemas']['QualityRuleItem'];

/** The query parameters of a run's findings view; they belong to the run that is open. */
export const FINDING_QUERY_PARAMS = ['fsev', 'fcat', 'frule', 'flang', 'fpath'] as const;

export type FindingSeverityKey = 'error' | 'warning';
export type FindingCategoryKey = 'links' | 'seo' | 'accessibility';

export const FINDING_SEVERITIES: readonly FindingSeverityKey[] = ['error', 'warning'];
export const FINDING_CATEGORIES: readonly FindingCategoryKey[] = ['links', 'seo', 'accessibility'];

/** The server's largest page of findings. */
export const FINDINGS_PAGE_SIZE = 200;

/** What narrows a run's findings, as the URL and the screen hold it (lower-case names, `lang` as the server writes it). */
export interface RunFindingsFilter {
  readonly severity: FindingSeverityKey | null;
  readonly category: FindingCategoryKey | null;
  /** Rule codes (`SF-CHK-0301`); several match any of them. */
  readonly rules: readonly string[];
  readonly lang: string | null;
  /** The start of the output path (`de/news/`). */
  readonly path: string;
}

export const NO_RUN_FINDINGS_FILTER: RunFindingsFilter = { severity: null, category: null, rules: [], lang: null, path: '' };

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.find((candidate) => candidate === value?.toLowerCase()) ?? null;

/** Reads the filter from the query; anything malformed is dropped rather than sent. */
export function filterFromParams(params: ParamMap): RunFindingsFilter {
  const rules = (params.get('frule') ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code !== '');
  return {
    severity: oneOf(params.get('fsev'), FINDING_SEVERITIES),
    category: oneOf(params.get('fcat'), FINDING_CATEGORIES),
    rules: [...new Set(rules)],
    lang: params.get('flang')?.trim() || null,
    path: params.get('fpath') ?? '',
  };
}

/** The query parameters for `filter`; empty ones are `null`, so a merge removes them and the URL stays short. */
export function paramsFromFilter(filter: RunFindingsFilter): Record<(typeof FINDING_QUERY_PARAMS)[number], string | null> {
  return {
    fsev: filter.severity,
    fcat: filter.category,
    frule: filter.rules.length ? filter.rules.join(',') : null,
    flang: filter.lang,
    fpath: filter.path.trim() ? filter.path : null,
  };
}

export function isFiltered(filter: RunFindingsFilter): boolean {
  return !!(filter.severity || filter.category || filter.rules.length || filter.lang || filter.path.trim());
}

/** The `findings` and `findings/facets` query for `filter`, without empty filters (the severity and category in upper case). */
export function findingApiParams(filter: RunFindingsFilter): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  if (filter.severity) {
    params['severity'] = filter.severity.toUpperCase();
  }
  if (filter.category) {
    params['category'] = filter.category.toUpperCase();
  }
  if (filter.rules.length) {
    params['code'] = [...filter.rules];
  }
  if (filter.lang) {
    params['locale'] = filter.lang;
  }
  if (filter.path.trim()) {
    params['pathPrefix'] = filter.path;
  }
  return params;
}
