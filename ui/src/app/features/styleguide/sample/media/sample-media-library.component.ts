import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
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
import { SfFilterPopoverComponent, SfFilterGroup } from '../../../../shared/components/filter/sf-filter-popover.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSkeletonComponent } from '../../../../shared/components/layout/sf-skeleton.component';
import { SfToolbarComponent } from '../../../../shared/components/layout/sf-toolbar.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { toContextItems } from '../../../../shared/components/menu/sf-menu-item';
import type { ContextMenuItem } from '../../../../shared/services/context-menu.service';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfFileSizePipe } from '../../../../shared/pipes/sf-file-size.pipe';
import { SampleBreadcrumbComponent } from '../sample-breadcrumb.component';
import { STATUS_ICONS, STATUS_TONES } from '../sample-state';
import { MEDIA_TYPE_FILTERS, SampleMediaFile, SampleMediaFolder, SampleMediaTypeFilter } from './sample-media-data';
import { SampleMediaGridComponent } from './sample-media-grid.component';
import { SampleMediaItemActions } from './sample-media-item-actions';
import { MEDIA_SORTS, SampleMediaState, SampleMediaView } from './sample-media-state';
import { SampleMediaUploadsComponent } from './sample-media-uploads.component';

const TYPE_ICONS: Readonly<Record<SampleMediaFile['kind'], string>> = { image: 'image', text: 'code', pdf: 'picture_as_pdf' };

const TYPE_FILTER_ICONS: Readonly<Record<string, string>> = { images: 'image', documents: 'picture_as_pdf', text: 'code' };

/** A folder of the open folder, as a row of the list (above the files). */
interface FolderRow {
  readonly folder: SampleMediaFolder;
  readonly id: string;
  readonly name: string;
}

/** A row of the list: one of the open folder's folders, or one of its files. */
type ListRow = FolderRow | SampleMediaFile;

const isFolderRow = (row: ListRow): row is FolderRow => 'folder' in row;

