import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { type Subscription, firstValueFrom } from 'rxjs';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { bulkActionsAsMenu } from '../../shared/components/data-table/data-table-menu';
import type {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableQuery,
  SfDataTableSelection,
} from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfFindingComponent } from '../../shared/components/forms/sf-finding.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, type SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../shared/directives/sf-tooltip.directive';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import type { ContentDefinition } from '../forms/form.model';
import { releaseTone } from '../pages/folder-view.util';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { type ReleaseChoice, choicesFor } from '../release/release-choice.util';
import { localeStatuses, localeTag, statusLabel } from '../release/release-status.util';
import type { MoveTarget } from './content-tree.util';
import { ContentService, type DatasetDetailView, type RecordRowView, type RecordSort } from './content.service';
import { MoveTargetDialogComponent } from './move-target-dialog.component';
import { type BulkRecord, RecordSetActions } from './record-set-actions.service';
import { deriveColumns, formatCell, sanitizeSort, toRecordSort, type RecordColumn } from './record-grid.util';

/** The problem body of a rejected `where`/`sort` (`400`, with `column` for a syntax error). */
interface QueryProblem {
  detail?: string;
  column?: number;
}

/**
 * `rendered`: only what the set shows, in its order (the default); `all`: every record of the set, those the set query
 * leaves out marked.
 */
export type RecordGridMode = 'all' | 'rendered';

/** The grid's own filter and sort, handed to the set query panel ("Use as set filter"). */
export interface GridFilter {
  where: string;
  sort: RecordSort[];
}

/** The page size of "select all N matching" reads: the server's largest. */
const FETCH_ALL_SIZE = 500;

/** Column ids that are not dataset fields start with an underscore, so a dataset field can never share one. */
const NAME_COLUMN = '_displayName';
const STATUS_COLUMN = '_status';
const CHANGED_COLUMN = '_changedAt';
const UID_COLUMN = '_uid';

/**
 * The records of one record set as a table (M19.4.2, scoped to a set in M25.5.1, on `sf-data-table` since M35.20), paged,
 * sorted and searched on the server so a set of any size never loads more than one page of rows.
 *
 * <p>Two views of the set: **Shown by the filter** (the default) applies the stored set query first, so rows appear in
 * render order and excluded records are hidden; **All records** lists every record and marks the ones the stored set
 * query leaves out — each row's `selectedBySet` flag, which the server computes over the whole set. With `revision`
 * (time travel) the server lists the set as of that revision: its records, their values and its stored query then. The
 * quick search, the expression box and the header sort only narrow what the grid shows: they never change the set query.
 * "Use as set filter" hands them to the query panel as an unsaved draft.
 *
 * <p>Columns come from the dataset schema's scalar editors (the table remembers the viewer's choice of columns); the
 * header sorts by a column, Shift adds a further key. Developer mode adds an expression box over field names
 * ({@code role == 'lead'}), evaluated by the server, which reports where an invalid one goes wrong.
 *
 * <p>Rows are selectable: **Release…**, **Move…** (into another set of the dataset), **Duplicate** (unreleased copies in the
 * same set; Undo deletes them) and **Delete** (the word `delete` from
 * 25 records on; one Undo for the group) work on the selection, and "select all N matching" reaches records on other
 * pages. A right click on a row offers the same actions for that row or the selection. Opening a row emits `open`.
 */
@Component({
  selector: 'sf-record-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MoveTargetDialogComponent,
    ReleaseDialogComponent,
    SfAssetFavoriteComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfFindingComponent,
    SfIconComponent,
    SfInputComponent,
    SfRelativeTimeComponent,
    SfSegmentedComponent,
    SfStatusComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  templateUrl: './record-grid.component.html',
  styleUrl: './record-grid.component.scss',
})
export class RecordGridComponent {
  readonly projectKey = input.required<string>();
  /** The set's dataset: its schema gives the columns. */
  readonly dataset = input.required<DatasetDetailView>();
  readonly recordSetUuid = input.required<string>();
  /** Whether the stored set query validates; while it doesn't, the set shows nothing. */
  readonly queryValid = input<boolean>(true);
  /** Time travel: list the set as of this revision (`null`: current). */
  readonly revision = input<number | null>(null);
  /** Whether "Use as set filter" is offered (an editor, not time travelling). */
  readonly canEditQuery = input<boolean>(false);
  /** No selection, no bulk actions (time travel, a viewer). */
  readonly readOnly = input<boolean>(false);
  readonly pageSize = input<number>(50);
  /** Bumped by the parent after a record or the set query changed elsewhere, to reload the current page. */
  readonly refreshKey = input<number>(0);
  /** Which records are listed; the set view keeps it in the URL. */
  readonly mode = input<RecordGridMode>('rendered');

