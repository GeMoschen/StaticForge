import { ChangeDetectionStrategy, Component, booleanAttribute, computed, effect, inject, input, untracked, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import type { SfDataTableBulkAction, SfDataTableColumn } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfMenuComponent } from '../../../shared/components/menu/sf-menu.component';
import { SfAssetFavoriteComponent } from '../../../shared/components/sf-asset-favorite.component';
import { SfFileSizePipe } from '../../../shared/pipes/sf-file-size.pipe';
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaLibraryStore, type MediaSummaryView } from './media-library.store';
import { changedTime, formatOf } from './media-library.util';
import { MediaPreviewComponent } from './media-preview.component';

/**
 * The library's list view (decisions 19 and 22): an `sf-data-table` of the folder's files — preview, name (with the status
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
    SfMenuComponent,
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
  private readonly mover = inject(MediaMover);
  private readonly transloco = inject(TranslocoService);
  private readonly table = viewChild(SfDataTableComponent<MediaSummaryView>);
  /** A Shift+F10 press opened the menu already; the `contextmenu` event some browsers add must not open it twice. */
  private suppressContextMenu = false;

  protected readonly folderName = computed(
    () => this.library.folderNode()?.displayName ?? this.transloco.translate('media.library.title'),
  );
  protected readonly rowKey = (file: MediaSummaryView): string => file.uuid ?? '';
  protected readonly rowLabel = (file: MediaSummaryView): string => file.displayName ?? file.uid ?? '';

  protected readonly columns = computed<SfDataTableColumn<MediaSummaryView>[]>(() => {
    const header = (id: string) => this.transloco.translate(`media.list.columns.${id}`);
    return [
      { id: 'thumb', header: header('thumb'), hideable: false, searchable: false, width: 72, minWidth: 64 },
      { id: 'name', header: header('name'), value: (f) => f.displayName ?? f.uid ?? '', sortable: true, hideable: false, width: 192, minWidth: 160 },
      { id: 'type', header: header('type'), value: (f) => formatOf(f), sortable: true, width: 72 },
      {
        id: 'dimensions',
        header: header('dimensions'),
        value: (f) => (f.width && f.height ? `${f.width} × ${f.height}` : ''),
        compare: (a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0),
        sortable: true,
        width: 120,
      },
      { id: 'size', header: header('size'), value: (f) => f.sizeBytes ?? 0, sortable: true, align: 'end', width: 84 },
      { id: 'modified', header: header('modified'), value: (f) => changedTime(f), sortable: true, width: 104 },
      { id: 'usages', header: header('usages'), value: (f) => f.usageCount ?? 0, sortable: true, align: 'end', width: 92 },
      { id: 'actions', header: header('actions'), searchable: false, hideable: false, width: 72 },
    ];
  });

  /** Move, Download and Delete act on the selection (a read-only project can only download). */
  protected readonly bulkActions = computed<SfDataTableBulkAction<MediaSummaryView>[]>(() => {
    const t = (id: string) => this.transloco.translate(`media.bulk.${id}`);
    const download = { id: 'download', label: t('download'), icon: 'download', action: () => void this.items.download(this.library.selectedItems()) };
    return !this.library.canEdit()
      ? [download]
      : [
          { id: 'move', label: t('move'), icon: 'drive_file_move', action: () => void this.mover.moveFiles(this.library.selectedItems()) },
          download,
          { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: () => void this.items.deleteSelection() },
        ];
  });

  constructor() {
    // The table shows the library's selection (the grid's, and what a delete or a filter took out of it).
    effect(() => {
      const selected = this.library.selected();
      untracked(() => this.table()?.selectKeys(selected));
    });
  }

  // ── Rows: context menu and keys ────────────────────────────────────────────

  /** The file of the list row a DOM node is in (the name cell carries its uuid). */
  private rowFile(node: EventTarget | null): { file: MediaSummaryView; row: HTMLElement } | null {
    const row = node instanceof Element ? node.closest<HTMLElement>('tr.sf-data-table__row') : null;
    const uuid = row?.querySelector('[data-file]')?.getAttribute('data-file');
    const file = uuid ? this.library.visible().find((f) => f.uuid === uuid) : undefined;
    return row && file ? { file, row } : null;
  }

  protected onContextMenu(event: MouseEvent): void {
    const hit = this.rowFile(event.target);
    if (!hit) {
      return;
    }
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      event.preventDefault();
      return;
    }
    this.items.onItemContextMenu(hit.file, event);
  }

  /** Shift+F10 / the menu key open the row's menu, F2 renames, Delete deletes (the selection when the row is in it). */
  protected onKeydown(event: KeyboardEvent): void {
    const hit = event.target instanceof HTMLElement && event.target.matches('tr.sf-data-table__row') ? this.rowFile(event.target) : null;
    if (!hit) {
      return;
    }
    const file = hit.file;
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      this.suppressContextMenu = true;
      setTimeout(() => (this.suppressContextMenu = false));
      this.items.onItemContextMenu(file, hit.row);
    } else if (event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey && this.library.canEdit()) {
      event.preventDefault();
      void this.items.rename(file);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void this.items.deleteFile(file);
    }
  }
}
