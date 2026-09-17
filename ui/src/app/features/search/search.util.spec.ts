import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  groupHits,
  hasFilters,
  highlightParts,
  lagMessage,
  paramsFromState,
  shouldSearch,
  stateFromParams,
  toggleType,
  type QueryParamSource,
  type SearchResultView,
} from './search.util';

function params(values: Record<string, string | string[]>): QueryParamSource {
  return {
    get: (name) => {
      const value = values[name];
      return value === undefined ? null : Array.isArray(value) ? (value[0] ?? null) : value;
    },
    getAll: (name) => {
      const value = values[name];
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    },
  };
}

describe('highlightParts', () => {
  it('splits a snippet into plain and marked runs', () => {
    expect(highlightParts('The lighthouse keeper', [{ start: 4, end: 14 }])).toEqual([
      { text: 'The ', mark: false },
      { text: 'lighthouse', mark: true },
      { text: ' keeper', mark: false },
    ]);
  });

  it('keeps markup in the text as text: a script tag is just characters', () => {
    const parts = highlightParts('<script>alert(1)</script> teaser', [{ start: 26, end: 32 }]);
    expect(parts).toEqual([
      { text: '<script>alert(1)</script> ', mark: false },
      { text: 'teaser', mark: true },
    ]);
  });

  it('ignores out-of-bounds, empty and overlapping ranges safely', () => {
    expect(highlightParts('abcdef', [{ start: 4, end: 99 }, { start: -3, end: 2 }, { start: 1, end: 3 }, { start: 5, end: 5 }]))
      .toEqual([
        { text: 'ab', mark: true },
        { text: 'c', mark: true },
        { text: 'd', mark: false },
        { text: 'ef', mark: true },
      ]);
    expect(highlightParts(undefined, undefined)).toEqual([]);
  });
});

describe('groupHits', () => {
  const result: SearchResultView = {
    content: [
      { uuid: 'm1', type: 'MEDIA' },
      { uuid: 'p1', type: 'PAGE' },
      { uuid: 't1', type: 'SECTION_TEMPLATE' },
      ...Array.from({ length: 6 }, (_, i) => ({ uuid: `p${i + 2}`, type: 'PAGE' })),
    ],
    page: { size: 20, number: 0, totalElements: 9, totalPages: 1, totalIsLowerBound: false },
    facets: { types: { PAGE: 12, MEDIA: 1, SECTION_TEMPLATE: 1 } } as unknown as Record<string, never>,
    latestRevision: 1,
  } as SearchResultView;

  it('groups by type in a fixed order, at most five per group, with the facet total', () => {
    const groups = groupHits(result);
    expect(groups.map((g) => g.type)).toEqual(['PAGE', 'MEDIA', 'SECTION_TEMPLATE']);
    expect(groups[0].hits.map((h) => h.uuid)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(groups[0].total).toBe(12);
    expect(groups[0].label).toBe('Pages');
    expect(groups[2].label).toBe('Section templates');
  });

  it('is empty without a result', () => {
    expect(groupHits(null)).toEqual([]);
  });
});

describe('shouldSearch', () => {
  it('needs two characters, or a single digit', () => {
    expect(shouldSearch('')).toBe(false);
    expect(shouldSearch(' t ')).toBe(false);
    expect(shouldSearch('te')).toBe(true);
    expect(shouldSearch('7')).toBe(true);
  });
});

describe('search page query params', () => {
  it('reads repeatable types sorted and falls back to defaults', () => {
    expect(stateFromParams(params({ q: 'teaser', type: ['section_template', 'PAGE', 'PAGE'], page: '2', size: 'x' }))).toEqual({
      q: 'teaser',
      types: ['PAGE', 'SECTION_TEMPLATE'],
      folder: '',
      page: 2,
      size: DEFAULT_PAGE_SIZE,
    });
    expect(stateFromParams(params({ page: '-4', size: '500' }))).toMatchObject({ page: 0, size: DEFAULT_PAGE_SIZE });
  });

  it('writes defaults as null and types sorted, so equal states give equal URLs', () => {
    expect(paramsFromState({ q: 'teaser', types: ['SECTION_TEMPLATE', 'PAGE'], folder: ' ', page: 0, size: DEFAULT_PAGE_SIZE }))
      .toEqual({ q: 'teaser', type: ['PAGE', 'SECTION_TEMPLATE'], folder: null, page: null, size: null });
    expect(paramsFromState({ q: '', types: [], folder: '/media_root/', page: 3, size: 50 })).toEqual({
      q: null,
      type: null,
      folder: '/media_root/',
      page: '3',
      size: '50',
    });
  });

  it('round-trips', () => {
    const state = { q: 'x y', types: ['MEDIA', 'PAGE'], folder: '/pages_root/news/', page: 1, size: 50 };
    const written = paramsFromState(state);
    const read = stateFromParams(params(Object.fromEntries(Object.entries(written).filter(([, v]) => v !== null)) as Record<string, string | string[]>));
    expect(read).toEqual(state);
  });

  it('toggles types and knows when filters are active', () => {
    expect(toggleType(['PAGE'], 'MEDIA')).toEqual(['MEDIA', 'PAGE']);
    expect(toggleType(['MEDIA', 'PAGE'], 'MEDIA')).toEqual(['PAGE']);
    expect(hasFilters({ q: 'a', types: [], folder: '', page: 0, size: 20 })).toBe(false);
    expect(hasFilters({ q: 'a', types: [], folder: '/x/', page: 0, size: 20 })).toBe(true);
  });
});

describe('lagMessage', () => {
  it('describes a lagging index', () => {
    expect(lagMessage({ state: 'CATCHING_UP', lag: 3, latestRevision: 9 })).toBe('Index is catching up (3 revisions behind)');
    expect(lagMessage({ state: 'CATCHING_UP', lag: 1, latestRevision: 9 })).toBe('Index is catching up (1 revision behind)');
    expect(lagMessage({ state: 'READY', lag: 0, latestRevision: 9 })).toBeNull();
    expect(lagMessage({ state: 'UNAVAILABLE', lag: 4, latestRevision: 9 })).toBeNull();
    expect(lagMessage(null)).toBeNull();
  });
});
