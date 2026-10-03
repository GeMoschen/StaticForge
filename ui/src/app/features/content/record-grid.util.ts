import type { ContentDefinition, EditorDefinition, EditorType, SelectOption } from '../forms/form.model';
import type { RecordSort } from './content.service';

/**
 * Editor types with a natural order: the record grid's columns and the only sortable fields.
 * Mirrors `DatasetQueryParser.SCALAR_TYPES` on the server, which rejects sorting on anything else.
 */
export const SCALAR_EDITOR_TYPES: ReadonlySet<EditorType> = new Set<EditorType>([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'COLOR',
]);

/** Record meta fields every dataset can be sorted by. */
export const META_SORT_FIELDS: ReadonlySet<string> = new Set(['_displayName', '_uid', '_changedAt']);

/** One grid column derived from a dataset schema. */
export interface RecordColumn {
  field: string;
  label: string;
  type: EditorType;
  /** Shown unless the viewer hid it; long text starts hidden. */
  defaultVisible: boolean;
  /** A SELECT editor's choices (value and label), for the filter builder and the cell's text. */
  options?: SelectOption[];
}

/**
 * The grid columns of a dataset: every scalar editor, groups flattened (their editors share the
 * record's namespace). Lists, catalogs, rich text, media and references are never columns — the
 * listing endpoint does not return them. The dataset's title field starts hidden: its value is the
 * record's name, which the grid's first column already shows (two identical "Name" columns otherwise).
 */
export function deriveColumns(
  definition: ContentDefinition | null | undefined,
  titleEditor?: string | null,
): RecordColumn[] {
  const columns: RecordColumn[] = [];
  const walk = (editors: EditorDefinition[] | undefined) => {
    for (const editor of editors ?? []) {
      if (editor.type === 'GROUP') {
        walk(editor.items);
      } else if (SCALAR_EDITOR_TYPES.has(editor.type) && !editor.hidden) {
        columns.push({
          field: editor.name,
          label: editor.label?.trim() || editor.name,
          type: editor.type,
          defaultVisible: editor.type !== 'TEXTAREA' && editor.name !== titleEditor,
          ...(editor.type === 'SELECT' && editor.options?.length ? { options: editor.options } : {}),
        });
      }
    }
  };
  walk(definition?.editors);
  return columns;
}

/**
 * Drops sort keys the schema no longer supports (a column renamed or removed since the sort was
 * chosen), so a stale sort falls back to the default order instead of a `400`.
 */
export function sanitizeSort(sort: RecordSort[], columns: RecordColumn[]): RecordSort[] {
  const allowed = new Set(columns.map((c) => c.field));
  return sort.filter((s) => META_SORT_FIELDS.has(s.field) || allowed.has(s.field));
}

/** The words a cell shows for a boolean (translated by the caller). */
export interface BooleanLabels {
  yes: string;
  no: string;
}

/** A cell's text: booleans as Yes/No, a select's value as its option's label, absent values empty, everything else as-is. */
export function formatCell(value: unknown, column: Pick<RecordColumn, 'type' | 'options'>, labels: BooleanLabels): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (column.type === 'BOOLEAN') {
    return value === true ? labels.yes : value === false ? labels.no : String(value);
  }
  if (column.type === 'SELECT') {
    return column.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  if (column.type === 'DATETIME' && typeof value === 'string') {
    return value.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1 UTC');
  }
  return String(value);
}

/** The wire sort of a data-table sort: the column ids are the field names (`_displayName`, `_changedAt`, a dataset field). */
export function toRecordSort(sort: readonly { id: string; direction: 'asc' | 'desc' }[]): RecordSort[] {
  return sort.map((key) => ({ field: key.id, direction: key.direction }));
}
