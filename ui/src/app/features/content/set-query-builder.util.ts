import type { SelectOption } from '../forms/form.model';
import type { RecordColumn } from './record-grid.util';

/**
 * The filter builder's model (M35.20, gate decision 13): a record set's `where` as condition rows — field, operator,
 * value — joined by "and". The stored query stays the server's text: {@link whereOf} writes it (`role == 'lead' && stock > 0`)
 * and {@link parseWhere} reads back every expression the builder itself could have written. Anything else
 * (`||`, groups, functions, `>=`, a field the schema no longer has) reads as `null`: the builder then steps aside and the
 * expression stays as it is.
 */

/** How a field is compared: text, one of its options, a number, a yes/no, or a date. */
export type ConditionKind = 'text' | 'select' | 'number' | 'boolean' | 'date';

export type ConditionOp = 'is' | 'isNot' | 'contains' | 'gt' | 'lt';

/** A field a condition can test. */
export interface QueryField {
  id: string;
  label: string;
  kind: ConditionKind;
  options: readonly SelectOption[];
  /** A date field's picker: the day, or day and time. */
  dateMode: 'date' | 'datetime';
}

/** One row of the builder. `value` is the text of the control: a number's digits, `true`/`false`, an option's value. */
export interface Condition {
  id: string;
  field: string;
  op: ConditionOp;
  value: string;
}

export const OPERATORS: Readonly<Record<ConditionKind, readonly ConditionOp[]>> = {
  text: ['is', 'isNot', 'contains'],
  select: ['is', 'isNot'],
  number: ['is', 'isNot', 'gt', 'lt'],
  boolean: ['is'],
  date: ['is', 'isNot', 'gt', 'lt'],
};

/** The operator as the server's expression language writes it. */
const SYMBOLS: Readonly<Record<ConditionOp, string>> = { is: '==', isNot: '!=', contains: 'contains', gt: '>', lt: '<' };

/** The record's own name, a field every dataset has. */
export const NAME_FIELD = '_displayName';

function kindOf(column: Pick<RecordColumn, 'type' | 'options'>): ConditionKind {
  switch (column.type) {
    case 'SELECT':
      return column.options?.length ? 'select' : 'text';
    case 'NUMBER':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    case 'DATE':
    case 'DATETIME':
      return 'date';
    default:
      return 'text';
  }
}

/** The fields a condition can use: the record's name and the dataset's scalar columns. */
export function queryFieldsOf(columns: readonly RecordColumn[], nameLabel: string): QueryField[] {
  return [
    { id: NAME_FIELD, label: nameLabel, kind: 'text', options: [], dateMode: 'date' },
    ...columns.map((column) => ({
      id: column.field,
      label: column.label,
      kind: kindOf(column),
      options: column.options ?? [],
      dateMode: column.type === 'DATETIME' ? ('datetime' as const) : ('date' as const),
    })),
  ];
}

export function fieldOf(fields: readonly QueryField[], id: string): QueryField | null {
  return fields.find((field) => field.id === id) ?? null;
}

let nextConditionId = 0;

/** A condition on `fieldId` (the first field without one), with that field's first operator and a usable empty value. */
export function newCondition(fields: readonly QueryField[], fieldId?: string): Condition {
  const field = (fieldId ? fieldOf(fields, fieldId) : null) ?? fields[0];
  const value = field.kind === 'select' ? (field.options[0]?.value ?? '') : field.kind === 'boolean' ? 'true' : '';
  return { id: `condition-${++nextConditionId}`, field: field.id, op: OPERATORS[field.kind][0], value };
}

/** Whether a condition has what it needs to filter: a blank value (or a half-typed number) is left out of the expression. */
export function isComplete(condition: Condition, fields: readonly QueryField[]): boolean {
  const field = fieldOf(fields, condition.field);
  if (!field) {
    return false;
  }
  const value = condition.value.trim();
  if (value === '') {
    return false;
  }
  return field.kind !== 'number' || Number.isFinite(Number(value));
}

