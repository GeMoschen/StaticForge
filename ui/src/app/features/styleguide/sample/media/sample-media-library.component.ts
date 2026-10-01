import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableSelection,
} from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfToolbarComponent } from '../../../../shared/components/layout/sf-toolbar.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { SampleBreadcrumbComponent } from '../sample-breadcrumb.component';
import { STATUS_ICONS, STATUS_TONES } from '../sample-state';
import { MEDIA_TYPE_FILTERS, SampleMediaFile, SampleMediaTypeFilter } from './sample-media-data';
import { SampleMediaGridComponent } from './sample-media-grid.component';
import { MEDIA_SORTS, SampleMediaState, SampleMediaView } from './sample-media-state';
import { SampleMediaUploadsComponent } from './sample-media-uploads.component';

const TYPE_ICONS: Readonly<Record<SampleMediaFile['kind'], string>> = { image: 'image', text: 'code', pdf: 'picture_as_pdf' };

/**
 * The media library (M35.19 mocked): the folder's page header, a toolbar (search, type filter, sort, grid/list,
 * Upload), the grid or the list, the bulk bar on selection, the drop zone over the whole library while files are
 * dragged over it, and the upload panel docked bottom right.
 */
@Component({
  selector: 'sf-sample-media-library',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SampleMediaGridComponent,
    SampleMediaUploadsComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfEmptyStateComponent,
    SfFileSizePipe,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfStatusComponent,
    SfToolbarComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-library.component.html',
  styleUrl: './sample-media-library.component.scss',
})
export class SampleMediaLibraryComponent {
  protected readonly state = inject(SampleMediaState);
  protected readonly sample = this.state.sample;
  private readonly table = viewChild(SfDataTableComponent<SampleMediaFile>);
  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  protected readonly typeIcons = TYPE_ICONS;
  protected readonly dragging = signal(false);
  private dragDepth = 0;
  private readonly now = Date.now();

  protected readonly rowKey = (file: SampleMediaFile) => file.id;
  protected readonly rowLabel = (file: SampleMediaFile) => file.name;

  protected readonly typeOptions = computed<SfSelectOption<SampleMediaTypeFilter>[]>(() =>
    MEDIA_TYPE_FILTERS.map((value) => ({ value, label: this.state.t(`toolbar.types.${value}`) })),
  );

  protected readonly viewOptions = computed<SfSegmentedOption<SampleMediaView>[]>(() => [
    { value: 'grid', label: this.state.t('toolbar.grid'), icon: 'grid_view', iconOnly: true },
    { value: 'list', label: this.state.t('toolbar.list'), icon: 'view_list', iconOnly: true },
  ]);

  /** "Sort: Name ↑" — the menu button's text (and name). */
  protected readonly sortText = computed(() =>
    this.state.t('toolbar.sortButton', { field: this.state.t(`toolbar.sortBy.${this.state.sort()}`), direction: this.state.direction() }),
  );
  protected readonly sortItems = computed<SfMenuItem[]>(() => {
    const sort = this.state.sort();
    const direction = this.state.direction();
    const sortGroup = this.state.t('toolbar.sortGroup');
    const orderGroup = this.state.t('toolbar.orderGroup');
    return [
      ...MEDIA_SORTS.map<SfMenuItem>((id) => ({
        id,
        label: this.state.t(`toolbar.sortBy.${id}`),
        icon: id === sort ? 'check' : undefined,
        group: sortGroup,
        action: () => this.state.sort.set(id),
      })),
      ...(['asc', 'desc'] as const).map<SfMenuItem>((id) => ({
        id,
        label: this.state.t(id === 'asc' ? 'toolbar.ascending' : 'toolbar.descending'),
        icon: id === direction ? 'check' : undefined,
        group: orderGroup,
        action: () => this.state.direction.set(id),
      })),
    ];
  });

  protected readonly subtitle = computed(() => this.state.t('library.count', { count: this.state.folderCount() }));

  protected readonly folderActions = computed<SfMenuItem[]>(() => [
    { id: 'rename', label: this.state.t('library.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'move', label: this.state.t('library.move'), icon: 'drive_file_move' },
    { id: 'delete', label: this.state.t('library.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  protected readonly columns = computed<SfDataTableColumn<SampleMediaFile>[]>(() => {
    const header = (id: string) => this.state.t(`list.columns.${id}`);
    return [
      { id: 'thumb', header: header('thumb'), hideable: false, searchable: false, width: 64 },
      { id: 'name', header: header('name'), value: (f) => f.name, sortable: true, hideable: false, width: 280 },
      { id: 'type', header: header('type'), value: (f) => f.format, sortable: true, width: 90 },
      {
        id: 'dimensions',
        header: header('dimensions'),
        value: (f) => (f.width && f.height ? `${f.width} × ${f.height}` : ''),
        compare: (a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
        sortable: true,
        width: 130,
      },
      { id: 'size', header: header('size'), value: (f) => f.sizeBytes, sortable: true, align: 'end', width: 100 },
      { id: 'modified', header: header('modified'), value: (f) => f.modifiedMinutes, sortable: true, width: 140 },
      { id: 'usages', header: header('usages'), value: (f) => f.usages.length, sortable: true, align: 'end', width: 90 },
    ];
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleMediaFile>[]>(() => [
    { id: 'move', label: this.state.t('bulk.move'), icon: 'drive_file_move', action: () => this.state.notice() },
    { id: 'download', label: this.state.t('bulk.download'), icon: 'download', action: (s) => this.state.download(s.rows) },
    { id: 'delete', label: this.state.t('bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s.rows) },
  ]);

  constructor() {
    // The list shows the shared selection when it appears (the grid's, or the scripted `selected=n`).
    effect(() => {
      const table = this.table();
      if (table) {
        untracked(() => table.selectKeys(this.state.selection()));
      }
    });
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected onTableSelection(selection: SfDataTableSelection<SampleMediaFile>): void {
    this.state.selection.set(selection.keys);
  }

  protected folderAction(item: SfMenuItem): void {
    this.state.notice(item.id === 'delete' ? 'media.library.deleteNotice' : 'prototypeNotice');
  }

  protected chooseFiles(): void {
    this.picker().nativeElement.click();
  }

  protected onPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) {
      this.state.upload(files);
    }
  }

  protected clearSelection(): void {
    this.state.selection.set([]);
    this.table()?.clearSelection();
  }

  protected async delete(files: readonly SampleMediaFile[]): Promise<void> {
    if (await this.state.confirmDelete(files)) {
      this.table()?.clearSelection();
    }
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────

  protected onDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDragLeave(event: DragEvent): void {
    if (!hasFiles(event)) {
      return;
    }
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.dragging.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) {
      this.state.upload(files);
    }
  }
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
