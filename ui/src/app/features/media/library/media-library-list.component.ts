import { ChangeDetectionStrategy, Component, booleanAttribute, computed, effect, inject, input, untracked, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toContextItems } from '../../../shared/components/menu/sf-menu-item';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import type { SfDataTableBulkAction, SfDataTableColumn } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfAssetFavoriteComponent } from '../../../shared/components/sf-asset-favorite.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { MediaFolderActions } from './media-folder-actions';
import { MediaItemActions } from './media-item-actions';
import { MediaSelectionActions } from './media-selection.actions';
import { MediaLibraryStore, type FolderView, type MediaSummaryView } from './media-library.store';
import { changedTime, formatOf } from './media-library.util';
import { MediaPreviewComponent } from './media-preview.component';

/** A folder of the open folder, as a row of the list (above the files). */
export interface MediaFolderRow {
  readonly folder: FolderView;
  readonly uuid: string;
  readonly name: string;
}

/** A row of the list: one of the open folder's folders, or one of its files. */
export type MediaListRow = MediaFolderRow | MediaSummaryView;

const isFolderRow = (row: MediaListRow): row is MediaFolderRow => 'folder' in row;
const area = (row: MediaListRow): number => (isFolderRow(row) ? 0 : (row.width ?? 0) * (row.height ?? 0));

/**
 * The library's list view (decisions 19 and 22): an `sf-data-table` of the folder's folders (first, with a folder icon; a click
 * opens one) and files — preview, name (with the status
 * icon of an unreleased file), type, dimensions, size, when it was modified and how many places use it. The rows come
 * sorted by the toolbar; a column header sorts them on its own. The selection is the library's (shared with the grid);
 * opening a row opens the detail drawer, whose file is highlighted in the table. Column widths and visibility are kept
 * per user (`tableId`).
 */
@Component({
  selector: 'sf-media-library-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MediaPreviewComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfAssetFavoriteComponent,
    SfFileSizePipe,
    SfIconComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-library-list.component.html',
  styleUrl: './media-library-list.component.scss',
})
export class MediaLibraryListComponent {
  /** The folder is still being read: the table shows its loading state. */
  readonly loading = input(false, { transform: booleanAttribute });

  protected readonly library = inject(MediaLibraryStore);
  protected readonly items = inject(MediaItemActions);
  protected readonly folders = inject(MediaFolderActions);
  private readonly selection = inject(MediaSelectionActions);
  private readonly transloco = inject(TranslocoService);
  private readonly table = viewChild(SfDataTableComponent<MediaListRow>);

  protected readonly folderName = computed(
    () => this.library.folderNode()?.displayName ?? this.transloco.translate('media.library.title'),
  );
  /** The folders first, then the files (sorted by the toolbar). */
  protected readonly rows = computed<MediaListRow[]>(() => [
    ...this.library.subfolders().map((folder) => ({ folder, uuid: folder.uuid ?? '', name: folder.displayName ?? folder.uid ?? '' })),
    ...this.library.visible(),
  ]);
  protected readonly rowKey = (row: MediaListRow): string => row.uuid ?? '';
  protected readonly rowLabel = (row: MediaListRow): string => (isFolderRow(row) ? row.name : (row.displayName ?? row.uid ?? ''));
  protected readonly folderOf = (row: MediaListRow): MediaFolderRow | null => (isFolderRow(row) ? row : null);
  protected readonly fileOf = (row: MediaListRow): MediaSummaryView | null => (isFolderRow(row) ? null : row);

  protected readonly columns = computed<SfDataTableColumn<MediaListRow>[]>(() => {
    const header = (id: string) => this.transloco.translate(`media.list.columns.${id}`);
    return [
      { id: 'thumb', header: header('thumb'), hideable: false, searchable: false, width: 72, minWidth: 64 },
      { id: 'name', header: header('name'), value: (r) => this.rowLabel(r), sortable: true, hideable: false, width: 192, minWidth: 160 },
      { id: 'type', header: header('type'), value: (r) => (isFolderRow(r) ? this.transloco.translate('media.folders.kind') : formatOf(r)), sortable: true, width: 72 },
      {
        id: 'dimensions',
        header: header('dimensions'),
        value: (r) => (!isFolderRow(r) && r.width && r.height ? `${r.width} × ${r.height}` : ''),
        compare: (a, b) => area(a) - area(b),
        sortable: true,
        width: 120,
      },
      { id: 'size', header: header('size'), value: (r) => (isFolderRow(r) ? 0 : (r.sizeBytes ?? 0)), sortable: true, align: 'end', width: 84 },
      { id: 'modified', header: header('modified'), value: (r) => (isFolderRow(r) ? 0 : changedTime(r)), sortable: true, width: 104 },
      { id: 'usages', header: header('usages'), value: (r) => (isFolderRow(r) ? 0 : (r.usageCount ?? 0)), sortable: true, align: 'end', width: 92 },
    ];
  });