function literal(condition: Condition, kind: ConditionKind): string {
  const value = condition.value.trim();
  if (kind === 'number') {
    return String(Number(value));
  }
  if (kind === 'boolean') {
    return value === 'true' ? 'true' : 'false';
  }
  return `'${condition.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The `where` expression of the complete conditions (`roast == 'light' && stock > 0`); empty without any. */
export function whereOf(conditions: readonly Condition[], fields: readonly QueryField[]): string {
  return conditions
    .filter((condition) => isComplete(condition, fields))
    .map((condition) => {
      const field = fieldOf(fields, condition.field)!;
      return `${condition.field} ${SYMBOLS[condition.op]} ${literal(condition, field.kind)}`;
    })
    .join(' && ');
}

// ── Reading an expression back ───────────────────────────────────────────────

type Token = { kind: 'word' | 'number' | 'string' | 'op'; text: string };

/** Splits `where` into tokens; `null` for anything the builder's expressions never contain. */
function tokenize(where: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < where.length) {
    const c = where[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      const end = /[A-Za-z0-9_]*/.exec(where.slice(i))![0].length;
      tokens.push({ kind: 'word', text: where.slice(i, i + end) });
      i += end;
    } else if (/[0-9-]/.test(c)) {
      const match = /^-?\d+(\.\d+)?/.exec(where.slice(i));
      if (!match) {
        return null;
      }
      tokens.push({ kind: 'number', text: match[0] });
      i += match[0].length;
    } else if (c === "'" || c === '"') {
      let text = '';
      let j = i + 1;
      for (; j < where.length && where[j] !== c; j++) {
        if (where[j] === '\\') {
          const escaped = where[++j];
          if (escaped !== '\\' && escaped !== "'" && escaped !== '"') {
            return null;
          }
          text += escaped;
        } else {
          text += where[j];
        }
      }
      if (j >= where.length) {
        return null;
      }
      tokens.push({ kind: 'string', text });
      i = j + 1;
    } else {
      const op = where.slice(i, i + 2);
      if (op === '&&' || op === '==' || op === '!=') {
        tokens.push({ kind: 'op', text: op });
        i += 2;
      } else if ((c === '>' || c === '<') && where[i + 1] !== '=') {
        tokens.push({ kind: 'op', text: c });
        i++;
      } else {
        return null;
      }
    }
  }
  return tokens;
}

const OPS_BY_SYMBOL: Readonly<Record<string, ConditionOp>> = { '==': 'is', '!=': 'isNot', contains: 'contains', '>': 'gt', '<': 'lt' };

/** One `field op literal` triple as a condition, or `null` when the schema or the operator doesn't allow it. */
function conditionOf(triple: readonly Token[], fields: readonly QueryField[]): Condition | null {
  const [name, symbol, operand] = triple;
  const field = name.kind === 'word' ? fieldOf(fields, name.text) : null;
  const op = symbol.kind === 'op' || (symbol.kind === 'word' && symbol.text === 'contains') ? OPS_BY_SYMBOL[symbol.text] : undefined;
  if (!field || !op || !OPERATORS[field.kind].includes(op)) {
    return null;
  }
  let value: string;
  if (field.kind === 'number') {
    if (operand.kind !== 'number') {
      return null;
    }
    value = operand.text;
  } else if (field.kind === 'boolean') {
    if (operand.kind !== 'word' || (operand.text !== 'true' && operand.text !== 'false')) {
      return null;
    }
    value = operand.text;
  } else {
    if (operand.kind !== 'string' || (field.kind === 'select' && !field.options.some((o) => o.value === operand.text))) {
      return null;
    }
    value = operand.text;
  }
  return { id: `condition-${++nextConditionId}`, field: field.id, op, value };
}

/**
 * The builder rows for a stored `where`: none for an empty one, `null` when it is more than a list of simple conditions
 * joined by `&&` over fields the dataset has (then the expression, not the builder, is what the editor shows).
 */
export function parseWhere(where: string, fields: readonly QueryField[]): Condition[] | null {
  const tokens = tokenize(where);
  if (!tokens) {
    return null;
  }
  const conditions: Condition[] = [];
  let i = 0;
  while (i < tokens.length) {
    const triple = tokens.slice(i, i + 3);
    const condition = triple.length === 3 ? conditionOf(triple, fields) : null;
    if (!condition) {
      return null;
    }
    conditions.push(condition);
    i += 3;
    if (i < tokens.length) {
      const joiner = tokens[i++];
      if (joiner.kind !== 'op' || joiner.text !== '&&' || i >= tokens.length) {
        return null; // anything but `&&`, or a dangling one
      }
    }
  }
  return conditions;
}
