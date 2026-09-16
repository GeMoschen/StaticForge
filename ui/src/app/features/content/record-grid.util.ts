import type { ContentDefinition, EditorDefinition, EditorType } from '../forms/form.model';
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
}

/**
 * The grid columns of a dataset: every scalar editor, groups flattened (their editors share the
 * record's namespace). Lists, catalogs, rich text, media and references are never columns — the
 * listing endpoint does not return them.
 */
export function deriveColumns(definition: ContentDefinition | null | undefined): RecordColumn[] {
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
          defaultVisible: editor.type !== 'TEXTAREA',
        });
      }
    }
  };
  walk(definition?.editors);
  return columns;
}

/**
 * The next sort after a header activation. A plain activation sorts by that column alone, cycling
 * ascending → descending → unsorted; with `additive` (shift-click) the column is added to, cycled
 * within, or removed from the existing keys and the others keep their order.
 */
export function toggleSort(current: RecordSort[], field: string, additive: boolean): RecordSort[] {
  const existing = current.find((s) => s.field === field);
  const next: RecordSort | null =
    !existing ? { field, direction: 'asc' } : existing.direction === 'asc' ? { field, direction: 'desc' } : null;
  if (!additive) {
    return next ? [next] : [];
  }
  if (!existing) {
    return [...current, next!];
  }
  return next ? current.map((s) => (s.field === field ? next : s)) : current.filter((s) => s.field !== field);
}

/**
 * Drops sort keys the schema no longer supports (a column renamed or removed since the sort was
 * chosen), so a stale sort falls back to the default order instead of a `400`.
 */
export function sanitizeSort(sort: RecordSort[], columns: RecordColumn[]): RecordSort[] {
  const allowed = new Set(columns.map((c) => c.field));
  return sort.filter((s) => META_SORT_FIELDS.has(s.field) || allowed.has(s.field));
}

/** The position (1-based) and direction of a column in a multi-key sort, for the header indicator. */
export function sortIndicator(sort: RecordSort[], field: string): { position: number; direction: 'asc' | 'desc' } | null {
  const index = sort.findIndex((s) => s.field === field);
  return index < 0 ? null : { position: index + 1, direction: sort[index].direction };
}

/** `aria-sort` for a column header; multi-key sorts report only the primary key as sorted. */
export function ariaSort(sort: RecordSort[], field: string): 'ascending' | 'descending' | 'none' {
  if (sort[0]?.field !== field) {
    return 'none';
  }
  return sort[0].direction === 'asc' ? 'ascending' : 'descending';
}

/** A cell's text: booleans as Yes/No, absent values empty, everything else as-is. */
export function formatCell(value: unknown, type: EditorType): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (type === 'BOOLEAN') {
    return value === true ? 'Yes' : value === false ? 'No' : String(value);
  }
  if (type === 'DATETIME' && typeof value === 'string') {
    return value.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1 UTC');
  }
  return String(value);
}

const HIDDEN_COLUMNS_KEY = 'sf-record-grid-hidden';

/**
 * The columns a viewer hid for one dataset, remembered in `localStorage` (a per-viewer convenience:
 * storage may be unavailable, so every access is guarded and the default is "nothing hidden").
 */
export function readHiddenColumns(projectKey: string, datasetUuid: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(`${HIDDEN_COLUMNS_KEY}:${projectKey}:${datasetUuid}`);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : null;
  } catch {
    return null;
  }
}

export function writeHiddenColumns(projectKey: string, datasetUuid: string, hidden: ReadonlySet<string>): void {
  try {
    localStorage.setItem(`${HIDDEN_COLUMNS_KEY}:${projectKey}:${datasetUuid}`, JSON.stringify([...hidden]));
  } catch {
    // Storage unavailable (private mode, quota): the choice just isn't remembered.
  }
}