  readonly open = output<string>();
  readonly total = output<number>();
  readonly useAsSetQuery = output<GridFilter>();
  readonly modeChange = output<RecordGridMode>();
  /** A bulk action changed records (deleted, moved): the set's count and the tree are stale. */
  readonly changed = output<void>();
  /** The empty-space menu's *New record*: the set view creates it (a record always goes into a set). */
  readonly newRecord = output<void>();

  private readonly content = inject(ContentService);
  private readonly actions = inject(RecordSetActions);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly locales = inject(LocalesStore);
  private readonly editingLocale = inject(EditingLocaleStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  protected readonly developerMode = inject(DeveloperModeService).enabled;
  private readonly table = viewChild.required<SfDataTableComponent<RecordRowView>>(SfDataTableComponent);

  protected readonly rows = signal<RecordRowView[]>([]);
  protected readonly totalElements = signal(0);
  /** The table's query (search, sort, page): `null` until it has reported its first. */
  private readonly query = signal<SfDataTableQuery | null>(null);
  protected readonly whereDraft = signal('');
  protected readonly where = signal('');
  protected readonly whereError = signal<QueryProblem | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly releaseChoices = signal<ReleaseChoice[] | null>(null);
  protected readonly moveDialog = signal<{ records: BulkRecord[]; targets: MoveTarget[] } | null>(null);
  protected readonly moving = signal(false);

  /** Every record seen in a loaded page, so a selection that spans pages still has names to show. */
  private seen = new Map<string, RecordRowView>();
  private request: Subscription | null = null;

  private readonly columns = computed<RecordColumn[]>(() =>
    deriveColumns(this.dataset().compiledDefinition as unknown as ContentDefinition, this.dataset().titleEditor),
  );

  protected readonly tableColumns = computed<SfDataTableColumn<RecordRowView>[]>(() => {
    const t = (id: string) => this.transloco.translate(`content.recordSet.grid.columns.${id}`);
    const labels = { yes: this.transloco.translate('content.recordSet.grid.yes'), no: this.transloco.translate('content.recordSet.grid.no') };
    const fields = this.columns().map<SfDataTableColumn<RecordRowView>>((column) => {
      const numeric = column.type === 'NUMBER';
      return {
        id: column.field,
        header: column.label,
        value: (row) => formatCell((row.values as Record<string, unknown> | undefined)?.[column.field], column, labels),
        sortable: true,
        hidden: !column.defaultVisible,
        align: numeric ? 'end' : 'start',
        width: numeric ? 110 : 150,
      };
    });
    const columns: SfDataTableColumn<RecordRowView>[] = [
      { id: NAME_COLUMN, header: t('name'), value: (row) => row.displayName ?? '', sortable: true, hideable: false, width: 260 },
      ...fields,
      { id: STATUS_COLUMN, header: t('status'), value: (row) => localeStatuses(row.release).map((e) => e.status).join(), width: 160, searchable: false },
      { id: CHANGED_COLUMN, header: t('modified'), value: (row) => row.changedAt ?? '', sortable: true, width: 150, searchable: false },
    ];
    // The uid is a developer's detail.
    if (this.developerMode()) {
      columns.push({ id: UID_COLUMN, header: t('uid'), value: (row) => row.uid ?? '', sortable: true, width: 200, searchable: false });
    }
    return columns;
  });

  protected readonly modeOptions = computed<SfSegmentedOption<RecordGridMode>[]>(() => [
    { value: 'rendered', label: this.transloco.translate('content.recordSet.grid.mode.rendered') },
    { value: 'all', label: this.transloco.translate('content.recordSet.grid.mode.all') },
  ]);

  /** A right click on empty space acts as one on the set: only *New record*. */
  protected readonly emptyMenu = (): ContextMenuItem[] =>
    this.readOnly() ? [] : [{ label: this.transloco.translate('content.recordSet.newRecord'), icon: 'add', action: () => this.newRecord.emit() }];

  protected readonly bulkActions = computed<SfDataTableBulkAction<RecordRowView>[]>(() => {
    if (this.readOnly()) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`content.recordSet.bulk.${id}`);
    const actions: SfDataTableBulkAction<RecordRowView>[] = [];
    if (this.permissions.canRelease()) {
      actions.push({ id: 'release', label: t('release'), icon: 'publish', action: (s) => void this.releaseSelection(s) });
    }
    actions.push(
      { id: 'move', label: t('move'), icon: 'drive_file_move', action: (s) => void this.moveSelection(s) },
      { id: 'duplicate', label: t('duplicate'), icon: 'content_copy', action: (s) => void this.duplicateSelection(s) },
      { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: (s) => void this.deleteSelection(s) },
    );
    return actions;
  });

