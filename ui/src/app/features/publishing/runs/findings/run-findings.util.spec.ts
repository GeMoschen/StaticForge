import { convertToParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  NO_RUN_FINDINGS_FILTER,
  filterFromParams,
  findingApiParams,
  isFiltered,
  paramsFromFilter,
} from './run-findings.util';

describe('findings filter in the URL', () => {
  it('reads every filter from the query and drops malformed values', () => {
    expect(
      filterFromParams(convertToParamMap({ fsev: 'ERROR', fcat: 'accessibility', frule: 'SF-CHK-0301, SF-CHK-0101,SF-CHK-0301,', flang: 'de', fpath: 'de/news/' })),
    ).toEqual({ severity: 'error', category: 'accessibility', rules: ['SF-CHK-0301', 'SF-CHK-0101'], lang: 'de', path: 'de/news/' });
    expect(filterFromParams(convertToParamMap({ fsev: 'off', fcat: 'layout', flang: ' ' }))).toEqual(NO_RUN_FINDINGS_FILTER);
  });

  it('writes the filter back, empty parts as null so a merge removes them', () => {
    expect(paramsFromFilter({ ...NO_RUN_FINDINGS_FILTER, severity: 'warning', rules: ['A', 'B'] })).toEqual({
      fsev: 'warning',
      fcat: null,
      frule: 'A,B',
      flang: null,
      fpath: null,
    });
    expect(paramsFromFilter(NO_RUN_FINDINGS_FILTER)).toEqual({ fsev: null, fcat: null, frule: null, flang: null, fpath: null });
  });

  it('knows whether anything narrows the findings', () => {
    expect(isFiltered(NO_RUN_FINDINGS_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_RUN_FINDINGS_FILTER, path: '  ' })).toBe(false);
    expect(isFiltered({ ...NO_RUN_FINDINGS_FILTER, lang: 'en' })).toBe(true);
  });

  it('sends the filter to the server in its words, leaving empty parts out', () => {
    expect(findingApiParams(NO_RUN_FINDINGS_FILTER)).toEqual({});
    expect(
      findingApiParams({ severity: 'error', category: 'seo', rules: ['SF-CHK-0204'], lang: 'en', path: 'en/blog/' }),
    ).toEqual({ severity: 'ERROR', category: 'SEO', code: ['SF-CHK-0204'], locale: 'en', pathPrefix: 'en/blog/' });
  });
});
