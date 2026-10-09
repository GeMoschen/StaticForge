import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  numberAttribute,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShortcutService } from '../../../core/ui/shortcut.service';
import { ContextMenuService, type ContextMenuItem } from '../../services/context-menu.service';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import type { TableColumnsPreference } from '../../../core/preferences/preferences.types';
import { SfVirtualScrollDirective } from '../../virtual/virtual-window';
import { SfTagComponent } from '../display/sf-tag.component';
import { SfCheckboxComponent } from '../forms/sf-checkbox.component';
import { SfSearchInputComponent } from '../forms/sf-search-input.component';
import { SfBannerComponent } from '../layout/sf-banner.component';
import { SfSkeletonComponent } from '../layout/sf-skeleton.component';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../popover/sf-popover.component';
import { SfButtonComponent } from '../sf-button.component';
import { SfEmptyStateComponent } from '../sf-empty-state.component';
import { SfIconComponent } from '../sf-icon.component';
import type {
  SfDataTableBulkAction,
  SfDataTableBulkActionEvent,
  SfDataTableCellContext,
  SfDataTableColumn,
  SfDataTableFilter,
  SfDataTableMode,
  SfDataTablePaging,
  SfDataTableQuery,
  SfDataTableSelection,
  SfDataTableSort,
} from './data-table.types';
import {
  DEFAULT_MIN_WIDTH,
  EMPTY_QUERY,
  filterRows,
  moveInOrder,
  nextSort,
  paramsToQuery,
  queryToParams,
  resolveColumns,
  sameFilters,
  sameQuery,
  sameSort,
  sortRows,
  textOf,
} from './data-table.util';
import { SfDataTableColumnMove, SfDataTableColumnsComponent } from './sf-data-table-columns.component';
import { SfDataTableCellDirective, SfDataTableHeaderDirective } from './sf-data-table-templates.directive';

/** Keyboard resize steps, px. */
const RESIZE_STEP = 16;
const RESIZE_STEP_LARGE = 64;
const MAX_WIDTH = 2000;
/** The width a resize starts from when the column has none and can't be measured (no layout). */
const FALLBACK_WIDTH = 160;
/** Infinite scrolling asks for more this many rows before the end. */
const LOAD_MORE_THRESHOLD_ROWS = 3;
/** Targets inside a row that handle their own clicks (the row doesn't open). */
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [contenteditable]';

const generatedKeys = new WeakMap<object, string>();
let nextGeneratedKey = 0;

/** The default `rowKey`: the row's `id`, else a key bound to the row object. */
export function defaultRowKey(row: unknown): string {
  if (row !== null && typeof row === 'object') {
    const id = (row as { id?: unknown }).id;
    if (id !== null && id !== undefined) {
      return String(id);
    }
    let key = generatedKeys.get(row);
    if (!key) {
      key = `sf-row-${nextGeneratedKey++}`;
      generatedKeys.set(row, key);
    }
    return key;
  }
  return String(row);
}

interface FilterChip {
  filterId: string;
  filterLabel: string;
  value: string;
  label: string;
}

interface Resize {
  id: string;
  startX: number;
  startWidth: number;
  rtl: boolean;
}

/**
 * The data table (M35.8): column definitions with cell templates, sorting (Shift: multi-sort), resizable, hideable and
 * reorderable columns (persisted under `tableId`), selection with a bulk action bar, a filter bar synced to the URL,
 * client or server paging, loading / empty / error states and virtual scrolling — in a `<table role="grid">` that fills
 * the height it is given (the body scrolls, the header and first column stay).
 *
 * **Grid, row focus.** The table is `role=grid` (`aria-multiselectable` when selectable) with a roving tabindex on the
 * rows, like Changes: ↑/↓, Home/End move the active row (Shift extends the selection as a range), Space toggles its
 * selection, Enter (and a click) emits `rowOpen`; Ctrl/⌘+click toggles, Shift+click selects a range. Cells are not
 * focus stops of their own: the row checkboxes are out of the tab order, and keys typed into controls inside a cell
 * stay theirs. `aria-rowcount` counts every matching row plus the header, `aria-rowindex` places the rendered rows.
 *
 * **Modes.** `client`: the table searches, filters, sorts and pages `rows`. `server`: `rows` is what the host fetched
 * for {@link query} (emitted as `queryChange` — once on start and after every change — with `sortChange` /
 * `pageChange`), `total` is the number of matching rows; "select all N matching" turns the selection into
 * `allMatching`; infinite paging emits `loadMore`.
 *
 * **URL.** With `urlSync` (a param prefix, `''` for none) search, filters, sort and page live in the query params —
 * `q`, `sort=name,-changed`, `page` (1-based), one repeated param per filter id; a prefix namespaces them (`pages.q`).
 * Typing replaces the history entry; other changes push one. Back/forward restore the state.
 *
 * ```html
 * <sf-data-table label="Pages" [columns]="columns" [rows]="pages()" tableId="pages" urlSync="" selectable searchable
 *                [filters]="filters" paging="pager" (rowOpen)="open($event)">
 *   <ng-template sfDataTableCell="status" let-row><sf-status [status]="row.status" /></ng-template>
 *   <sf-button sfDataTableBulkActions (click)="publish()">Publish</sf-button>
 * </sf-data-table>
 * ```
 *
 * Projected slots: `[sfDataTableToolbar]` (end of the filter bar), `[sfDataTableBulkActions]` (bulk bar).
 */