  /**
   * A right click on a row: Release…, Move…, Duplicate, then Delete — the bulk actions, acting on the right-clicked row or,
   * when it is part of a multi-selection, on the selection.
   */
  protected readonly rowMenu = (rows: RecordRowView[]): ContextMenuItem[] =>
    bulkActionsAsMenu(this.bulkActions(), rows, this.rowKey);

  /** Something to hand to the set query: an applied filter or a header sort. */
  protected readonly hasGridFilter = computed(() => this.where() !== '' || (this.query()?.sort.length ?? 0) > 0);

  protected readonly tableError = computed(() =>
    this.loadFailed() ? this.transloco.translate('content.recordSet.grid.loadFailed') : null,
  );

  protected readonly emptyTitle = computed(() =>
    this.transloco.translate(
      this.mode() === 'rendered' && !this.queryValid() ? 'content.recordSet.grid.emptyInvalid' : 'content.recordSet.grid.empty',
    ),
  );

  protected readonly rowKey = (row: RecordRowView): string => row.uuid ?? '';
  protected readonly rowLabel = (row: RecordRowView): string => row.displayName ?? row.uid ?? '';

  constructor() {
    // Another set or another revision: the rows seen so far belong to something else.
    effect(() => {
      this.recordSetUuid();
      this.revision();
      untracked(() => (this.seen = new Map()));
    });

    effect(
      () => {
        this.projectKey();
        this.recordSetUuid();
        this.revision();
        this.mode();
        this.queryValid();
        this.where();
        this.refreshKey();
        // Release actions change the rows' statuses (M27.6.1).
        this.releaseEvents.version();
        const query = this.query();
        if (query) {
          untracked(() => this.reload(query, query.page));
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected onQuery(query: SfDataTableQuery): void {
    this.query.set(query);
  }

  protected setMode(mode: RecordGridMode | null): void {
    if (mode && mode !== this.mode()) {
      this.modeChange.emit(mode);
    }
  }

  // ── The expression filter (developer mode) ────────────────────────────────

  protected onWhereInput(value: string): void {
    this.whereDraft.set(value);
  }

  protected applyWhere(): void {
    this.where.set(this.whereDraft().trim());
  }

  protected clearWhere(): void {
    this.whereDraft.set('');
    this.where.set('');
  }

  protected useFilterAsSetQuery(): void {
    this.useAsSetQuery.emit({ where: this.where(), sort: this.sortOf(this.query()) });
  }

  /** A caret under the applied filter pointing at the 1-based column the server reported. */
  protected caretLine(column: number): string {
    return ' '.repeat(Math.max(0, column - 1)) + '^';
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  protected openRow(row: RecordRowView): void {
    if (row.uuid) {
      this.open.emit(row.uuid);
    }
  }

  protected isExcluded(row: RecordRowView): boolean {
    return this.mode() === 'all' && row.selectedBySet === false;
  }

  protected excludedTooltip(): string {
    return this.transloco.translate(
      this.queryValid() ? 'content.recordSet.grid.excluded' : 'content.recordSet.grid.excludedInvalid',
    );
  }

  protected statuses(row: RecordRowView) {
    return localeStatuses(row.release).map((entry) => ({
      key: entry.key,
      tag: localeTag(entry.key),
      label: statusLabel(entry.status),
      tone: releaseTone(entry.status),
    }));
  }

  protected retry(): void {
    const query = this.query();
    if (query) {
      this.reload(query, query.page);
    }
  }

  private sortOf(query: SfDataTableQuery | null): RecordSort[] {
    return sanitizeSort(toRecordSort(query?.sort ?? []), this.columns());
  }

  private params(query: SfDataTableQuery, page: number, size: number) {
    return {
      page,
      size,
      sort: this.sortOf(query),
      q: query.search,
      where: this.where(),
      applySetQuery: this.mode() === 'rendered',
      revision: this.revision(),
    };
  }

  private reload(query: SfDataTableQuery, page: number): void {
    const key = this.projectKey();
    const uuid = this.recordSetUuid();
    if (!key || !uuid) {
      return;
    }
    this.request?.unsubscribe();
    this.loading.set(true);
    this.request = this.content.listSetRecords(key, uuid, this.params(query, page, this.pageSize())).subscribe({
      next: (result) => {
        const rows = result.content ?? [];
        const total = result.page?.totalElements ?? 0;
        if (rows.length === 0 && total > 0 && page > 0) {
          // Records went away under the page the table is on (a bulk delete, a search): read the last page that exists.
          this.reload(query, Math.max(0, Math.ceil(total / this.pageSize()) - 1));
          return;
        }
        this.loading.set(false);
        this.loadFailed.set(false);
        this.whereError.set(null);
        for (const row of rows) {
          if (row.uuid) {
            this.seen.set(row.uuid, row);
          }
        }
        this.rows.set(rows);
        this.totalElements.set(total);
        this.total.emit(total);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.rows.set([]);
        this.totalElements.set(0);
        if (err instanceof HttpErrorResponse && err.status === 400) {
          const body = (err.error ?? {}) as QueryProblem;
          this.loadFailed.set(false);
          this.whereError.set({ detail: body.detail ?? this.transloco.translate('content.recordSet.grid.filterInvalid'), column: body.column });
        } else {
          this.whereError.set(null);
          this.loadFailed.set(true);
        }
      },
    });
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────

  /**
   * The records a selection stands for: the ones seen in a loaded page, or — with "select all N matching" — every record
   * of the current query, read page by page.
   */
  private async recordsOf(selection: SfDataTableSelection<RecordRowView>): Promise<RecordRowView[]> {
    const query = this.query();
    if (!selection.allMatching || !query) {
      return selection.keys.map((key) => this.seen.get(key)).filter((row): row is RecordRowView => !!row);
    }
    const all: RecordRowView[] = [];
    for (let page = 0; ; page++) {
      const result = await firstValueFrom(
        this.content.listSetRecords(this.projectKey(), this.recordSetUuid(), this.params(query, page, FETCH_ALL_SIZE)),
      );
      all.push(...(result.content ?? []));
      if (all.length >= (result.page?.totalElements ?? 0) || (result.content ?? []).length === 0) {
        return all;
      }
    }
  }

  private async resolve(selection: SfDataTableSelection<RecordRowView>): Promise<RecordRowView[]> {
    try {
      return await this.recordsOf(selection);
    } catch {
      this.toasts.show(this.transloco.translate('content.recordSet.bulk.readFailed'), 'error');
      return [];
    }
  }

  private bulkRecord(row: RecordRowView): BulkRecord {
    return { uuid: row.uuid ?? '', name: row.displayName ?? row.uid ?? '', release: row.release };
  }

  private async releaseSelection(selection: SfDataTableSelection<RecordRowView>): Promise<void> {
    const rows = await this.resolve(selection);
    const labelOf = (code: string) => this.locales.labelOf(code);
    const locale = this.editingLocale.locale();
    const choices = rows.flatMap((row) =>
      choicesFor(
        { uuid: row.uuid ?? '', type: 'RECORD', uid: row.uid, displayName: row.displayName, folderPath: row.folderPath, release: row.release },
        'release',
        locale,
        labelOf,
      ).map((choice) => ({ ...choice, label: `${row.displayName ?? row.uid} · ${choice.label}`, checked: true })),
    );
    if (choices.length === 0) {
      this.toasts.show(this.transloco.translate('content.recordSet.bulk.nothingToRelease'), 'info');
      return;
    }
    this.releaseChoices.set(choices);
  }

  protected releaseDone(): void {
    this.releaseChoices.set(null);
    this.table().clearSelection();
  }

  private async moveSelection(selection: SfDataTableSelection<RecordRowView>): Promise<void> {
    const records = (await this.resolve(selection)).map((row) => this.bulkRecord(row));
    const datasetUuid = this.dataset().uuid;
    if (records.length === 0 || !datasetUuid) {
      return;
    }
    try {
      const targets = await firstValueFrom(this.actions.moveTargets(this.projectKey(), datasetUuid, this.recordSetUuid()));
      this.moveDialog.set({ records, targets });
    } catch {
      this.toasts.show(this.transloco.translate('content.recordSet.bulk.targetsFailed'), 'error');
    }
  }

  protected closeMove(): void {
    this.moveDialog.set(null);
  }

  protected async onMoveChosen(uuid: string | null): Promise<void> {
    const dialog = this.moveDialog();
    const target = dialog?.targets.find((t) => t.uuid === uuid);
    if (!dialog || !target) {
      return;
    }
    this.moving.set(true);
    const moved = await this.actions.moveRecords(this.projectKey(), dialog.records, this.recordSetUuid(), target, () => this.afterChange());
    this.moving.set(false);
    this.moveDialog.set(null);
    if (moved) {
      this.afterChange();
    }
  }

  private async duplicateSelection(selection: SfDataTableSelection<RecordRowView>): Promise<void> {
    const records = (await this.resolve(selection)).map((row) => this.bulkRecord(row));
    if (await this.actions.duplicateRecords(this.projectKey(), records, () => this.afterChange())) {
      this.afterChange();
    }
  }

  private async deleteSelection(selection: SfDataTableSelection<RecordRowView>): Promise<void> {
    const records = (await this.resolve(selection)).map((row) => this.bulkRecord(row));
    if (await this.actions.deleteRecords(this.projectKey(), records, () => this.afterChange())) {
      this.afterChange();
    }
  }

  /** A bulk action (or its Undo) changed records: reload, drop the selection, and let the set view refresh its count. */
  private afterChange(): void {
    this.table().clearSelection();
    const query = this.query();
    if (query) {
      this.reload(query, query.page);
    }
    this.changed.emit();
  }
}
