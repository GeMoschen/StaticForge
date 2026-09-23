import { afterEach, describe, expect, it } from 'vitest';
import type { ContentDefinition } from '../forms/form.model';
import {
  ariaSort,
  deriveColumns,
  formatCell,
  readHiddenColumns,
  sanitizeSort,
  sortIndicator,
  toggleSort,
  writeHiddenColumns,
} from './record-grid.util';

const TEAM: ContentDefinition = {
  bodies: [],
  editors: [
    { name: 'name', type: 'TEXT', label: 'Name' },
    { name: 'bio', type: 'RICHTEXT', label: 'Bio' },
    {
      name: '_group_1',
      type: 'GROUP',
      items: [
        { name: 'joined', type: 'DATE', label: 'Joined' },
        { name: 'photo', type: 'MEDIA', label: 'Photo' },
      ],
    },
    { name: 'notes', type: 'TEXTAREA' },
    { name: 'tags', type: 'LIST', items: [{ name: 'tag', type: 'TEXT' }] },
    { name: 'active', type: 'BOOLEAN', label: 'Active' },
    { name: 'secret', type: 'TEXT', hidden: true },
  ],
};

describe('deriveColumns', () => {
  it('keeps scalar editors, flattens groups and skips complex or hidden editors', () => {
    expect(deriveColumns(TEAM)).toEqual([
      { field: 'name', label: 'Name', type: 'TEXT', defaultVisible: true },
      { field: 'joined', label: 'Joined', type: 'DATE', defaultVisible: true },
      { field: 'notes', label: 'notes', type: 'TEXTAREA', defaultVisible: false },
      { field: 'active', label: 'Active', type: 'BOOLEAN', defaultVisible: true },
    ]);
  });

  it("starts the title field hidden: the Name column already shows its value", () => {
    const columns = deriveColumns(TEAM, 'name');

    expect(columns.find((c) => c.field === 'name')).toEqual({ field: 'name', label: 'Name', type: 'TEXT', defaultVisible: false });
    expect(columns.filter((c) => c.defaultVisible).map((c) => c.field)).toEqual(['joined', 'active']);
  });

  it('tolerates a missing definition', () => {
    expect(deriveColumns(null)).toEqual([]);
  });
});

describe('toggleSort', () => {
  it('cycles a single column ascending, descending, unsorted', () => {
    const asc = toggleSort([], 'name', false);
    expect(asc).toEqual([{ field: 'name', direction: 'asc' }]);
    const desc = toggleSort(asc, 'name', false);
    expect(desc).toEqual([{ field: 'name', direction: 'desc' }]);
    expect(toggleSort(desc, 'name', false)).toEqual([]);
  });

  it('replaces a multi-key sort on a plain activation', () => {
    const multi = [
      { field: 'role', direction: 'desc' as const },
      { field: 'name', direction: 'asc' as const },
    ];
    expect(toggleSort(multi, 'joined', false)).toEqual([{ field: 'joined', direction: 'asc' }]);
  });

  it('adds, cycles and removes keys with shift', () => {
    let sort = toggleSort([], 'role', true);
    sort = toggleSort(sort, 'name', true);
    expect(sort).toEqual([
      { field: 'role', direction: 'asc' },
      { field: 'name', direction: 'asc' },
    ]);
    sort = toggleSort(sort, 'role', true);
    expect(sort).toEqual([
      { field: 'role', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
    sort = toggleSort(sort, 'role', true);
    expect(sort).toEqual([{ field: 'name', direction: 'asc' }]);
  });
});

describe('sanitizeSort', () => {
  it('drops fields the schema no longer has but keeps meta fields', () => {
    const columns = deriveColumns(TEAM);
    expect(
      sanitizeSort(
        [
          { field: 'role', direction: 'asc' },
          { field: '_displayName', direction: 'desc' },
          { field: 'name', direction: 'asc' },
        ],
        columns,
      ),
    ).toEqual([
      { field: '_displayName', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
  });
});

describe('sort indicators', () => {
  const sort = [
    { field: 'role', direction: 'desc' as const },
    { field: 'name', direction: 'asc' as const },
  ];

  it('reports position and direction per column', () => {
    expect(sortIndicator(sort, 'name')).toEqual({ position: 2, direction: 'asc' });
    expect(sortIndicator(sort, 'joined')).toBeNull();
  });

  it('reports only the primary key through aria-sort', () => {
    expect(ariaSort(sort, 'role')).toBe('descending');
    expect(ariaSort(sort, 'name')).toBe('none');
  });
});

describe('formatCell', () => {
  it('formats booleans, date-times and blanks', () => {
    expect(formatCell(true, 'BOOLEAN')).toBe('Yes');
    expect(formatCell(false, 'BOOLEAN')).toBe('No');
    expect(formatCell('2026-05-01T10:30:00Z', 'DATETIME')).toBe('2026-05-01 10:30:00 UTC');
    expect(formatCell(null, 'TEXT')).toBe('');
    expect(formatCell(3, 'NUMBER')).toBe('3');
  });
});

describe('hidden column persistence', () => {
  afterEach(() => localStorage.clear());

  it('round-trips per project and dataset', () => {
    writeHiddenColumns('p1', 'd1', new Set(['notes']));
    expect(readHiddenColumns('p1', 'd1')).toEqual(new Set(['notes']));
    expect(readHiddenColumns('p1', 'd2')).toBeNull();
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('sf-record-grid-hidden:p1:d1', '{not json');
    expect(readHiddenColumns('p1', 'd1')).toBeNull();
  });
});
