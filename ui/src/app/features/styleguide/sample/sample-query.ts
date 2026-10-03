/**
 * The record set query of the sample (M35.9, decision 13; M35.20, gate round 11): which records a set selects (conditions
 * joined by "and", or a stored expression the builder cannot show), in which order (one or more sort keys) and which
 * window of them (offset, limit), evaluated in memory, plus the expression developer mode shows. Pure functions; the UI
 * texts are the caller's.
 */
import { SampleCondition, SampleDataset, SampleDatasetField, SampleOperator, SampleQuery, SampleRecord } from './sample-content-data';

/** How a field is compared: text, one of its options, a number, a yes/no or a date. */
export type SampleQueryKind = 'text' | 'select' | 'number' | 'boolean' | 'date';

export const OPERATORS: Readonly<Record<SampleQueryKind, readonly SampleOperator[]>> = {
  text: ['is', 'isNot', 'contains'],
  select: ['is', 'isNot'],
  number: ['is', 'isNot', 'gt', 'lt'],
  boolean: ['is'],
  date: ['is', 'isNot', 'gt', 'lt'],
};

const SYMBOLS: Readonly<Record<SampleOperator, string>> = { is: '==', isNot: '!=', contains: 'contains', gt: '>', lt: '<' };

export function queryKind(field: SampleDatasetField): SampleQueryKind {
  switch (field.type) {
    case 'select':
      return 'select';
    case 'number':
    case 'money':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    default:
      return 'text';
  }
}

/** The key of an operator's words: a date is "after" or "before", not "greater" or "less". */
export function operatorKey(kind: SampleQueryKind, op: SampleOperator): string {
  if (kind === 'date' && op === 'gt') {
    return 'after';
  }
  return kind === 'date' && op === 'lt' ? 'before' : op;
}

/** The fields a condition or the sort can use: the dataset's table columns. */
export function queryFields(dataset: SampleDataset): SampleDatasetField[] {
  return dataset.fields.filter((field) => field.inTable);
}

export function fieldOf(dataset: SampleDataset, id: string): SampleDatasetField | null {
  return dataset.fields.find((field) => field.id === id) ?? null;
}

let nextCondition = 100;

/** A new condition on the dataset's first field (or `field`), with that field's first operator and a usable empty value. */
export function newCondition(dataset: SampleDataset, fieldId?: string): SampleCondition {
  const field = (fieldId ? fieldOf(dataset, fieldId) : null) ?? queryFields(dataset)[0];
  const kind = queryKind(field);
  const value = kind === 'select' ? (field.options?.[0]?.value ?? null) : kind === 'boolean' ? 'true' : null;
  return { id: `c-${++nextCondition}`, field: field.id, op: OPERATORS[kind][0], value };
}

/** Whether a condition has what it needs to filter (an empty value is ignored). */
export function isComplete(condition: SampleCondition): boolean {
  return condition.value !== null && condition.value !== '';
}

function ordered(order: number, op: SampleOperator): boolean {
  switch (op) {
    case 'gt':
      return order > 0;
    case 'lt':
      return order < 0;
    case 'isNot':
      return order !== 0;
    default:
      return order === 0;
  }
}

function test(record: SampleRecord, condition: SampleCondition, field: SampleDatasetField): boolean {
  const actual = record.values[condition.field];
  const kind = queryKind(field);
  if (kind === 'number') {
    const a = typeof actual === 'number' ? actual : Number.NaN;
    const b = Number(condition.value);
    return Number.isNaN(a) ? condition.op === 'isNot' : ordered(a - b, condition.op);
  }
  if (kind === 'date') {
    const a = typeof actual === 'string' ? actual : '';
    return a !== '' && ordered(a.localeCompare(String(condition.value)), condition.op);
  }
  const a = typeof actual === 'string' ? actual.toLowerCase() : '';
  const b = String(condition.value).toLowerCase();
  return condition.op === 'contains' ? a.includes(b) : ordered(a === b ? 0 : 1, condition.op);
}

