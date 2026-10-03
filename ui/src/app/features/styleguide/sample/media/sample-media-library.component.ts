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
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSkeletonComponent } from '../../../../shared/components/layout/sf-skeleton.component';
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
    SfBannerComponent,
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
    SfSkeletonComponent,
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
  /** A Shift+F10 press opened the menu already; the `contextmenu` event some browsers add must not open it twice. */
  private suppressContextMenu = false;
  /** Placeholder cards of the loading grid. */
  protected readonly skeletonCards = Array.from({ length: 8 }, (_, index) => index);
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

  protected readonly title = computed(() => (this.state.review() === 'empty' ? this.state.t('library.title') : this.state.folderName()));
  /** The count says nothing while the folder loads or fails to load. */
  protected readonly subtitle = computed(() =>
    this.state.review() === 'loading' || this.state.review() === 'error' ? '' : this.state.t('library.count', { count: this.state.folderCount() }),
  );
  protected readonly error = computed(() => (this.state.review() === 'error' ? this.state.t('library.error', { folder: this.state.folderName() }) : null));

  protected readonly folderActions = computed<SfMenuItem[]>(() => this.state.review() === 'empty' ? [] : [
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
      { id: 'actions', header: header('actions'), searchable: false, hideable: false, width: 64 },
    ];
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleMediaFile>[]>(() => [
    { id: 'move', label: this.state.t('bulk.move'), icon: 'drive_file_move', action: (s) => void this.state.moveFiles(s.rows) },
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
    if (item.id === 'rename') {
      this.state.folderRequest.set('rename');
    } else if (item.id === 'move') {
      void this.state.moveFolder();
    } else {
      this.state.notice('media.library.deleteNotice');
    }
  }

  protected newFolder(): void {
    this.state.folderRequest.set('create');
  }

  protected menuItems(file: SampleMediaFile): SfMenuItem[] {
    return this.state.fileMenu(file);
  }

  // ── List rows: context menu and keys ───────────────────────────────────────

  /** The file of the list row a DOM node is in (the name cell carries its id). */
  private rowFile(node: EventTarget | null): { file: SampleMediaFile; row: HTMLElement } | null {
    const row = node instanceof Element ? node.closest<HTMLElement>('tr.sf-data-table__row') : null;
    const id = row?.querySelector('[data-file]')?.getAttribute('data-file');
    const file = id ? this.state.files().find((f) => f.id === id) : undefined;
    return row && file ? { file, row } : null;
  }

  protected onTableContextMenu(event: MouseEvent): void {
    const hit = this.rowFile(event.target);
    if (!hit) {
      return;
    }
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      event.preventDefault();
      return;
    }
    this.state.openFileMenu(event, hit.file);
  }

  /** Shift+F10 / the menu key open the row's menu, F2 renames, Delete deletes (the selection when the row is in it). */
  protected onTableKeydown(event: KeyboardEvent): void {
    const hit = event.target instanceof HTMLElement && event.target.matches('tr.sf-data-table__row') ? this.rowFile(event.target) : null;
    if (!hit) {
      return;
    }
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      this.suppressContextMenu = true;
      setTimeout(() => (this.suppressContextMenu = false));
      this.state.openFileMenu(hit.row, hit.file);
    } else if (event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      void this.state.renameFile(hit.file);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void this.delete(this.state.menuTargets(hit.file));
    }
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
