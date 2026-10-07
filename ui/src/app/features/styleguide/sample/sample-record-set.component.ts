import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { bulkActionsAsMenu } from '../../../shared/components/data-table/data-table-menu';
import { SfDataTableBulkAction, SfDataTableColumn, SfDataTableSelection, SfDataTableSort } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import {
  CUSTOM_EXPRESSION,
  SET_USAGES,
  SampleDataset,
  SampleDatasetField,
  SampleQuery,
  SampleRecord,
  SampleSortKey,
  datasetById,
} from './sample-content-data';
import { SampleContentPanelComponent, SampleContentPanelTab } from './sample-content-panel.component';
import { SAMPLE_LANGS } from './sample-data';
import { SampleQueryPanelComponent } from './sample-query-panel.component';
import { isValidExpression, matchQuery, matchesExpression, queryFields, runQuery } from './sample-query';
import { STATUS_ICONS, STATUS_TONES, SampleState } from './sample-state';

/** A record field's value as the table and the editor show it (an option's label, a price in euros, a date, Yes or No). */
export function displayValue(record: SampleRecord, field: SampleDatasetField, lang: string, yesNo?: { yes: string; no: string }): string {
  const value = record.values[field.id];
  if (value === null || value === undefined || Array.isArray(value)) {
    return '';
  }
  if (field.type === 'boolean') {
    return value === 'true' ? (yesNo?.yes ?? 'true') : (yesNo?.no ?? 'false');
  }
  if (field.type === 'date' && typeof value === 'string') {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`));
  }
  if (field.type === 'money' && typeof value === 'number') {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(value);
  }
  if (field.options) {
    return field.options.find((o) => o.value === value)?.label ?? String(value);
  }
  return String(value);
}

/**
 * The record set view (M35.20 mocked): page header (breadcrumb, name, dataset, record count, New record, Release…, ⋮);
 * the query panel (collapsed summary; filter builder; developer mode adds the expression); and the records the query
 * selects in an `sf-data-table` — columns from the dataset, status per language, sorting, search, selection with bulk
 * Release, Move and Delete (confirm, then Undo). A row opens the record. Deleting and moving change the in-memory records only.
 *
 * Gate round 11: the table shows the records the **saved** filter selects (*Shown by the filter*) or **all records**
 * with the ones the filter leaves out dimmed and marked (`show=all`); the toolbar has **Use as set filter** (the table
 * expression filter, developer mode, and its header sort become the draft filter, unsaved); the menu has History,
 * Used by (a drawer), Rename and Move (the Content dialogs) and Delete; the bulk **Move** asks for another record set
 * of the same dataset and offers Undo.
 */
@Component({
  selector: 'sf-sample-record-set',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SampleQueryPanelComponent,
    SampleContentPanelComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSegmentedComponent,
    SfStatusComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-record-set.component.html',
  styleUrl: './sample-record-set.component.scss',
})
export class SampleRecordSetComponent {
  protected readonly state = inject(SampleState);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly table = viewChild.required<SfDataTableComponent<SampleRecord>>(SfDataTableComponent);
  private readonly panel = viewChild.required(SampleQueryPanelComponent);
  private readonly now = Date.now();

  protected readonly langs = SAMPLE_LANGS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;

  protected readonly set = this.state.recordSet;
  protected readonly dataset = computed<SampleDataset>(() => datasetById(this.set().dataset)!);
  /** The draft the filter panel edits, and the stored filter the table follows (they differ until Save filter). */
  protected readonly query = signal<SampleQuery>(this.state.recordSet().query!);
  protected readonly saved = signal<SampleQuery>(this.state.recordSet().query!);
  protected readonly expanded = signal(this.state.queryExpanded());
  protected readonly all = computed(() => this.state.recordsOf(this.set().id));
  /** What the draft filter selects, and what the set would show of it. */
  protected readonly matching = computed(() => matchQuery(this.all(), this.query(), this.dataset()).length);
  protected readonly shown = computed(() => runQuery(this.all(), this.query(), this.dataset()).length);

  /** Shown by the filter (the records the stored filter selects) or All records, the excluded ones marked. */
  protected readonly mode = signal<'rendered' | 'all'>(this.state.showAll() ? 'all' : 'rendered');
  protected readonly modeOptions = computed<SfSegmentedOption<'rendered' | 'all'>[]>(() => [
    { value: 'rendered', label: this.state.t('recordSet.mode.rendered') },
    { value: 'all', label: this.state.t('recordSet.mode.all') },
  ]);
  private readonly selectedIds = computed(() => new Set(runQuery(this.all(), this.saved(), this.dataset()).map((record) => record.id)));

  // The table's own expression filter (developer mode) and header sort: what Use as set filter hands to the panel.
  protected readonly whereDraft = signal('');
  protected readonly where = signal('');
  protected readonly whereInvalid = computed(() => this.whereDraft().trim() !== '' && !isValidExpression(this.whereDraft().trim(), this.dataset()));
  private readonly tableSort = signal<readonly SfDataTableSort[]>([]);
  protected readonly hasGridFilter = computed(() => this.where() !== '' || this.tableSort().length > 0);

  protected readonly baseRows = computed(() =>
    this.mode() === 'all'
      ? matchQuery(this.all(), { ...this.saved(), conditions: [], custom: null }, this.dataset())
      : runQuery(this.all(), this.saved(), this.dataset()),
  );
  protected readonly rows = computed(() => {
    const where = this.where();
    return where === '' ? this.baseRows() : this.baseRows().filter((record) => matchesExpression(record, where, this.dataset()));
  });
  protected readonly usages = computed(() => SET_USAGES[this.set().id] ?? []);
  protected readonly panelTab = signal<SampleContentPanelTab | null>(null);
  protected readonly rowKey = (row: SampleRecord) => row.id;
  protected readonly rowLabel = (row: SampleRecord) => this.state.recordName(row);

  protected readonly columns = computed<SfDataTableColumn<SampleRecord>[]>(() => {
    const lang = this.state.lang();
    const header = (id: string) => this.state.t(`recordSet.columns.${id}`);
    const yesNo = { yes: this.state.t('dataset.yes'), no: this.state.t('dataset.no') };
    const fields: SfDataTableColumn<SampleRecord>[] = queryFields(this.dataset()).map((field, i) => {
      const numeric = field.type === 'number' || field.type === 'money';
      return {
        id: field.id,
        header: field.label,
        value: (r) => displayValue(r, field, lang, yesNo),
        compare: numeric ? (a, b) => Number(a.values[field.id] ?? 0) - Number(b.values[field.id] ?? 0) : undefined,
        sortable: true,
        hideable: i > 0,
        align: numeric ? 'end' : 'start',
        width: i === 0 ? 230 : numeric ? 96 : 120,
      };
    });
    const columns: SfDataTableColumn<SampleRecord>[] = [
      ...fields,
      { id: 'status', header: header('status'), value: (r) => r.status.de, width: 128, searchable: false },
      { id: 'modified', header: header('modified'), value: (r) => r.modifiedMinutes, sortable: true, width: 150, searchable: false },
    ];
    if (this.state.devMode()) {
      columns.push({ id: 'uid', header: header('uid'), value: (r) => r.uid, width: 200 });
    }
    return columns;
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleRecord>[]>(() => [
    { id: 'release', label: this.state.t('folder.bulk.release'), icon: 'publish', action: (s) => void this.releaseRecords(s.rows) },
    { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: (s) => void this.moveRecords(s) },
    { id: 'duplicate', label: this.state.t('menus.duplicate'), icon: 'content_copy', action: (s) => this.duplicateRecords(s.rows) },
    { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
  ]);

  /**
   * A right click on a row: *Release*, *Move*, *Duplicate*, then *Delete* — the bulk actions, acting on the right-clicked
   * row or, when it is part of a multi-selection, on the selection.
   */
  protected readonly rowMenu = (rows: SampleRecord[]): ContextMenuItem[] => bulkActionsAsMenu(this.bulkActions(), rows, this.rowKey);

  /** A right click on empty space acts as one on the set: only *New record*. */
  protected readonly emptyMenu = (): ContextMenuItem[] => [
    { label: this.state.t('menus.newRecord'), icon: 'add', action: () => this.newRecord() },
  ];

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'history', label: this.state.t('recordSet.menu.history'), icon: 'history' },
    { id: 'usedBy', label: this.state.t('recordSet.menu.usedBy'), icon: 'link' },
    { id: 'rename', label: this.state.t('recordSet.menu.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'move', label: this.state.t('recordSet.menu.move'), icon: 'drive_file_move' },
    { id: 'delete', label: this.state.t('recordSet.menu.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  constructor() {
    // Another record set opened: its own query, the panel collapsed.
    let current = this.set().id;
    effect(
      () => {
        const set = this.set();
        if (set.id !== current) {
          current = set.id;
          untracked(() => {
            this.query.set(set.query!);
            this.saved.set(set.query!);
            this.expanded.set(false);
            this.mode.set('rendered');
            this.where.set('');
            this.whereDraft.set('');
            this.panelTab.set(null);
          });
        }
      },
      { allowSignalWrites: true },
    );
    // `filter=custom`: this set stores an expression the builder cannot show.
    if (this.state.queryPreset() === 'custom') {
      const custom = { ...this.query(), conditions: [], custom: CUSTOM_EXPRESSION };
      this.query.set(custom);
      this.saved.set(custom);
      this.expanded.set(true);
      this.state.queryPreset.set(null);
    }
    // The scripted `view=recordset` state: the fixed rows selected, so the bulk bar shows; a Content dialog or the
    // Used by drawer open on arrival (`dialog=...`, `panel=usedby`).
    afterNextRender(() => {
      const keys = this.state.preselect();
      if (keys.length > 0) {
        this.table().selectKeys(keys);
        this.state.preselect.set([]);
      }
      this.state.queryExpanded.set(false);
      const dialog = this.state.contentDialog();
      this.state.contentDialog.set(null);
      if (dialog === 'rename') {
        void this.state.renameContent(this.set());
      } else if (dialog === 'move') {
        void this.state.moveContent([this.set()]);
      } else if (dialog === 'bulkmove') {
        void this.state.moveRecordsToSet(this.set().id, keys.length > 0 ? keys : this.rows().slice(0, 2).map((r) => r.id));
      }
    });
    // `panel=usedby`, or the tree's Used by on a record set: the drawer opens (also when this set is already open).
    effect(
      () => {
        if (this.state.contentPanel() === 'usedby') {
          untracked(() => {
            this.panelTab.set('usages');
            this.state.contentPanel.set(null);
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected newRecord(): void {
    this.state.notice('recordSet.newRecordNotice');
  }

  protected async releaseSet(): Promise<void> {
    const name = this.set().name;
    if (await this.confirmRelease(this.rows(), this.state.t('folder.releaseTitle', { name }))) {
      this.toasts.show(this.state.t('folder.releaseDone', { name }), 'success');
    }
  }

  protected secondary(item: SfMenuItem): void {
    switch (item.id) {
      case 'history':
        this.state.closeDrawers();
        this.state.history.set('record');
        break;
      case 'usedBy':
        this.state.closeDrawers();
        this.panelTab.set('usages');
        break;
      case 'rename':
        void this.state.renameContent(this.set());
        break;
      case 'move':
        void this.state.moveContent([this.set()]);
        break;
      default:
        this.state.notice('recordSet.deleteSetNotice');
    }
  }

  protected setMode(mode: 'rendered' | 'all' | null): void {
    if (mode) {
      this.mode.set(mode);
    }
  }

  protected isExcluded(row: SampleRecord): boolean {
    return this.mode() === 'all' && !this.selectedIds().has(row.id);
  }

  protected applyWhere(): void {
    if (!this.whereInvalid()) {
      this.where.set(this.whereDraft().trim());
    }
  }

  protected clearWhere(): void {
    this.whereDraft.set('');
    this.where.set('');
  }

  /** The table's expression filter and header sort become the draft of the set's filter; nothing is saved. */
  protected useAsSetFilter(): void {
    const fields = new Set(queryFields(this.dataset()).map((field) => field.id));
    const sort = this.tableSort()
      .filter((key) => fields.has(key.id))
      .map((key): SampleSortKey => ({ field: key.id, direction: key.direction }));
    this.panel().adopt(this.where(), sort);
  }

  protected onSort(sort: readonly SfDataTableSort[]): void {
    this.tableSort.set(sort);
  }

  private async moveRecords(selection: SfDataTableSelection<SampleRecord>): Promise<void> {
    if (await this.state.moveRecordsToSet(this.set().id, selection.keys)) {
      this.table().clearSelection();
    }
  }

  /** *Release* with nothing pending is not disabled: it says so. */
  private async releaseRecords(rows: readonly SampleRecord[]): Promise<void> {
    if (!rows.some((row) => this.langs.some((lang) => row.status[lang] !== 'released'))) {
      this.state.notice('folder.bulk.nothingToRelease');
      return;
    }
    const params = { count: rows.length, name: this.state.recordName(rows[0] ?? null) };
    if (await this.confirmRelease(rows, this.state.t('recordSet.releaseTitle', params))) {
      this.toasts.show(this.state.t('recordSet.releaseDone', params), 'success');
    }
  }

  /** Announce only: the copies are not made; the Undo says so. */
  private duplicateRecords(rows: readonly SampleRecord[]): void {
    const params = { count: rows.length, name: this.state.recordName(rows[0] ?? null) };
    this.toasts.undo(this.state.t('menus.duplicated', params), () => this.state.notice('menus.duplicatedBack'));
  }

  private confirmRelease(rows: readonly SampleRecord[], title: string): Promise<boolean> {
    return this.confirms.confirm({
      title,
      message: this.state.t('recordSet.releaseMessage'),
      confirmLabel: this.state.t('folder.releaseConfirm'),
      details: rows.map((row) => this.state.recordName(row)),
    });
  }

  private async delete(selection: SfDataTableSelection<SampleRecord>): Promise<void> {
    const names = selection.rows.map((row) => this.state.recordName(row));
    const confirmed = await this.confirms.confirm({
      title: this.state.t('folder.deleteTitle', { count: names.length, name: names[0] }),
      message: this.state.t('recordSet.deleteMessage'),
      confirmLabel: this.state.t('folder.deleteConfirm', { count: names.length }),
      tone: 'danger',
      details: names,
    });
    if (!confirmed) {
      return;
    }
    this.table().clearSelection();
    const restore = this.state.removeRecords(this.set().id, selection.keys);
    this.toasts.undo(this.state.t('folder.deleted', { count: names.length, name: names[0] }), restore);
  }
}
