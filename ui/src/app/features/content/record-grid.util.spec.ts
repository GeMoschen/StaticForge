import { describe, expect, it } from 'vitest';
import type { ContentDefinition } from '../forms/form.model';
import { deriveColumns, formatCell, sanitizeSort, toRecordSort } from './record-grid.util';

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

describe('toRecordSort', () => {
  it('maps the table sort onto the wire sort, keeping the order of the keys', () => {
    expect(
      toRecordSort([
        { id: 'role', direction: 'desc' },
        { id: '_displayName', direction: 'asc' },
      ]),
    ).toEqual([
      { field: 'role', direction: 'desc' },
      { field: '_displayName', direction: 'asc' },
    ]);
    expect(toRecordSort([])).toEqual([]);
  });
});

describe('formatCell', () => {
  const labels = { yes: 'Yes', no: 'No' };

  it('formats booleans, date-times and blanks', () => {
    expect(formatCell(true, { type: 'BOOLEAN' }, labels)).toBe('Yes');
    expect(formatCell(false, { type: 'BOOLEAN' }, labels)).toBe('No');
    expect(formatCell('2026-05-01T10:30:00Z', { type: 'DATETIME' }, labels)).toBe('2026-05-01 10:30:00 UTC');
    expect(formatCell(null, { type: 'TEXT' }, labels)).toBe('');
    expect(formatCell(3, { type: 'NUMBER' }, labels)).toBe('3');
  });

  it("shows a select's option label, and the stored value when the option is gone", () => {
    const column = { type: 'SELECT' as const, options: [{ value: 'lead', label: 'Team lead' }] };

    expect(formatCell('lead', column, labels)).toBe('Team lead');
    expect(formatCell('old', column, labels)).toBe('old');
  });
});

describe('select columns', () => {
  it('carry their options for the filter builder', () => {
    const definition: ContentDefinition = {
      bodies: [],
      editors: [{ name: 'role', type: 'SELECT', options: [{ value: 'lead', label: 'Lead' }] }],
    };

    expect(deriveColumns(definition)[0].options).toEqual([{ value: 'lead', label: 'Lead' }]);
  });
});
