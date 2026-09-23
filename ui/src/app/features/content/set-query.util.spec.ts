import { describe, expect, it } from 'vitest';
import {
  adoptGridFilter,
  draftOf,
  EMPTY_DRAFT,
  localDiagnostics,
  matchSummary,
  moveSortKey,
  parseSortSpec,
  queryOf,
  sameQuery,
  sortSpec,
} from './set-query.util';

describe('set query drafts', () => {
  it('parses the stored sort spec like the server, duplicates keeping the first', () => {
    expect(parseSortSpec('role, -joined,role')).toEqual([
      { field: 'role', direction: 'asc' },
      { field: 'joined', direction: 'desc' },
    ]);
    expect(parseSortSpec(undefined)).toEqual([]);
  });

  it('writes sort keys back in the stored syntax', () => {
    expect(sortSpec([{ field: 'role', direction: 'asc' }, { field: 'joined', direction: 'desc' }])).toBe('role,-joined');
    expect(sortSpec([])).toBeUndefined();
  });

  it('round-trips a stored query and leaves blank parts out', () => {
    const stored = { where: "role == 'lead'", sort: '-joined', limit: 3, offset: 1 };

    expect(queryOf(draftOf(stored))).toEqual(stored);
    expect(queryOf({ where: '  ', sort: [], limit: '', offset: '' })).toEqual({});
  });

  it('treats whitespace-only differences as the same query', () => {
    const draft = draftOf({ where: "role == 'lead'" });

    expect(sameQuery(draft, { ...draft, where: "  role == 'lead' " })).toBe(true);
    expect(sameQuery(draft, { ...draft, limit: '5' })).toBe(false);
    expect(sameQuery(EMPTY_DRAFT, draftOf(undefined))).toBe(true);
  });

  it('rejects limit/offset that are not whole numbers, 0 or more, before any request', () => {
    expect(localDiagnostics({ ...EMPTY_DRAFT, limit: '-1', offset: '1.5' }).map((d) => d.field)).toEqual(['limit', 'offset']);
    expect(localDiagnostics({ ...EMPTY_DRAFT, limit: '0', offset: '10' })).toEqual([]);
  });

  it("adopts the grid's filter and sort, keeping limit and offset", () => {
    const draft = { where: 'a == 1', sort: [], limit: '3', offset: '1' };

    expect(adoptGridFilter(draft, " role == 'lead' ", [{ field: 'name', direction: 'desc' }])).toEqual({
      where: "role == 'lead'",
      sort: [{ field: 'name', direction: 'desc' }],
      limit: '3',
      offset: '1',
    });
  });

  it('reorders sort keys and ignores moves past either end', () => {
    const keys = parseSortSpec('a,b,c');

    expect(moveSortKey(keys, 2, -1).map((k) => k.field)).toEqual(['a', 'c', 'b']);
    expect(moveSortKey(keys, 0, -1).map((k) => k.field)).toEqual(['a', 'b', 'c']);
  });

  it('says how many records match and how many the set shows', () => {
    expect(matchSummary(3, 12, 3)).toBe('3 of 12 records match');
    expect(matchSummary(8, 12, 5)).toBe('8 of 12 records match · the set shows 5');
    expect(matchSummary(1, 1, 1)).toBe('1 of 1 record matches');
  });
});