  /**
   * Move, Download (the files), Release… and Delete act on the selection of files and folders (a read-only project can only
   * download). The table is told the selection by {@link onSelection} before a button is pressed.
   */
  protected readonly bulkActions = computed<SfDataTableBulkAction<MediaListRow>[]>(() => {
    return this.selection
      .actions('bulk')
      .map<SfDataTableBulkAction<MediaListRow>>(({ id, label, icon, danger, action }) => ({ id, label, icon, variant: danger ? 'danger' : undefined, action }));
  });

  /**
   * A right click on a row (or Shift+F10 / the menu key): the table opens this menu. The file and folder menus switch to the
   * selection's menu when the row is part of a selection of two or more.
   */
  protected readonly rowMenu = (rows: MediaListRow[]): ContextMenuItem[] => {
    const row = rows[0];
    return row ? toContextItems(isFolderRow(row) ? this.folders.menuItems(row.folder) : this.items.menuItems(row)) : [];
  };
  /** A right click on empty space below the rows: the open folder's *Upload* and *New folder*. */
  protected readonly emptyMenu = (): ContextMenuItem[] => this.folders.openFolderMenuItems();

  constructor() {
    // The table shows the library's selection (the grid's, and what a delete or a filter took out of it).
    effect(() => {
      const selected = [...this.library.selected(), ...this.library.selectedFolderUuids()];
      untracked(() => this.table()?.selectKeys(selected));
    });
  }

  /** The ticked rows are the library's selection: files and folders; a folder row opens, a file row opens its detail. */
  protected onSelection(keys: readonly string[]): void {
    const folders = new Set(this.library.subfolders().map((folder) => folder.uuid));
    this.library.setSelection(keys.filter((key) => !folders.has(key)));
    this.library.setFolderSelection(keys.filter((key) => folders.has(key)));
  }

  protected onRowOpen(row: MediaListRow): void {
    if (isFolderRow(row)) {
      void this.library.openFolder(row.uuid);
    } else {
      this.library.openAsset(row.uuid ?? null);
    }
  }

  // ── Rows: context menu and keys ────────────────────────────────────────────

  /** The folder or file of the list row a DOM node is in (the name cell carries its uuid). */
  private rowTarget(node: EventTarget | null): { folder: FolderView } | { file: MediaSummaryView } | null {
    const row = node instanceof Element ? node.closest<HTMLElement>('tr.sf-data-table__row') : null;
    const marker = row?.querySelector('[data-file], [data-folder]');
    const uuid = marker?.getAttribute('data-file') ?? marker?.getAttribute('data-folder');
    const hit = uuid ? this.rows().find((r) => r.uuid === uuid) : undefined;
    return !hit ? null : isFolderRow(hit) ? { folder: hit.folder } : { file: hit };
  }

  /** F2 renames, Delete deletes (the selection when the row is in it); the menu keys are the table's. */
  protected onKeydown(event: KeyboardEvent): void {
    const rowEl = event.target instanceof HTMLElement && event.target.matches('tr.sf-data-table__row') ? event.target : null;
    const hit = rowEl ? this.rowTarget(rowEl) : null;
    if (!hit || !this.library.canEdit()) {
      return;
    }
    const rename = event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!rename && event.key !== 'Delete') {
      return;
    }
    event.preventDefault();
    if ('folder' in hit) {
      void (rename ? this.folders.rename(hit.folder) : this.folders.deleteFromTile(hit.folder));
    } else {
      void (rename ? this.items.rename(hit.file) : this.items.deleteFile(hit.file));
    }
  }
}
