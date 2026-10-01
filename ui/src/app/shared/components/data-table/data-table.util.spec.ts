import { convertToParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import type { SfDataTableColumn, SfDataTableQuery } from './data-table.types';
import {
  decodeSort,
  encodeSort,
  moveInOrder,
  nextSort,
  paramsToQuery,
  queryToParams,
  resolveColumns,
  sortRows,
} from './data-table.util';

interface Row {
  name: string;
  size: number | null;
}

const COLUMNS: SfDataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', value: (r) => r.name },
  { id: 'size', header: 'Size', value: (r) => r.size, hideable: false },
  { id: 'extra', header: 'Extra', hidden: true },
];

describe('data-table util', () => {
  it('sorts numbers by size and text naturally, with empty values last in both directions', () => {
    const rows: Row[] = [
      { name: 'item 10', size: 2 },
      { name: 'item 9', size: null },
      { name: 'Item 1', size: 10 },
    ];
    expect(sortRows(rows, [{ id: 'name', direction: 'asc' }], COLUMNS).map((r) => r.name)).toEqual([
      'Item 1',
      'item 9',
      'item 10',
    ]);
    expect(sortRows(rows, [{ id: 'size', direction: 'desc' }], COLUMNS).map((r) => r.size)).toEqual([10, 2, null]);
    expect(sortRows(rows, [{ id: 'size', direction: 'asc' }], COLUMNS).map((r) => r.size)).toEqual([2, 10, null]);
  });

  it('cycles the sort alone and with multi', () => {
    expect(nextSort([], 'a', false)).toEqual([{ id: 'a', direction: 'asc' }]);
    expect(nextSort([{ id: 'a', direction: 'asc' }], 'a', false)).toEqual([{ id: 'a', direction: 'desc' }]);
    expect(nextSort([{ id: 'a', direction: 'desc' }], 'a', false)).toEqual([]);
    expect(nextSort([{ id: 'a', direction: 'asc' }], 'b', false)).toEqual([{ id: 'b', direction: 'asc' }]);
    const multi = nextSort([{ id: 'a', direction: 'asc' }], 'b', true);
    expect(multi).toEqual([
      { id: 'a', direction: 'asc' },
      { id: 'b', direction: 'asc' },
    ]);
    expect(nextSort(multi, 'a', false)).toEqual([{ id: 'a', direction: 'asc' }]);
    expect(nextSort(nextSort(multi, 'b', true), 'b', true)).toEqual([{ id: 'a', direction: 'asc' }]);
  });

  it('round-trips a query through URL params, omitting defaults', () => {
    const query: SfDataTableQuery = {
      search: 'news',
      filters: { status: ['draft', 'review'] },
      sort: [
        { id: 'name', direction: 'asc' },
        { id: 'changed', direction: 'desc' },
      ],
      page: 2,
    };
    const params = queryToParams(query, 'p', ['status', 'type'], [], true);
    expect(params).toEqual({
      'p.q': 'news',
      'p.sort': 'name,-changed',
      'p.page': '3',
      'p.status': ['draft', 'review'],
      'p.type': null,
    });
    expect(paramsToQuery(convertToParamMap(params), 'p', ['status', 'type'], [], true)).toEqual(query);

    // At the defaults every param is removed.
    const initial = [{ id: 'name', direction: 'asc' as const }];
    expect(queryToParams({ search: '', filters: {}, sort: initial, page: 0 }, '', [], initial, true)).toEqual({
      q: null,
      sort: null,
      page: null,
    });
    // No sort param means the initial sort; an empty one means "unsorted".
    expect(paramsToQuery(convertToParamMap({}), '', [], initial, true).sort).toEqual(initial);
    expect(paramsToQuery(convertToParamMap({ sort: '' }), '', [], initial, true).sort).toEqual([]);
    expect(paramsToQuery(convertToParamMap({ page: 'x' }), '', [], [], true).page).toBe(0);
    expect(encodeSort(decodeSort('a,-b,,-'))).toBe('a,-b');
  });

  it('resolves a stored layout against the column definitions', () => {
    expect(resolveColumns(COLUMNS, {})).toMatchObject({ hidden: new Set(['extra']), widths: {} });

    const resolved = resolveColumns(COLUMNS, { order: ['gone', 'size', 'size'], hidden: ['size', 'name'], widths: { name: 90 } });
    expect(resolved.ordered.map((c) => c.id)).toEqual(['size', 'name', 'extra']);
    // A column that is not hideable stays visible whatever is stored.
    expect([...resolved.hidden]).toEqual(['name']);
    expect(resolved.widths).toEqual({ name: 90 });
  });

  it('moves an id within an order, clamped', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
});
