/**
 * The record set query of the sample (M35.9, decision 13): which records a set selects (conditions joined by "and") and
 * in which order, evaluated in memory, plus the expression developer mode shows. Pure functions; the UI texts are the
 * caller's.
 */
import { SampleCondition, SampleDataset, SampleDatasetField, SampleOperator, SampleQuery, SampleRecord } from './sample-content-data';

/** How a field is compared: text, one of its options, or a number. */
export type SampleQueryKind = 'text' | 'select' | 'number';

export const OPERATORS: Readonly<Record<SampleQueryKind, readonly SampleOperator[]>> = {
  text: ['is', 'isNot', 'contains'],
  select: ['is', 'isNot'],
  number: ['is', 'isNot', 'gt', 'lt'],
};

const SYMBOLS: Readonly<Record<SampleOperator, string>> = { is: '==', isNot: '!=', contains: 'contains', gt: '>', lt: '<' };

export function queryKind(field: SampleDatasetField): SampleQueryKind {
  return field.type === 'select' ? 'select' : field.type === 'number' || field.type === 'money' ? 'number' : 'text';
}

/** The fields a condition or the sort can use: the dataset's table columns. */
export function queryFields(dataset: SampleDataset): SampleDatasetField[] {
  return dataset.fields.filter((field) => field.inTable);
}

export function fieldOf(dataset: SampleDataset, id: string): SampleDatasetField | null {
  return dataset.fields.find((field) => field.id === id) ?? null;
}

let nextCondition = 100;

/** A new condition on the dataset's first field (or `field`), with that field's first operator and an empty value. */
export function newCondition(dataset: SampleDataset, fieldId?: string): SampleCondition {
  const field = (fieldId ? fieldOf(dataset, fieldId) : null) ?? queryFields(dataset)[0];
  const kind = queryKind(field);
  return { id: `c-${++nextCondition}`, field: field.id, op: OPERATORS[kind][0], value: kind === 'select' ? (field.options?.[0]?.value ?? null) : null };
}

/** Whether a condition has what it needs to filter (an empty value is ignored). */
export function isComplete(condition: SampleCondition): boolean {
  return condition.value !== null && condition.value !== '';
}

function test(record: SampleRecord, condition: SampleCondition, field: SampleDatasetField): boolean {
  const actual = record.values[condition.field];
  if (queryKind(field) === 'number') {
    const a = typeof actual === 'number' ? actual : Number.NaN;
    const b = Number(condition.value);
    switch (condition.op) {
      case 'gt':
        return a > b;
      case 'lt':
        return a < b;
      case 'isNot':
        return a !== b;
      default:
        return a === b;
    }
  }
  const a = typeof actual === 'string' ? actual.toLowerCase() : '';
  const b = String(condition.value).toLowerCase();
  switch (condition.op) {
    case 'contains':
      return a.includes(b);
    case 'isNot':
      return a !== b;
    default:
      return a === b;
  }
}

/** The records the query selects, in its order. */
export function runQuery(records: readonly SampleRecord[], query: SampleQuery, dataset: SampleDataset): SampleRecord[] {
  const active = query.conditions.filter(isComplete);
  const selected = records.filter((record) =>
    active.every((condition) => {
      const field = fieldOf(dataset, condition.field);
      return !field || test(record, condition, field);
    }),
  );
  const direction = query.sortDirection === 'desc' ? -1 : 1;
  return selected.sort((x, y) => {
    const a = x.values[query.sortField];
    const b = y.values[query.sortField];
    const order =
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
    return order * direction;
  });
}

function literal(value: string | number | null, kind: SampleQueryKind): string {
  if (kind === 'number') {
    return String(Number(value));
  }
  return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The `where` expression of the complete conditions (`roast == 'light' && stock > 0`), empty without any. */
export function expressionOf(query: SampleQuery, dataset: SampleDataset): string {
  return query.conditions
    .filter(isComplete)
    .map((condition) => {
      const field = fieldOf(dataset, condition.field);
      const kind = field ? queryKind(field) : 'text';
      return `${condition.field} ${SYMBOLS[condition.op]} ${literal(condition.value, kind)}`;
    })
    .join(' && ');
}

/** A condition's value as a reader sees it: an option's label, or the value. */
export function valueLabel(condition: SampleCondition, dataset: SampleDataset): string {
  const field = fieldOf(dataset, condition.field);
  const option = field?.options?.find((o) => o.value === condition.value);
  return option ? option.label : String(condition.value ?? '');
}
