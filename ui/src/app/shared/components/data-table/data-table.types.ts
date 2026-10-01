import type { SfButtonVariant } from '../sf-button.component';

export type SfDataTableAlign = 'start' | 'center' | 'end';
export type SfDataTableSortDirection = 'asc' | 'desc';
/** Client: the table sorts, filters, searches and pages `rows` itself. Server: `rows` is what the host fetched. */
export type SfDataTableMode = 'client' | 'server';
/** `none`: every row (virtually scrolled); `pager`: page x of y; `infinite`: "load more" at the end. */
export type SfDataTablePaging = 'none' | 'pager' | 'infinite';

/** One column of an `sf-data-table`. */
export interface SfDataTableColumn<T> {
  /** Unique within the table; the key of cell templates, sorting, preferences and URL params. */
  id: string;
  /** The (translated) header text; also the column's name in the chooser and in announcements. */
  header: string;
  /** The value of the cell: its text without a cell template, and what client sorting and search use. */
  value?: (row: T) => unknown;
  /** Client sorting by this order instead of comparing `value`s. */
  compare?: (a: T, b: T) => number;
  sortable?: boolean;
  /** Whether the chooser may hide it (default true). */
  hideable?: boolean;
  /** Hidden until the user shows it (default false). */
  hidden?: boolean;
  /** Initial width in px; without one the column shares the free space. */
  width?: number;
  /** Smallest width a resize may reach, px (default 48). */
  minWidth?: number;
  align?: SfDataTableAlign;
  /** Whether client search looks at this column's `value` (default true). */
  searchable?: boolean;
}

export interface SfDataTableSort {
  id: string;
  direction: SfDataTableSortDirection;
}

export interface SfDataTableFilterOption {
  value: string;
  /** Translated. */
  label: string;
}

/** A filter of the filter menu: the user picks any of its options; each picked option is a removable chip. */
export interface SfDataTableFilter<T = unknown> {
  /** Unique; also its URL param name. Must not be `q`, `sort` or `page`. */
  id: string;
  /** Translated. */
  label: string;
  options: readonly SfDataTableFilterOption[];
  /**
   * Client mode: whether a row passes the picked values. Default: the text of the column with the same id is one of
   * them.
   */
  match?: (row: T, values: readonly string[]) => boolean;
}

/** Search, filters, sort and page: what the URL holds and what a server-mode host fetches. */
export interface SfDataTableQuery {
  search: string;
  /** Picked option values by filter id (no empty lists). */
  filters: Readonly<Record<string, readonly string[]>>;
  /** Primary sort first. */
  sort: readonly SfDataTableSort[];
  /** Zero-based. */
  page: number;
}

export interface SfDataTableSelection<T> {
  /** Keys (`rowKey`) of the selected rows; in server "all matching" mode only those of the loaded rows. */
  keys: string[];
  /** The selected rows the table knows (client: all of them; server: those loaded). */
  rows: T[];
  /** Server mode: every row matching the query is selected, not just `keys`. */
  allMatching: boolean;
  /** How many rows are selected (`total` when `allMatching`). */
  count: number;
}

/** A button of the bulk action bar. */
export interface SfDataTableBulkAction<T> {
  id: string;
  /** Translated. */
  label: string;
  icon?: string;
  variant?: SfButtonVariant;
  /** Run when the button is clicked (`bulkAction` is emitted too). */
  action?: (selection: SfDataTableSelection<T>) => void;
}

export interface SfDataTableBulkActionEvent<T> {
  action: SfDataTableBulkAction<T>;
  selection: SfDataTableSelection<T>;
}

/** The context of a sfDataTableCell template: the row is implicit; value, index and column are named. */
export interface SfDataTableCellContext<T> {
  $implicit: T;
  row: T;
  /** The column's `value(row)` (undefined without an accessor). */
  value: unknown;
  /** Index of the row in the whole (filtered, sorted) list. */
  index: number;
  column: SfDataTableColumn<T>;
}

/** The context of a sfDataTableHeader template: the column is implicit. */
export interface SfDataTableHeaderContext<T> {
  $implicit: SfDataTableColumn<T>;
}