const OPERATOR_OF_SYMBOL: Readonly<Record<string, SampleOperator>> = { '==': 'is', '!=': 'isNot', contains: 'contains', '>': 'gt', '<': 'lt' };
const CLAUSE = /^(\w+)\s*(==|!=|>|<|contains)\s*('(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)$/;

/** Whether a record satisfies a stored expression of `&&` clauses joined by `||` (`roast == 'dark' || stock > 50`). */
export function matchesExpression(record: SampleRecord, expression: string, dataset: SampleDataset): boolean {
  return expression.split('||').some((alternative) =>
    alternative.split('&&').every((clause) => {
      const match = CLAUSE.exec(clause.trim());
      const field = match ? fieldOf(dataset, match[1]) : null;
      if (!match || !field) {
        return false;
      }
      const raw = match[3];
      const value = raw.startsWith("'") ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
      return test(record, { id: '', field: field.id, op: OPERATOR_OF_SYMBOL[match[2]], value }, field);
    }),
  );
}

function compare(x: SampleRecord, y: SampleRecord, field: string): number {
  const a = x.values[field];
  const b = y.values[field];
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
}

/** The records the query's filter selects, in its order — before the offset and limit cut the list. */
export function matchQuery(records: readonly SampleRecord[], query: SampleQuery, dataset: SampleDataset): SampleRecord[] {
  const active = query.conditions.filter(isComplete);
  const selected = records.filter((record) =>
    query.custom
      ? matchesExpression(record, query.custom, dataset)
      : active.every((condition) => {
          const field = fieldOf(dataset, condition.field);
          return !field || test(record, condition, field);
        }),
  );
  const keys = query.sort.length > 0 ? query.sort : [{ field: dataset.displayField, direction: 'asc' as const }];
  return selected.sort((x, y) => {
    for (const key of keys) {
      const order = compare(x, y, key.field) * (key.direction === 'desc' ? -1 : 1);
      if (order !== 0) {
        return order;
      }
    }
    return 0;
  });
}

/** The records the set shows: the selection, minus the first `offset`, at most `limit`. */
export function runQuery(records: readonly SampleRecord[], query: SampleQuery, dataset: SampleDataset): SampleRecord[] {
  const start = Math.max(0, query.offset ?? 0);
  const matched = matchQuery(records, query, dataset);
  return query.limit === null ? matched.slice(start) : matched.slice(start, start + Math.max(0, query.limit));
}

function literal(value: string | number | null, kind: SampleQueryKind): string {
  if (kind === 'number') {
    return String(Number(value));
  }
  if (kind === 'boolean') {
    return value === 'true' ? 'true' : 'false';
  }
  return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The `where` expression: the stored one, or the complete conditions (`roast == 'light' && stock > 0`); empty without any. */
export function expressionOf(query: SampleQuery, dataset: SampleDataset): string {
  if (query.custom) {
    return query.custom;
  }
  return query.conditions
    .filter(isComplete)
    .map((condition) => {
      const field = fieldOf(dataset, condition.field);
      const kind = field ? queryKind(field) : 'text';
      return `${condition.field} ${SYMBOLS[condition.op]} ${literal(condition.value, kind)}`;
    })
    .join(' && ');
}

/** A condition's value as a reader sees it: an option's label, or the value (a Yes/No is the caller's to word). */
export function valueLabel(condition: SampleCondition, dataset: SampleDataset): string {
  const field = fieldOf(dataset, condition.field);
  const option = field?.options?.find((o) => o.value === condition.value);
  return option ? option.label : String(condition.value ?? '');
}

/** Whether every clause of an expression is one the sample understands (a field of the dataset, an operator, a literal). */
export function isValidExpression(expression: string, dataset: SampleDataset): boolean {
  return expression
    .split(/&&|\|\|/)
    .every((clause) => {
      const match = CLAUSE.exec(clause.trim());
      return !!match && !!fieldOf(dataset, match[1]);
    });
}

/**
 * The builder's rows for an expression it could have written (clauses joined by `&&`); `null` for anything else
 * (`||`, an unknown field) — then the expression is kept as it is.
 */
export function conditionsOfExpression(expression: string, dataset: SampleDataset): SampleCondition[] | null {
  const where = expression.trim();
  if (where === '') {
    return [];
  }
  if (where.includes('||') || !isValidExpression(where, dataset)) {
    return null;
  }
  return where.split('&&').map((clause) => {
    const match = CLAUSE.exec(clause.trim())!;
    const field = fieldOf(dataset, match[1])!;
    const raw = match[3];
    const text = raw.startsWith("'") ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw;
    const value = queryKind(field) === 'number' ? Number(text) : text;
    return { id: `c-${++nextCondition}`, field: field.id, op: OPERATOR_OF_SYMBOL[match[2]], value };
  });
}
