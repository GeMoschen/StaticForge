import { describe, expect, it } from 'vitest';
import type { ContentDefinition } from '../forms/form.model';
import { deriveColumns } from './record-grid.util';
import {
  OPERATORS,
  isComplete,
  newCondition,
  parseWhere,
  queryFieldsOf,
  whereOf,
  type Condition,
} from './set-query-builder.util';

const DEFINITION: ContentDefinition = {
  bodies: [],
  editors: [
    { name: 'role', type: 'TEXT', label: 'Role' },
    { name: 'level', type: 'SELECT', label: 'Level', options: [{ value: 'lead', label: 'Team lead' }, { value: 'staff', label: 'Staff' }] },
    { name: 'age', type: 'NUMBER', label: 'Age' },
    { name: 'active', type: 'BOOLEAN', label: 'Active' },
    { name: 'joined', type: 'DATE', label: 'Joined' },
  ],
};
const FIELDS = queryFieldsOf(deriveColumns(DEFINITION), 'Name');

/** Conditions without their ids, which are generated. */
const bare = (conditions: Condition[] | null) => conditions?.map(({ field, op, value }) => ({ field, op, value })) ?? null;

describe('set query builder', () => {
  it('offers the record name and the scalar fields, with the comparison each kind allows', () => {
    expect(FIELDS.map((f) => [f.id, f.kind])).toEqual([
      ['_displayName', 'text'],
      ['role', 'text'],
      ['level', 'select'],
      ['age', 'number'],
      ['active', 'boolean'],
      ['joined', 'date'],
    ]);
    expect(OPERATORS.boolean).toEqual(['is']);
  });

  it('starts a new condition on a usable default of the field', () => {
    expect(bare([newCondition(FIELDS, 'level')])).toEqual([{ field: 'level', op: 'is', value: 'lead' }]);
    expect(bare([newCondition(FIELDS, 'active')])).toEqual([{ field: 'active', op: 'is', value: 'true' }]);
    expect(bare([newCondition(FIELDS)])).toEqual([{ field: '_displayName', op: 'is', value: '' }]);
  });

  describe('writing the expression', () => {
    it('joins the conditions with && and quotes text the way the server reads it', () => {
      const conditions: Condition[] = [
        { id: 'a', field: 'role', op: 'is', value: "O'Neil \\ co" },
        { id: 'b', field: 'age', op: 'gt', value: '30' },
        { id: 'c', field: 'active', op: 'is', value: 'false' },
        { id: 'd', field: 'level', op: 'isNot', value: 'staff' },
        { id: 'e', field: 'role', op: 'contains', value: 'dev' },
      ];

      expect(whereOf(conditions, FIELDS)).toBe(
        "role == 'O\\'Neil \\\\ co' && age > 30 && active == false && level != 'staff' && role contains 'dev'",
      );
    });

    it('leaves out rows without a value or with a half-typed number', () => {
      const conditions: Condition[] = [
        { id: 'a', field: 'role', op: 'is', value: '' },
        { id: 'b', field: 'age', op: 'lt', value: '-' },
        { id: 'c', field: 'role', op: 'is', value: 'lead' },
      ];

      expect(isComplete(conditions[0], FIELDS)).toBe(false);
      expect(isComplete(conditions[1], FIELDS)).toBe(false);
      expect(whereOf(conditions, FIELDS)).toBe("role == 'lead'");
      expect(whereOf([], FIELDS)).toBe('');
    });
  });

  describe('reading an expression back', () => {
    it('reads what the builder writes, so a stored query round-trips unchanged', () => {
      const where = "role == 'O\\'Neil \\\\ co' && age > 30 && active == false && level != 'staff' && role contains 'dev' && joined < '2022-01-01'";
      const parsed = parseWhere(where, FIELDS);

      expect(parsed).not.toBeNull();
      expect(whereOf(parsed!, FIELDS)).toBe(where);
      expect(bare(parsed)?.[0]).toEqual({ field: 'role', op: 'is', value: "O'Neil \\ co" });
    });

    it('reads an empty expression as no conditions', () => {
      expect(parseWhere('', FIELDS)).toEqual([]);
      expect(parseWhere('   ', FIELDS)).toEqual([]);
    });

    it('accepts double quotes, loose spacing and numbers with decimals', () => {
      expect(bare(parseWhere('role=="lead"&&age>2', FIELDS))).toEqual([
        { field: 'role', op: 'is', value: 'lead' },
        { field: 'age', op: 'gt', value: '2' },
      ]);
      expect(bare(parseWhere('age < 2.5', FIELDS))).toEqual([{ field: 'age', op: 'lt', value: '2.5' }]);
    });

    it.each([
      ["role == 'a' || role == 'b'", 'an or'],
      ["(role == 'a')", 'a group'],
      ["!(role == 'a')", 'a negation'],
      ['age >= 3', 'an operator the builder does not have'],
      ["role startsWith 'a'", 'an operator the builder does not have'],
      ["nickname == 'a'", 'a field the dataset does not have'],
      ["level == 'gone'", 'a value that is no longer an option'],
      ['age == 3 &&', 'a dangling &&'],
      ["role == 'a' role == 'b'", 'a missing &&'],
      ["role == 'a", 'an unterminated string'],
      ['age == abc', 'a number field compared with a word'],
      ["age == '3'", 'a number field compared with a string'],
      ['role == 3', 'a text field compared with a number'],
      ["active == 'true'", 'a boolean field compared with a string'],
      ["age contains 3", 'contains on a number'],
      ["role == 'a\\n'", 'an escape the builder never writes'],
    ])('does not read %s (%s): the builder steps aside and the expression stays', (where) => {
      expect(parseWhere(where, FIELDS)).toBeNull();
    });
  });
});
