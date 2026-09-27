import { describe, expect, it } from 'vitest';
import {
  NO_FINDING_FILTER,
  categoryCount,
  findingApiParams,
  findingCountsLabel,
  findingFilterFromParams,
  hasFindingFilters,
  paramsFromFindingFilter,
} from './findings.util';

const ALPHA = '0b7e5a0c-4f7e-4c1e-9a55-3b1f7d2c9e11';

describe('findings filter in the URL', () => {
  it('reads every filter from the query and drops malformed values', () => {
    expect(
      findingFilterFromParams({
        run: '12',
        tab: 'findings',
        fSeverity: 'error',
        fCategory: 'accessibility',
        fCode: ['SF-CHK-0301', 'SF-CHK-0101', 'SF-CHK-0301', ''],
        fAsset: ALPHA,
        fChannel: 'html',
        fLocale: 'en',
        fPath: 'en/blog/',
        fPage: '2',
      }),
    ).toEqual({
      severity: 'ERROR',
      category: 'ACCESSIBILITY',
      codes: ['SF-CHK-0301', 'SF-CHK-0101'],
      asset: ALPHA,
      channel: 'html',
      locale: 'en',
      path: 'en/blog/',
      page: 2,
    });
    expect(
      findingFilterFromParams({ fSeverity: 'OFF', fCategory: 'layout', fAsset: 'alpha', fPage: '-1', fCode: 'SF-CHK-0201' }),
    ).toEqual({ ...NO_FINDING_FILTER, codes: ['SF-CHK-0201'] });
  });

  it('writes the filters back, empty ones as null so a merge removes them', () => {
    const filter = { ...NO_FINDING_FILTER, severity: 'WARNING' as const, codes: ['SF-CHK-0201'], page: 3 };
    expect(paramsFromFindingFilter(filter)).toEqual({
      fSeverity: 'WARNING',
      fCategory: null,
      fCode: ['SF-CHK-0201'],
      fAsset: null,
      fChannel: null,
      fLocale: null,
      fPath: null,
      fPage: 3,
    });
    expect(findingFilterFromParams(paramsFromFindingFilter(filter))).toEqual(filter);
  });

  it('turns filters into the findings API query without empty ones', () => {
    expect(findingApiParams(NO_FINDING_FILTER)).toEqual({ page: '0', size: '25' });
    expect(
      findingApiParams({
        severity: 'ERROR',
        category: 'LINKS',
        codes: ['SF-CHK-0101', 'SF-CHK-0102'],
        asset: ALPHA,
        channel: 'html',
        locale: 'de',
        path: 'blog/',
        page: 1,
      }),
    ).toEqual({
      page: '1',
      size: '25',
      severity: 'ERROR',
      category: 'LINKS',
      code: ['SF-CHK-0101', 'SF-CHK-0102'],
      assetUuid: ALPHA,
      channel: 'html',
      locale: 'de',
      pathPrefix: 'blog/',
    });
  });

  it('knows whether anything narrows the findings (not the page number)', () => {
    expect(hasFindingFilters({ ...NO_FINDING_FILTER, page: 4 })).toBe(false);
    expect(hasFindingFilters({ ...NO_FINDING_FILTER, path: 'en/' })).toBe(true);
  });
});

describe('finding counts', () => {
  it('summarizes a run: errors only when there are any', () => {
    expect(findingCountsLabel({ errors: 3, warnings: 41, byCategory: {}, truncated: 0 })).toBe('3 errors · 41 warnings');
    expect(findingCountsLabel({ errors: 0, warnings: 1, byCategory: {}, truncated: 0 })).toBe('1 warning');
    expect(findingCountsLabel({ errors: 1, warnings: 0, byCategory: {}, truncated: 0 })).toBe('1 error');
    expect(findingCountsLabel({ errors: 0, warnings: 0, byCategory: {}, truncated: 0 })).toBe('No findings');
    expect(findingCountsLabel(undefined)).toBe('');
  });

  it('reads category counts by their lower-case key', () => {
    const counts = { errors: 0, warnings: 5, byCategory: { links: 2, seo: 3, accessibility: 0 }, truncated: 0 };
    expect(categoryCount(counts, 'SEO')).toBe(3);
    expect(categoryCount(counts, 'ACCESSIBILITY')).toBe(0);
  });
});
