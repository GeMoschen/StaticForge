import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDataTableBulkAction, SfDataTableColumn, SfDataTableSelection } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { SampleDataset, SampleDatasetField, SampleQuery, SampleRecord, datasetById } from './sample-content-data';
import { SAMPLE_LANGS } from './sample-data';
import { SampleQueryPanelComponent } from './sample-query-panel.component';
import { queryFields, runQuery } from './sample-query';
import { STATUS_ICONS, STATUS_TONES, SampleState } from './sample-state';

/** A record field's value as the table and the editor show it (an option's label, a price in euros). */
export function displayValue(record: SampleRecord, field: SampleDatasetField, lang: string): string {
  const value = record.values[field.id];
  if (value === null || value === undefined || Array.isArray(value)) {
    return '';
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
 * Release, Move and Delete (confirm, then Undo). A row opens the record. Deleting changes the in-memory records only.
 */
@Component({
  selector: 'sf-sample-record-set',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SampleQueryPanelComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
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
  private readonly now = Date.now();

  protected readonly langs = SAMPLE_LANGS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;

  protected readonly set = this.state.recordSet;
  protected readonly dataset = computed<SampleDataset>(() => datasetById(this.set().dataset)!);
  protected readonly query = signal<SampleQuery>(this.state.recordSet().query!);
  protected readonly expanded = signal(this.state.queryExpanded());
  protected readonly all = computed(() => this.state.recordsOf(this.set().id));
  protected readonly rows = computed(() => runQuery(this.all(), this.query(), this.dataset()));
  protected readonly rowKey = (row: SampleRecord) => row.id;
  protected readonly rowLabel = (row: SampleRecord) => this.state.recordName(row);

  protected readonly columns = computed<SfDataTableColumn<SampleRecord>[]>(() => {
    const lang = this.state.lang();
    const header = (id: string) => this.state.t(`recordSet.columns.${id}`);
    const fields: SfDataTableColumn<SampleRecord>[] = queryFields(this.dataset()).map((field, i) => {
      const numeric = field.type === 'number' || field.type === 'money';
      return {
        id: field.id,
        header: field.label,
        value: (r) => displayValue(r, field, lang),
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
    { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: () => this.state.notice() },
    { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
  ]);

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'rename', label: this.state.t('folder.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'move', label: this.state.t('folder.move'), icon: 'drive_file_move' },
    { id: 'duplicate', label: this.state.t('editor.duplicate'), icon: 'content_copy' },
    { id: 'usedBy', label: this.state.t('content.usedBy'), icon: 'link' },
    { id: 'delete', label: this.state.t('folder.delete'), icon: 'delete', danger: true, separatorBefore: true },
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
            this.expanded.set(false);
          });
        }
      },
      { allowSignalWrites: true },
    );
    // The scripted `view=recordset` state: the fixed rows selected, so the bulk bar shows.
    afterNextRender(() => {
      const keys = this.state.preselect();
      if (keys.length > 0) {
        this.table().selectKeys(keys);
        this.state.preselect.set([]);
      }
      this.state.queryExpanded.set(false);
    });
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
    this.state.notice(item.id === 'delete' ? 'recordSet.deleteSetNotice' : 'prototypeNotice');
  }

  private async releaseRecords(rows: readonly SampleRecord[]): Promise<void> {
    const params = { count: rows.length, name: this.state.recordName(rows[0] ?? null) };
    if (await this.confirmRelease(rows, this.state.t('recordSet.releaseTitle', params))) {
      this.toasts.show(this.state.t('recordSet.releaseDone', params), 'success');
    }
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
