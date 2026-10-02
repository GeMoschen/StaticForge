import { describe, expect, it } from 'vitest';
import {
  HISTORY_KINDS,
  KIND_CHANGE_TYPES,
  NO_HISTORY_FILTER,
  dateBounds,
  filterFromQuery,
  filterToApi,
  filterToQuery,
  isFiltered,
  kindOf,
} from './history-model';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('kindOf', () => {
  it('groups every API change type into one kind, once', () => {
    const all = HISTORY_KINDS.flatMap((kind) => KIND_CHANGE_TYPES[kind]);
    expect(new Set(all).size).toBe(all.length);
    for (const kind of HISTORY_KINDS) {
      for (const type of KIND_CHANGE_TYPES[kind]) {
        expect(kindOf(type)).toBe(kind);
      }
    }
  });

  it('counts an unknown or missing type as an edit', () => {
    expect(kindOf('SOMETHING_NEW')).toBe('edit');
    expect(kindOf(null)).toBe('edit');
    expect(kindOf('release')).toBe('release');
  });
});

describe('dateBounds', () => {
  it('has no bounds for any time', () => {
    expect(dateBounds({ range: 'any', from: null, to: null }, NOW)).toEqual({});
  });

  it('counts a preset back from now', () => {
    expect(dateBounds({ range: 'today', from: null, to: null }, NOW)).toEqual({ from: new Date(NOW - DAY).toISOString() });
    expect(dateBounds({ range: 'week', from: null, to: null }, NOW).from).toBe(new Date(NOW - 7 * DAY).toISOString());
    expect(dateBounds({ range: 'month', from: null, to: null }, NOW).from).toBe(new Date(NOW - 30 * DAY).toISOString());
  });

  it('covers whole local days for a custom range: from the start of the first, to the start after the last', () => {
    const bounds = dateBounds({ range: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(bounds.from).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(bounds.to).toBe(new Date(new Date('2026-09-30T00:00:00').getTime() + DAY).toISOString());
  });

  it('leaves an open end open and ignores a malformed day', () => {
    expect(dateBounds({ range: 'custom', from: '2026-09-01', to: null }).to).toBeUndefined();
    expect(dateBounds({ range: 'custom', from: null, to: '2026-09-30' }).from).toBeUndefined();
    expect(dateBounds({ range: 'custom', from: '2026-13-45', to: 'soon' })).toEqual({});
  });
});

describe('the filter in the URL', () => {
  const query = (params: Record<string, string>) => (name: string) => params[name] ?? null;

  it('is empty without parameters', () => {
    expect(filterFromQuery(query({}))).toEqual(NO_HISTORY_FILTER);
    expect(isFiltered(NO_HISTORY_FILTER)).toBe(false);
  });

  it('round-trips every part', () => {
    const filter = filterFromQuery(query({ by: '7', type: 'release', range: 'custom', from: '2026-09-01', to: '2026-09-30', q: 'price' }));
    expect(filter).toEqual({ by: 7, kind: 'release', date: { range: 'custom', from: '2026-09-01', to: '2026-09-30' }, q: 'price' });
    expect(isFiltered(filter)).toBe(true);
    expect(filterToQuery(filter)).toEqual({ by: '7', type: 'release', range: 'custom', from: '2026-09-01', to: '2026-09-30', q: 'price' });
    expect(filterToQuery(NO_HISTORY_FILTER)).toEqual({ by: null, type: null, range: null, from: null, to: null, q: null });
  });

  it('drops what is invalid: an author that is no id, an unknown type or range, a custom range without a day', () => {
    expect(filterFromQuery(query({ by: 'anna', type: 'bogus', range: 'never' }))).toEqual(NO_HISTORY_FILTER);
    expect(filterFromQuery(query({ range: 'custom' })).date.range).toBe('any');
    expect(filterFromQuery(query({ range: 'week', from: '2026-09-01' })).date).toEqual({ range: 'week', from: null, to: null });
  });

  it('asks the API for the change types of a kind, the author, the search and the date bounds', () => {
    const api = filterToApi({ by: 3, kind: 'edit', date: { range: 'week', from: null, to: null }, q: ' title ' }, NOW);
    expect(api).toEqual({
      from: new Date(NOW - 7 * DAY).toISOString(),
      userId: 3,
      changeType: ['UPDATE', 'MOVE', 'RENAME', 'UID_CHANGE', 'BULK', 'DISCARD'],
      q: 'title',
    });
    expect(filterToApi(NO_HISTORY_FILTER, NOW)).toEqual({});
  });
});