/**
 * The media library (M35.19 mocked): the folder's page header, a toolbar (search, type filter, sort, grid/list,
 * Upload), the grid or the list (the folder's folders first, then its files), the bulk bar on selection, the drop zone
 * over the whole library while files are dragged over it, and the upload panel docked bottom right. The list uses the
 * table's row menu and empty-space menu; its rows and the grid's cards have the same menus.
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
    SfFilterPopoverComponent,
    SfSegmentedComponent,
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
  protected readonly actions = inject(SampleMediaItemActions);
  protected readonly sample = this.state.sample;
  private readonly table = viewChild(SfDataTableComponent<ListRow>);
  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  protected readonly typeIcons = TYPE_ICONS;
  protected readonly dragging = signal(false);
  private dragDepth = 0;
  /** The folder the file picker was opened for (the toolbar's Upload: the open folder). */
  private pickFolder: string | null = null;
  /** Placeholder cards of the loading grid. */
  protected readonly skeletonCards = Array.from({ length: 8 }, (_, index) => index);
  private readonly now = Date.now();

  /** The folders first, then the files. */
  protected readonly rows = computed<ListRow[]>(() => [
    ...this.state.subfolders().map((folder) => ({ folder, id: folder.id, name: folder.name })),
    ...this.state.visible(),
  ]);
  protected readonly rowKey = (row: ListRow) => row.id;
  protected readonly rowLabel = (row: ListRow) => row.name;
  protected readonly fileOf = (row: ListRow): SampleMediaFile | null => (isFolderRow(row) ? null : row);
  protected readonly folderOf = (row: ListRow): FolderRow | null => (isFolderRow(row) ? row : null);

  /** One group: the types without 'all' (no tag picked is 'all'). */
  protected readonly filterGroups = computed<SfFilterGroup[]>(() => [
    {
      id: 'type',
      label: this.state.t('toolbar.type'),
      options: MEDIA_TYPE_FILTERS.filter((value) => value !== 'all').map((value) => ({
        value,
        label: this.state.t(`toolbar.types.${value}`),
        icon: TYPE_FILTER_ICONS[value],
      })),
    },
  ]);
  protected readonly pickedFilters = computed(() => {
    const type = this.state.typeFilter();
    return { type: type === 'all' ? [] : [type] };
  });

  /** Picking a tag selects it (replacing another); picking the picked one again returns to 'all'. */
  protected toggleType(value: string): void {
    this.state.typeFilter.set(value === this.state.typeFilter() ? 'all' : (value as SampleMediaTypeFilter));
  }

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
    { id: 'rename', label: this.state.t('library.rename'), icon: 'edit' },
    { id: 'move', label: this.state.t('library.move'), icon: 'drive_file_move' },
    { id: 'delete', label: this.state.t('library.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  protected readonly columns = computed<SfDataTableColumn<ListRow>[]>(() => {
    const header = (id: string) => this.state.t(`list.columns.${id}`);
    const area = (r: ListRow) => (isFolderRow(r) ? 0 : (r.width ?? 0) * (r.height ?? 0));
    return [
      { id: 'thumb', header: header('thumb'), hideable: false, searchable: false, width: 64 },
      { id: 'name', header: header('name'), value: (r) => r.name, sortable: true, hideable: false, width: 280 },
      { id: 'type', header: header('type'), value: (r) => (isFolderRow(r) ? this.state.t('kind') : r.format), sortable: true, width: 90 },
      {
        id: 'dimensions',
        header: header('dimensions'),
        value: (r) => (!isFolderRow(r) && r.width && r.height ? `${r.width} × ${r.height}` : ''),
        compare: (a, b) => area(a) - area(b),
        sortable: true,
        width: 130,
      },
      { id: 'size', header: header('size'), value: (r) => (isFolderRow(r) ? 0 : r.sizeBytes), sortable: true, align: 'end', width: 100 },
      { id: 'modified', header: header('modified'), value: (r) => (isFolderRow(r) ? 0 : r.modifiedMinutes), sortable: true, width: 140 },
      { id: 'usages', header: header('usages'), value: (r) => (isFolderRow(r) ? 0 : r.usages.length), sortable: true, align: 'end', width: 90 },
    ];
  });

  /** The selection's actions as the bulk bar's buttons (the table is told the selection before one is pressed). */
  protected readonly bulkActions = computed<SfDataTableBulkAction<ListRow>[]>(() => {
    this.state.selectionCount();
    return this.actions
      .selectionActions('bulk')
      .map<SfDataTableBulkAction<ListRow>>(({ id, label, icon, danger, action }) => ({ id, label, icon, variant: danger ? 'danger' : undefined, action }));
  });

  /** The selection's actions as the buttons of the grid's bulk bar. */
  protected readonly selectionActions = computed(() => {
    this.state.selectionCount();
    return this.actions.selectionActions('bulk');
  });

  /**
   * A right click on a row (or Shift+F10 / the menu key): the table opens this menu. The file and folder menus switch to the
   * selection's menu when the row is part of a selection of two or more.
   */
  protected readonly rowMenu = (rows: ListRow[]): ContextMenuItem[] => {
    const row = rows[0];
    return row ? toContextItems(isFolderRow(row) ? this.actions.folderMenu(row.folder) : this.actions.fileMenu(row)) : [];
  };
  /** A right click on empty space below the rows: the open folder's *Upload*, *New folder* and *Paste*. */
  protected readonly emptyMenu = (): ContextMenuItem[] => this.actions.emptyMenu();

  constructor() {
    // The list shows the shared selection when it appears (the grid's, or the scripted `selected=n`).
    effect(() => {
      const table = this.table();
      const keys = [...this.state.selection(), ...this.state.folderSelection()];
      if (table) {
        untracked(() => table.selectKeys(keys));
      }
    });
    // The menus' *Upload* entries open the file picker for their folder.
    inject(DestroyRef).onDestroy(
      this.state.registerPicker((folderId) => {
        this.pickFolder = folderId;
        this.chooseFiles();
      }),
    );
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected onTableSelection(selection: SfDataTableSelection<ListRow>): void {
    const folders = new Set(this.state.subfolders().map((f) => f.id));
    this.state.setSelection(
      selection.keys.filter((key) => !folders.has(key)),
      selection.keys.filter((key) => folders.has(key)),
    );
  }

  /** A folder row opens (the folder is entered), a file row opens its detail. */
  protected onRowOpen(row: ListRow): void {
    if (isFolderRow(row)) {
      void this.state.requestOpenFolder(row.id);
    } else {
      void this.state.requestOpenAsset(row.id);
    }
  }

  protected folderAction(item: SfMenuItem): void {
    if (item.id === 'rename') {
      void this.state.renameFolder();
    } else if (item.id === 'move') {
      void this.state.moveFolder();
    } else {
      this.state.notice('media.library.deleteNotice');
    }
  }

  protected newFolder(): void {
    this.actions.createFolderIn(this.state.review() === 'empty' ? null : this.state.folderId());
  }

  // ── List rows: keys ────────────────────────────────────────────────────────

  /** The file or folder of the list row a DOM node is in (the name cell carries its id). */
  private rowOf(node: EventTarget | null): ListRow | null {
    const row = node instanceof Element ? node.closest<HTMLElement>('tr.sf-data-table__row') : null;
    const marker = row?.querySelector('[data-file], [data-folder]');
    const id = marker?.getAttribute('data-file') ?? marker?.getAttribute('data-folder');
    return (id ? this.rows().find((r) => r.id === id) : undefined) ?? null;
  }

  /** F2 renames, Delete deletes (the selection when the row is in it); the menu keys are the table's. */
  protected onTableKeydown(event: KeyboardEvent): void {
    const hit = event.target instanceof HTMLElement && event.target.matches('tr.sf-data-table__row') ? this.rowOf(event.target) : null;
    if (!hit || !this.state.canEdit()) {
      return;
    }
    const rename = event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!rename && event.key !== 'Delete') {
      return;
    }
    event.preventDefault();
    if (isFolderRow(hit)) {
      void (rename ? this.state.renameFolder(hit.folder) : this.actions.deleteFromTile(hit.folder));
    } else {
      void (rename ? this.state.renameFile(hit) : this.actions.deleteFile(hit));
    }
  }

  protected chooseFiles(): void {
    this.picker().nativeElement.click();
  }

  protected onPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    const folderId = this.pickFolder ?? this.state.folderId();
    this.pickFolder = null;
    if (files.length) {
      this.state.upload(files, folderId);
    }
  }

  /** The toolbar's Upload and the empty states' buttons upload into the open folder. */
  protected uploadHere(): void {
    this.pickFolder = null;
    this.chooseFiles();
  }

  protected clearSelection(): void {
    this.state.clearSelection();
    this.table()?.clearSelection();
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