@Component({
  selector: 'sf-data-table',
  standalone: true,
  host: { '[class.sf-data-table--two-line]': 'twoLine()' },
  imports: [
    NgTemplateOutlet,
    TranslocoPipe,
    SfVirtualScrollDirective,
    SfBannerComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfDataTableColumnsComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfPopoverComponent,
    SfPopoverTriggerDirective,
    SfSearchInputComponent,
    SfSkeletonComponent,
    SfTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-data-table.component.html',
  styleUrl: './sf-data-table.component.scss',
})
export class SfDataTableComponent<T> implements OnInit, OnDestroy {
  // ── Data ──────────────────────────────────────────────────────────────────
  readonly columns = input.required<readonly SfDataTableColumn<T>[]>();
  readonly rows = input<readonly T[]>([]);
  /** The grid's accessible name (translated). */
  readonly label = input.required<string>();
  readonly mode = input<SfDataTableMode>('client');
  /** Server mode: how many rows match the query (pager, "select all N", `aria-rowcount`). */
  readonly total = input<number | null>(null);
  /** A stable key per row (selection, tracking); default: the row's `id`. */
  readonly rowKey = input<(row: T) => string>(defaultRowKey);
  /**
   * The key of the row whose item is open beside the table (a detail pane, a drawer): the row gets a highlighted
   * background, a leading accent bar and `aria-current`. Not a selection — it does not tick the row.
   */
  readonly currentKey = input<string | null>(null);
  /** The row's name in "Select {name}"; default: the first visible column's text. */
  readonly rowLabel = input<((row: T) => string) | null>(null);
  readonly loading = input(false, { transform: booleanAttribute });
  /** An error message (translated), or `true` for the generic one; shows a Retry button. */
  readonly error = input<string | boolean | null>(null);
  readonly emptyTitle = input<string | null>(null);
  readonly emptyDescription = input<string | undefined>(undefined);

  // ── Features ──────────────────────────────────────────────────────────────
  /**
   * Whether a click on a row opens it (`rowOpen`): the rows then show the pointer cursor. On by default, because
   * almost every table opens its rows; turn it off (`[rowsOpenable]="false"`) where a click does nothing.
   */
  /**
   * The rows hold two lines (an `sf-table-identity` cell): they get the height those need, with comfortable spacing
   * between the lines. Tables whose rows are one line keep the compact height.
   */
  readonly twoLine = input(false, { transform: booleanAttribute });
  readonly rowsOpenable = input(true, { transform: booleanAttribute });
  readonly selectable = input(false, { transform: booleanAttribute });
  readonly bulkActions = input<readonly SfDataTableBulkAction<T>[]>([]);
  /**
   * The menu of a right click on a row (or Shift+F10 / the menu key on it): the entries for the rows it acts on — the
   * selection when the row is part of a selection of several, else the row alone. No entries, no menu.
   */
  readonly rowMenu = input<((rows: T[]) => ContextMenuItem[]) | null>(null);
  /** A left click on empty space (below the rows) clears the selection. */
  readonly emptyClickClears = input(false, { transform: booleanAttribute });
  /** The menu of a right click on empty space (below the rows); no entries, no menu. */
  readonly emptyMenu = input<(() => ContextMenuItem[]) | null>(null);
  readonly searchable = input(false, { transform: booleanAttribute });
  readonly searchPlaceholder = input<string | null>(null);
  /** Search typing settles for this long (ms) before the query changes; 0 applies every keystroke. */
  readonly searchDebounce = input(300, { transform: numberAttribute });
  readonly filters = input<readonly SfDataTableFilter<T>[]>([]);
  readonly initialSort = input<readonly SfDataTableSort[]>([]);
  readonly paging = input<SfDataTablePaging>('none');
  readonly pageSize = input(50, { transform: numberAttribute });
  /** Persists the column layout (order, hidden, widths) in the user's preferences under this id. */
  readonly tableId = input<string | null>(null);
  /** Syncs search, filters, sort and page with the URL; the value prefixes the param names (`''`: none). */
  readonly urlSync = input<string | null>(null);
  readonly stickyFirstColumn = input(true, { transform: booleanAttribute });
  /** Offers the "Columns" chooser (when any column is hideable or there are several). */
  readonly columnChooser = input(true, { transform: booleanAttribute });

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly queryChange = output<SfDataTableQuery>();
  readonly sortChange = output<readonly SfDataTableSort[]>();
  /** Zero-based page. */
  readonly pageChange = output<number>();
  readonly selectionChange = output<SfDataTableSelection<T>>();
  readonly rowOpen = output<T>();
  readonly retry = output<void>();
  /** Server infinite paging: the user reached the end (or clicked "Load more"). */
  readonly loadMore = output<void>();
  readonly bulkAction = output<SfDataTableBulkActionEvent<T>>();

  private readonly cellDirectives = contentChildren(SfDataTableCellDirective);
  private readonly headerDirectives = contentChildren(SfDataTableHeaderDirective);
  private readonly virtual = viewChild(SfVirtualScrollDirective);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly contextMenu = inject(ContextMenuService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router, { optional: true });
  private readonly route = inject(ActivatedRoute, { optional: true });
  private preferencesService: PreferencesService | null = null;
  private destroyed = false;

  // ── State ─────────────────────────────────────────────────────────────────
  private readonly _query = signal<SfDataTableQuery>(EMPTY_QUERY);
  /** Search, filters, sort and page as they are now. */
  readonly query = this._query.asReadonly();
  protected readonly searchDraft = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Client infinite paging: how many pages are shown. */
  private readonly loadedPages = signal(1);
  /** Server infinite paging: the row count `loadMore` was last emitted at (once per batch). */
  private loadMoreAt = -1;

  private readonly selectedKeys = signal<ReadonlySet<string>>(new Set());
  private readonly allMatching = signal(false);
  private readonly activeIndex = signal(0);
  private anchor: number | null = null;
  private rangeBase: ReadonlySet<string> = new Set();

  protected readonly maxWidth = MAX_WIDTH;
  private readonly localLayout = signal<TableColumnsPreference>({});
  private readonly dragWidth = signal<{ id: string; width: number } | null>(null);
  private resize: Resize | null = null;

  // ── Columns ───────────────────────────────────────────────────────────────
  private readonly layoutPreference = computed<TableColumnsPreference>(() => {
    const id = this.tableId();
    return id ? this.preferences().tableColumns(id) : this.localLayout();
  });
  protected readonly layout = computed(() => resolveColumns(this.columns(), this.layoutPreference()));
  protected readonly visibleColumns = computed(() => this.layout().ordered.filter((c) => !this.layout().hidden.has(c.id)));
  protected readonly columnSpan = computed(() => this.visibleColumns().length + (this.selectable() ? 1 : 0));
  protected readonly cellTemplates = computed(() => new Map(this.cellDirectives().map((d) => [d.columnId(), d.template])));
  protected readonly headerTemplates = computed(
    () => new Map(this.headerDirectives().map((d) => [d.columnId(), d.template])),
  );
  protected readonly chooserAvailable = computed(
    () => this.columnChooser() && (this.columns().length > 1 || this.columns().some((c) => c.hideable !== false)),
  );

  // ── Rows ──────────────────────────────────────────────────────────────────
  protected readonly isServer = computed(() => this.mode() === 'server');
  /** Every matching row in order (server: the loaded ones). */
  private readonly matching = computed<readonly T[]>(() => {
    if (this.isServer()) {
      return this.rows();
    }
    const filtered = filterRows(this.rows(), this._query(), this.columns(), this.filters());
    return sortRows(filtered, this._query().sort, this.columns());
  });
  /** How many rows match the query. */
  readonly matchingCount = computed(() =>
    this.isServer() ? (this.total() ?? this.rows().length) : this.matching().length,
  );
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.matchingCount() / Math.max(1, this.pageSize()))));
  protected readonly currentPage = computed(() => Math.min(this._query().page, this.pageCount() - 1));
  /** Index (in the whole list) of the first rendered row. */
  protected readonly offset = computed(() => (this.paging() === 'pager' ? this.currentPage() * this.pageSize() : 0));
  /** The rows of the current page (or every loaded row): what the grid scrolls through. */
  protected readonly pageRows = computed<readonly T[]>(() => {
    const rows = this.matching();
    if (this.isServer()) {
      return rows;
    }
    if (this.paging() === 'pager') {
      return rows.slice(this.offset(), this.offset() + this.pageSize());
    }
    if (this.paging() === 'infinite') {
      return rows.slice(0, this.loadedPages() * this.pageSize());
    }
    return rows;
  });
  protected readonly hasMore = computed(() => {
    if (this.paging() !== 'infinite') {
      return false;
    }
    return this.isServer() ? this.rows().length < (this.total() ?? 0) : this.pageRows().length < this.matching().length;
  });
  protected readonly active = computed(() => Math.max(0, Math.min(this.activeIndex(), this.pageRows().length - 1)));
  protected readonly showSkeleton = computed(() => this.loading() && this.pageRows().length === 0 && !this.error());
  protected readonly showEmpty = computed(() => !this.loading() && !this.error() && this.pageRows().length === 0);
  protected readonly errorMessage = computed(() => {
    const error = this.error();
    return typeof error === 'string' && error ? error : null;
  });

  // ── Filters ───────────────────────────────────────────────────────────────
  protected readonly filtered = computed(
    () => !!this._query().search || Object.values(this._query().filters).some((v) => v.length > 0),
  );
  protected readonly chips = computed<FilterChip[]>(() => {
    const query = this._query();
    return this.filters().flatMap((filter) =>
      (query.filters[filter.id] ?? []).map((value) => ({
        filterId: filter.id,
        filterLabel: filter.label,
        value,
        label: filter.options.find((o) => o.value === value)?.label ?? value,
      })),
    );
  });
  /** Prefix of the ids that name the filter groups of the filter popover. */
  protected readonly filterGroupId = `${sfUniqueId('sf-data-table-filter')}-`;
  protected isPicked(filterId: string, value: string): boolean {
    return (this._query().filters[filterId] ?? []).includes(value);
  }
  protected readonly showToolbar = computed(
    () => this.searchable() || this.filters().length > 0 || this.chooserAvailable(),
  );

  // ── Selection ─────────────────────────────────────────────────────────────
  readonly selectedCount = computed(() => (this.allMatching() ? this.matchingCount() : this.selectedKeys().size));
  protected readonly pageSelection = computed<'none' | 'some' | 'all'>(() => {
    const rows = this.pageRows();
    if (rows.length === 0) {
      return 'none';
    }
    if (this.allMatching()) {
      return 'all';
    }
    const keys = this.selectedKeys();
    const key = this.rowKey();
    const count = rows.filter((row) => keys.has(key(row))).length;
    return count === 0 ? 'none' : count === rows.length ? 'all' : 'some';
  });
  protected readonly offerAllMatching = computed(
    () =>
      this.selectable() &&
      this.pageSelection() === 'all' &&
      !this.allMatching() &&
      this.selectedKeys().size < this.matchingCount(),
  );

  constructor() {
    // The keys the rows answer to, listed on the `?` sheet; the table handles them itself (M35.14).
    const selectable = () => this.selectable();
    const keys = (id: string, keys: string, enabled?: () => boolean) => ({
      id: `table.${id}`,
      keys,
      scope: 'component' as const,
      group: 'lists' as const,
      description: `frame.shortcuts.items.${id}`,
      enabled,
    });
    inject(ShortcutService).use([
      keys('rowMove', 'ArrowUp'),
      keys('rowOpen', 'Enter'),
      keys('rowSelect', 'Space', selectable),
      keys('rowExtend', 'Shift+ArrowDown', selectable),
      keys('rowAll', 'Mod+A', selectable),
    ]);

    // A batch that ended (loading went false, or an error came) without new rows may be asked for again.
    effect(() => {
      // Both read every time: each is a trigger (no short-circuit).
      const loading = this.loading();
      const failed = !!this.error();
      const settled = !loading || failed;
      untracked(() => {
        if (settled && this.loadMoreAt === this.rows().length) {
          this.loadMoreAt = -1;
        }
      });
    });
  }

  ngOnInit(): void {
    const prefix = this.urlSync();
    if (prefix !== null && this.route && this.router) {
      this.applyQuery(this.readUrl(this.route.snapshot.queryParamMap), false);
      this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        const next = this.readUrl(params);
        if (!sameQuery(next, this._query())) {
          this.applyQuery(next, true);
        }
      });
    } else {
      this._query.set({ ...EMPTY_QUERY, sort: [...this.initialSort()] });
    }
    this.searchDraft.set(this._query().search);
    // The host fetches its first page on this; emitted after the current render so it may change its bindings.
    queueMicrotask(() => {
      if (!this.destroyed) {
        this.queryChange.emit(this._query());
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  /** Changes the query from the UI: resets what depends on it, writes the URL and tells the host. */
  private updateQuery(patch: Partial<SfDataTableQuery>, replaceUrl = false): void {
    const previous = this._query();
    const resetPage = patch.page === undefined;
    const next: SfDataTableQuery = { ...previous, ...patch, ...(resetPage ? { page: 0 } : {}) };
    if (sameQuery(previous, next)) {
      return;
    }
    this.commit(previous, next);
    this.writeUrl(next, replaceUrl);
  }

  /** Takes a query from the URL (on start, and on back/forward). */
  private applyQuery(next: SfDataTableQuery, emit: boolean): void {
    const previous = this._query();
    if (!this.searchTimer) {
      this.searchDraft.set(next.search);
    }
    if (emit) {
      this.commit(previous, next);
    } else {
      this._query.set(next);
    }
  }

  private commit(previous: SfDataTableQuery, next: SfDataTableQuery): void {
    this._query.set(next);
    const narrowed = previous.search !== next.search || !sameFilters(previous.filters, next.filters);
    if (narrowed || !sameSort(previous.sort, next.sort)) {
      this.loadedPages.set(1);
      this.loadMoreAt = -1;
      this.activeIndex.set(0);
      this.anchor = null;
    }
    if (narrowed && (this.selectedKeys().size > 0 || this.allMatching())) {
      this.setSelection(new Set(), false);
    }
    if (previous.page !== next.page) {
      this.activeIndex.set(0);
      this.anchor = null;
      this.scroller()?.nativeElement.scrollTo?.({ top: 0 });
    }
    this.queryChange.emit(next);
    if (!sameSort(previous.sort, next.sort)) {
      this.sortChange.emit(next.sort);
    }
    if (previous.page !== next.page) {
      this.pageChange.emit(next.page);
    }
  }

  private filterIds(): string[] {
    return this.filters().map((f) => f.id);
  }

  private readUrl(params: ParamMap): SfDataTableQuery {
    return paramsToQuery(params, this.urlSync() ?? '', this.filterIds(), this.initialSort(), this.paging() === 'pager');
  }

  private writeUrl(query: SfDataTableQuery, replaceUrl: boolean): void {
    const prefix = this.urlSync();
    if (prefix === null || !this.router || !this.route) {
      return;
    }
    const queryParams = queryToParams(query, prefix, this.filterIds(), this.initialSort(), this.paging() === 'pager');
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl });
  }

  // ── Search and filters ────────────────────────────────────────────────────

  protected onSearch(value: string): void {
    this.searchDraft.set(value);
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const apply = () => {
      this.searchTimer = null;
      this.updateQuery({ search: value.trim() }, true);
    };
    if (this.searchDebounce() > 0) {
      this.searchTimer = setTimeout(apply, this.searchDebounce());
    } else {
      apply();
    }
  }

  toggleFilterValue(filterId: string, value: string): void {
    const current = this._query().filters[filterId] ?? [];
    const values = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.setFilterValues(filterId, values);
  }

  private setFilterValues(filterId: string, values: readonly string[]): void {
    const filters: Record<string, readonly string[]> = { ...this._query().filters };
    if (values.length > 0) {
      filters[filterId] = values;
    } else {
      delete filters[filterId];
    }
    this.updateQuery({ filters });
  }

  protected removeChip(chip: FilterChip): void {
    this.setFilterValues(
      chip.filterId,
      (this._query().filters[chip.filterId] ?? []).filter((v) => v !== chip.value),
    );
  }

  /** Empties the search and every filter. */
  clearFilters(): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.searchDraft.set('');
    this.updateQuery({ search: '', filters: {} });
  }

  // ── Sorting ───────────────────────────────────────────────────────────────

  protected sortOf(column: SfDataTableColumn<T>): { direction: 'asc' | 'desc'; position: number } | null {
    const sort = this._query().sort;
    const index = sort.findIndex((s) => s.id === column.id);
    return index < 0 ? null : { direction: sort[index].direction, position: index + 1 };
  }

  /** `aria-sort` belongs on the primary sorted column only. */
  protected ariaSort(column: SfDataTableColumn<T>): string | null {
    const primary = this._query().sort[0];
    if (!column.sortable || primary?.id !== column.id) {
      return null;
    }
    return primary.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected onSortClick(event: MouseEvent, column: SfDataTableColumn<T>): void {
    this.toggleSort(column, event.shiftKey);
  }

  protected onSortKeydown(event: KeyboardEvent, column: SfDataTableColumn<T>): void {
    if (event.key === 'Enter') {
      event.preventDefault(); // no synthetic click: it would not carry Shift
      this.toggleSort(column, event.shiftKey);
    }
  }

  private toggleSort(column: SfDataTableColumn<T>, multi: boolean): void {
    this.updateQuery({ sort: nextSort(this._query().sort, column.id, multi) });
  }

  // ── Paging ────────────────────────────────────────────────────────────────

  goToPage(page: number): void {
    const clamped = Math.max(0, Math.min(page, this.pageCount() - 1));
    if (clamped !== this._query().page) {
      this.updateQuery({ page: clamped });
    }
  }

  /**
   * Shows (client) or asks the host for (server) the next batch. Scrolling asks once per batch; the explicit button
   * (`explicit`) always asks unless a load is running — the way to try again after a failed batch.
   */
  protected requestMore(explicit = false): void {
    if (!this.hasMore()) {
      return;
    }
    if (this.isServer()) {
      if (this.loading() || (!explicit && this.loadMoreAt === this.rows().length)) {
        return;
      }
      this.loadMoreAt = this.rows().length;
      this.loadMore.emit();
    } else {
      this.loadedPages.update((pages) => pages + 1);
    }
  }

  protected onScroll(): void {
    this.keepFocus();
    const element = this.scroller()?.nativeElement;
    const rowHeight = this.virtual()?.rowHeight() ?? 0;
    if (!element || !this.hasMore() || element.clientHeight === 0) {
      return;
    }
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_MORE_THRESHOLD_ROWS * rowHeight) {
      this.requestMore();
    }
  }

  /**
   * Scrolling must not lose the keyboard focus: when the focused active row is about to leave the rendered window the
   * focus moves to the scroller (which goes on handling the row keys), and back to the row when it is rendered again.
   */
  private keepFocus(): void {
    const virtual = this.virtual();
    const scroller = this.scroller()?.nativeElement;
    if (!virtual || !scroller) {
      return;
    }
    virtual.measure(); // the window for the new scroll position, whichever scroll listener runs first
    const { start, end } = virtual.window();
    const active = this.active();
    const rendered = active >= start && active < end;
    const focused = this.host.ownerDocument.activeElement;
    if (!rendered && focused instanceof HTMLElement && focused.matches('tr[data-row-index]') && this.host.contains(focused)) {
      scroller.focus({ preventScroll: true });
    } else if (rendered && focused === scroller && this.pageRows().length > 0) {
      this.changeDetector.detectChanges();
      this.host.querySelector<HTMLElement>(`tr[data-row-index="${active}"]`)?.focus({ preventScroll: true });
    }
  }

  // ── Cells ─────────────────────────────────────────────────────────────────

  protected cellText(row: T, column: SfDataTableColumn<T>): string {
    return column.value ? textOf(column.value(row)) : '';
  }

  protected cellContext(row: T, column: SfDataTableColumn<T>, index: number): SfDataTableCellContext<T> {
    return { $implicit: row, row, value: column.value?.(row), index, column };
  }

  protected labelOf(row: T): string {
    const custom = this.rowLabel();
    if (custom) {
      return custom(row);
    }
    const first = this.visibleColumns().find((c) => c.value);
    return (first && this.cellText(row, first)) || this.rowKey()(row);
  }

  protected isSelected(row: T): boolean {
    return this.allMatching() || this.selectedKeys().has(this.rowKey()(row));
  }

  /** The row that is the grid's tab stop: the active one, or the first rendered one while the active is scrolled away. */
  protected isTabStop(index: number, start: number, end: number): boolean {
    const active = this.active();
    return active >= start && active < end ? index === active : index === start;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  /**
   * Selects exactly the rows with these keys (a host restoring a selection, or a scripted state); keys of rows not on
   * the current page stay selected. Does nothing on a table that isn't `selectable`, and emits no `selectionChange`
   * when the selection is already exactly these keys.
   */
  selectKeys(keys: readonly string[]): void {
    if (!this.selectable()) {
      return;
    }
    const next = new Set(keys);
    const current = this.selectedKeys();
    if (!this.allMatching() && next.size === current.size && [...next].every((key) => current.has(key))) {
      return;
    }
    this.setSelection(next, false);
    this.anchor = null;
  }

  /** Deselects everything. */
  clearSelection(): void {
    this.setSelection(new Set(), false);
    this.anchor = null;
  }

  protected selectAllMatching(): void {
    if (this.isServer()) {
      this.setSelection(new Set(this.pageRows().map(this.rowKey())), true);
    } else {
      this.setSelection(new Set(this.matching().map(this.rowKey())), false);
    }
  }

  protected togglePage(checked: boolean): void {
    const keys = this.pageRows().map(this.rowKey());
    const next = new Set(this.allMatching() ? [] : this.selectedKeys());
    for (const key of keys) {
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    this.setSelection(next, false);
  }

  protected setRowSelected(row: T, index: number, selected: boolean): void {
    const key = this.rowKey()(row);
    const next = new Set(this.allMatching() ? this.pageRows().map(this.rowKey()) : this.selectedKeys());
    if (selected) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.setSelection(next, false);
    this.setAnchor(index);
  }

  private toggleRow(row: T, index: number): void {
    this.setRowSelected(row, index, !this.isSelected(row));
  }

  private setAnchor(index: number): void {
    this.anchor = index;
    this.rangeBase = this.allMatching() ? new Set(this.pageRows().map(this.rowKey())) : this.selectedKeys();
  }

  /** Selects the rows between the anchor and `index` on top of what was selected when the anchor was set. */
  private selectRange(index: number): void {
    if (this.anchor === null) {
      this.setAnchor(this.active());
    }
    this.anchor = Math.min(this.anchor!, this.pageRows().length - 1);
    const from = Math.min(this.anchor!, index);
    const to = Math.max(this.anchor!, index);
    const next = new Set(this.rangeBase);
    for (const row of this.pageRows().slice(from, to + 1)) {
      next.add(this.rowKey()(row));
    }
    this.setSelection(next, false);
  }

  private setSelection(keys: ReadonlySet<string>, allMatching: boolean): void {
    this.selectedKeys.set(keys);
    this.allMatching.set(allMatching);
    this.selectionChange.emit(this.selection());
  }

  /** The selection as the outputs report it. */
  selection(): SfDataTableSelection<T> {
    const keys = this.selectedKeys();
    const all = this.allMatching();
    const key = this.rowKey();
    const rows = this.rows().filter((row) => all || keys.has(key(row)));
    return { keys: all ? rows.map(key) : [...keys], rows, allMatching: all, count: this.selectedCount() };
  }

  protected runBulkAction(action: SfDataTableBulkAction<T>): void {
    const selection = this.selection();
    action.action?.(selection);
    this.bulkAction.emit({ action, selection });
  }

  // ── Row keyboard and pointer ──────────────────────────────────────────────

  protected onScrollerClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (this.emptyClickClears() && event.button === 0 && target && !target.closest('thead, tr.sf-data-table__row') && this.selectedCount() > 0) {
      this.clearSelection();
    }
  }

  /** A right click: a row's menu, or the empty-space menu below the rows (the header has none). */
  protected onContextMenu(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('thead, .sf-data-table__spacer')) {
      return;
    }
    const rowElement = target?.closest<HTMLElement>('tr.sf-data-table__row');
    if (!rowElement) {
      const items = this.emptyMenu()?.() ?? [];
      if (items.length) {
        event.preventDefault();
        this.contextMenu.open(event, items);
      }
      return;
    }
    const row = this.pageRows()[Number(rowElement.dataset['rowIndex'])];
    if (row !== undefined) {
      this.openRowMenu(event, row);
    }
  }

  private openRowMenu(target: MouseEvent | KeyboardEvent | HTMLElement, row: T): void {
    const builder = this.rowMenu();
    if (!builder) {
      return;
    }
    const selected = this.selection().rows;
    const rows = this.isSelected(row) && selected.length > 1 ? selected : [row];
    const items = builder(rows);
    if (items.length) {
      if (!(target instanceof HTMLElement)) {
        target.preventDefault();
      }
      this.contextMenu.open(target, items);
    }
  }

  protected onRowKeydown(event: KeyboardEvent, row: T, index: number): void {
    if (event.target !== event.currentTarget) {
      return; // keys typed into a control inside a cell are its own
    }
    this.handleRowKey(event, row, index);
  }

  /**
   * Keys on the scroller itself: it holds the focus while the active row is scrolled out of the rendered window, and
   * the keys keep acting on the active row.
   */
  protected onScrollerKeydown(event: KeyboardEvent): void {
    const row = this.pageRows()[this.active()];
    if (event.target !== event.currentTarget || row === undefined) {
      return;
    }
    this.handleRowKey(event, row, this.active());
  }

  private handleRowKey(event: KeyboardEvent, row: T, index: number): void {
    const last = this.pageRows().length - 1;
    switch (event.key) {
      case 'ArrowDown':
        this.moveTo(Math.min(index + 1, last), event);
        break;
      case 'ArrowUp':
        this.moveTo(Math.max(index - 1, 0), event);
        break;
      case 'Home':
        this.moveTo(0, event);
        break;
      case 'End':
        this.moveTo(last, event);
        break;
      case ' ':
        event.preventDefault();
        if (this.selectable()) {
          this.toggleRow(row, index);
        }
        break;
      case 'Enter':
        event.preventDefault();
        this.rowOpen.emit(row);
        break;
      case 'ContextMenu':
        this.openRowMenu(event, row);
        break;
      case 'F10':
        if (event.shiftKey) {
          this.openRowMenu(event, row);
        }
        break;
      case 'a':
      case 'A':
        // Ctrl/Cmd+A selects the rows of the page instead of the page's text.
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          if (this.selectable()) {
            this.togglePage(true);
          }
        }
        break;
    }
  }

  private moveTo(index: number, event: KeyboardEvent): void {
    event.preventDefault();
    if (event.shiftKey && this.selectable()) {
      this.selectRange(index);
    } else {
      this.anchor = index;
      this.rangeBase = this.selectedKeys();
    }
    this.focusRow(index);
  }

  protected onRowClick(event: MouseEvent, row: T, index: number): void {
    const target = event.target as Element | null;
    const row$ = event.currentTarget as HTMLElement;
    this.activate(index);
    const interactive = target?.closest(INTERACTIVE);
    if (interactive && row$.contains(interactive)) {
      return;
    }
    if (this.selectable() && event.shiftKey) {
      this.selectRange(index);
    } else if (this.selectable() && (event.ctrlKey || event.metaKey)) {
      this.toggleRow(row, index);
    } else {
      this.setAnchor(index);
      this.rowOpen.emit(row);
    }
  }

  /** Shift+click on a row checkbox selects the range instead of toggling the one box. */
  protected onCheckCellClick(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.activate(index);
    if (event.shiftKey) {
      event.preventDefault();
      this.selectRange(index);
    }
  }

  protected onRowFocus(index: number): void {
    this.activate(index);
  }

  /**
   * Makes row `index` active. Without an anchor (at first, after a sort, filter or page change) the row that was active
   * until now becomes the anchor, so a following Shift+click or Shift+arrow selects from there — not from the row just
   * clicked (pointer focus already made it active).
   */
  private activate(index: number): void {
    if (this.anchor === null && this.pageRows().length > 0) {
      this.setAnchor(this.active());
    }
    this.activeIndex.set(index);
  }

  /** Makes row `index` active, renders it (scrolling the window to it) and focuses it. */
  private focusRow(index: number): void {
    this.activeIndex.set(index);
    const virtual = this.virtual();
    const window = virtual?.window();
    if (virtual && window && (index < window.start || index >= window.end)) {
      virtual.scrollToIndex(index);
    }
    this.changeDetector.detectChanges();
    const element = this.host.querySelector<HTMLElement>(`tr[data-row-index="${index}"]`);
    element?.focus();
  }

  // ── Column layout ─────────────────────────────────────────────────────────

  private preferences(): PreferencesService {
    return (this.preferencesService ??= this.injector.get(PreferencesService));
  }

  private saveLayout(patch: TableColumnsPreference): void {
    const id = this.tableId();
    if (id) {
      this.preferences().setTableColumns(id, patch);
    } else {
      this.localLayout.update((layout) => ({ ...layout, ...patch, widths: { ...layout.widths, ...patch.widths } }));
    }
  }

  protected onColumnToggled(change: { id: string; visible: boolean }): void {
    const hidden = new Set(this.layout().hidden);
    if (change.visible) {
      hidden.delete(change.id);
    } else {
      hidden.add(change.id);
    }
    this.saveLayout({ hidden: [...hidden] });
  }

  protected onColumnMoved(move: SfDataTableColumnMove): void {
    const order = this.layout().ordered.map((c) => c.id);
    this.saveLayout({ order: moveInOrder(order, move.id, move.delta) });
    // Render the new order now (the chooser too): the chooser puts focus back on the moved column right after this.
    this.changeDetector.detectChanges();
  }

  protected widthOf(column: SfDataTableColumn<T>): number | null {
    const drag = this.dragWidth();
    if (drag?.id === column.id) {
      return drag.width;
    }
    return this.layout().widths[column.id] ?? column.width ?? null;
  }

  protected minWidthOf(column: SfDataTableColumn<T>): number {
    return column.minWidth ?? DEFAULT_MIN_WIDTH;
  }

  private startWidth(column: SfDataTableColumn<T>, header: HTMLElement): number {
    return this.widthOf(column) ?? (header.getBoundingClientRect().width || FALLBACK_WIDTH);
  }

  private clampWidth(column: SfDataTableColumn<T>, width: number): number {
    return Math.round(Math.max(this.minWidthOf(column), Math.min(MAX_WIDTH, width)));
  }

  private isRtl(element: HTMLElement): boolean {
    return getComputedStyle(element).direction === 'rtl';
  }

  protected onResizeKeydown(event: KeyboardEvent, column: SfDataTableColumn<T>, header: HTMLElement): void {
    const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP;
    const sign = this.isRtl(header) ? -1 : 1;
    const current = this.startWidth(column, header);
    let width: number;
    switch (event.key) {
      case 'ArrowRight':
        width = current + step * sign;
        break;
      case 'ArrowLeft':
        width = current - step * sign;
        break;
      case 'Home':
        width = this.minWidthOf(column);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.saveLayout({ widths: { [column.id]: this.clampWidth(column, width) } });
  }

  protected onResizeStart(event: PointerEvent, column: SfDataTableColumn<T>, header: HTMLElement): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.resize = { id: column.id, startX: event.clientX, startWidth: this.startWidth(column, header), rtl: this.isRtl(header) };
    this.dragWidth.set({ id: column.id, width: this.resize.startWidth });
  }

  protected onResizeMove(event: PointerEvent, column: SfDataTableColumn<T>): void {
    const resize = this.resize;
    if (!resize || resize.id !== column.id) {
      return;
    }
    const delta = (event.clientX - resize.startX) * (resize.rtl ? -1 : 1);
    this.dragWidth.set({ id: column.id, width: this.clampWidth(column, resize.startWidth + delta) });
  }

  protected onResizeEnd(column: SfDataTableColumn<T>): void {
    const drag = this.dragWidth();
    this.resize = null;
    this.dragWidth.set(null);
    if (drag?.id === column.id) {
      this.saveLayout({ widths: { [column.id]: drag.width } });
    }
  }
}
