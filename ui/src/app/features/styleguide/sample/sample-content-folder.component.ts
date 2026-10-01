import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableFilter,
  SfDataTableSelection,
} from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { DATASETS, SampleContentEntry, contentChildren, datasetById } from './sample-content-data';
import { SampleState } from './sample-state';

const DATASET_FILTER = 'dataset';

/**
 * The Content folder view (M35.20 mocked): page header with the folder's actions and a table of its folders and record
 * sets — dataset, record count, last change — with a dataset filter ("Dataset: Products" chips), multi-select and bulk
 * actions. Nothing is changed: Delete confirms and offers Undo.
 */
@Component({
  selector: 'sf-sample-content-folder',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SfAvatarComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-content-folder.component.html',
  styleUrl: './sample-folder-view.component.scss',
})
export class SampleContentFolderComponent {
  protected readonly state = inject(SampleState);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly table = viewChild.required<SfDataTableComponent<SampleContentEntry>>(SfDataTableComponent);
  private readonly now = Date.now();

  protected readonly title = computed(() => this.state.contentFolder()?.name ?? this.state.t('content.title'));
  protected readonly rows = computed(() => contentChildren(this.state.contentFolderId()));
  protected readonly rowKey = (row: SampleContentEntry) => row.id;
  protected readonly rowLabel = (row: SampleContentEntry) => row.name;

  protected readonly columns = computed<SfDataTableColumn<SampleContentEntry>[]>(() => {
    const header = (id: string) => this.state.t(`contentFolder.columns.${id}`);
    const records = this.state.records();
    return [
      { id: 'name', header: header('name'), value: (r) => r.name, sortable: true, hideable: false, width: 260 },
      { id: 'dataset', header: header('dataset'), value: (r) => datasetById(r.dataset)?.name ?? '', sortable: true, width: 160 },
      {
        id: 'records',
        header: header('records'),
        value: (r) => (r.kind === 'folder' ? -1 : (records.get(r.id)?.length ?? 0)),
        sortable: true,
        align: 'end',
        width: 110,
      },
      { id: 'modified', header: header('modified'), value: (r) => r.modifiedMinutes, sortable: true, width: 170 },
    ];
  });

  protected readonly filters = computed<SfDataTableFilter<SampleContentEntry>[]>(() => [
    {
      id: DATASET_FILTER,
      label: this.state.t('contentFolder.datasetFilter'),
      options: DATASETS.map((dataset) => ({ value: dataset.id, label: dataset.name })),
      match: (row, values) => !!row.dataset && values.includes(row.dataset),
    },
  ]);

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleContentEntry>[]>(() => [
    { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: () => this.state.notice() },
    { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
  ]);

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    { id: 'rename', label: this.state.t('folder.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'move', label: this.state.t('folder.move'), icon: 'drive_file_move' },
    { id: 'usedBy', label: this.state.t('content.usedBy'), icon: 'link' },
    { id: 'delete', label: this.state.t('folder.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  constructor() {
    // The scripted `view=contentfolder` state: one dataset filter applied, so its chip shows.
    afterNextRender(() => {
      const dataset = this.state.presetFilter();
      if (dataset) {
        this.table().toggleFilterValue(DATASET_FILTER, dataset);
        this.state.presetFilter.set(null);
      }
    });
  }

  protected datasetName(row: SampleContentEntry): string {
    return datasetById(row.dataset)?.name ?? '';
  }

  protected count(row: SampleContentEntry): number {
    return this.state.records().get(row.id)?.length ?? 0;
  }

  protected open(row: SampleContentEntry): void {
    if (row.kind === 'folder') {
      this.state.openContentFolder(row.id);
    } else {
      this.state.openRecordSet(row.id);
    }
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected secondary(item: SfMenuItem): void {
    if (item.id === 'delete') {
      void this.deleteEntries([this.title()]);
    } else {
      this.state.notice();
    }
  }

  private delete(selection: SfDataTableSelection<SampleContentEntry>): Promise<void> {
    return this.deleteEntries(
      selection.rows.map((row) => row.name),
      () => this.table().clearSelection(),
    );
  }

  private async deleteEntries(names: readonly string[], done?: () => void): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.state.t('folder.deleteTitle', { count: names.length, name: names[0] }),
      message: this.state.t('folder.deleteMessage'),
      confirmLabel: this.state.t('folder.deleteConfirm', { count: names.length }),
      tone: 'danger',
      details: names,
    });
    if (!confirmed) {
      return;
    }
    done?.();
    this.toasts.undo(this.state.t('folder.deleted', { count: names.length, name: names[0] }), () =>
      this.toasts.show(this.state.t('folder.restored'), 'info'),
    );
  }
}
