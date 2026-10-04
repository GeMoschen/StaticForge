import { bulkActionsAsMenu } from '../../shared/components/data-table/data-table-menu';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import type {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableFilter,
} from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { ToastService } from '../../core/ui/toast.service';
import { releaseTone } from '../pages/folder-view.util';
import { FolderMoveDialogComponent } from '../pages/folder-move-dialog.component';
import { localeStatuses, localeTag, statusLabel } from '../release/release-status.util';
import { ContentItemActions } from './content-item-actions.service';
import { ContentStoreRefresh } from './content-store-refresh.service';
import {
  type ContentEntry,
  type ContentIndex,
  RECORD_SET_ICON,
  childEntries,
  folderChain,
  folderTrail,
  foldersOnly,
} from './content-tree.util';
import type { DatasetSummaryView } from './content.service';

type FolderView = components['schemas']['FolderView'];

/** The dataset filter of the table: its id is also the URL parameter (`?dataset=<uuid>`). */
const DATASET_FILTER = 'dataset';

/** What the folder view is asking the person about, besides the table: where to move entries to. */
type MoveDialog = { readonly entries: readonly ContentEntry[] } | null;

/**
 * A Content folder's contents (M35.20): a page header with the folder's name and its actions (*New folder*, *New record
 * set*, ⋮ with *Rename*, *Move…* and *Delete…*), and a table of what lies directly inside — the sub-folders first, then the
 * record sets: name (with a ☆ that shows on hover or focus and stays while it is a favorite), dataset, record count,
 * a status chip per language and when it was last changed. The datasets are a filter ("Dataset: Products"). Selecting
 * rows offers *Move…* and *Delete*, each with one Undo. What opening a row or creating something means is the Content
 * area's business (`openSet`, `openFolder`, `newFolder`, `newRecordSet`, `rename`); the data comes from there too.
 */
@Component({
  selector: 'sf-content-folder-view',
  standalone: true,
  imports: [
    FolderMoveDialogComponent,
    SfAssetFavoriteComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './content-folder-view.component.html',
  styleUrl: './content-folder-view.component.scss',
})
export class ContentFolderViewComponent {
  private readonly actions = inject(ContentItemActions);
  private readonly refresh = inject(ContentStoreRefresh);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly canEdit = inject(ProjectPermissionsStore).canEditContent;

  readonly projectKey = input.required<string>();
  /** The open folder; `null` is the store root (so is a uuid that is not in the tree any more). */
  readonly folderUuid = input<string | null>(null);
  readonly index = input.required<ContentIndex>();
  /** The folder tree as the store holds it: the fixed "All Content" wrapper as its single entry. */
  readonly tree = input.required<readonly FolderView[]>();
  readonly datasets = input<readonly DatasetSummaryView[]>([]);
  readonly loading = input(false);
  readonly failed = input(false);

  readonly openSet = output<string>();
  readonly openFolder = output<string | null>();
  readonly newFolder = output<void>();
  readonly newRecordSet = output<void>();
  /** The header's *Rename*: the area starts the inline rename in its tree. */
  readonly rename = output<string>();
  readonly retry = output<void>();

  // ── What is shown ──────────────────────────────────────────────────────────

  /** The open folder, `null` at the store root. */
  protected readonly folder = computed<ContentEntry | null>(() => {
    const uuid = this.folderUuid();
    const entry = uuid ? this.index().entries.get(uuid) : undefined;
    return entry?.kind === 'folder' ? entry : null;
  });
  protected readonly isRoot = computed(() => this.folder() === null);
  protected readonly title = computed(() => this.folder()?.name ?? this.transloco.translate('content.folder.root'));
  protected readonly rows = computed<ContentEntry[]>(() => childEntries(this.index(), this.folder()?.uuid ?? null));
  private readonly wrapperUuid = computed(() => this.index().rootUuid);

  private readonly chain = computed<FolderView[]>(() => {
    const uuid = this.folder()?.uuid;
    return uuid ? folderChain(this.tree(), uuid) : [];
  });
  protected readonly trail = computed(() => folderTrail(this.chain().slice(0, -1), this.projectKey(), this.wrapperUuid()));

  protected readonly rowKey = (row: ContentEntry): string => row.uuid;
  protected readonly rowLabel = (row: ContentEntry): string => row.name;
  protected readonly icon = (row: ContentEntry): string => (row.kind === 'folder' ? 'folder' : RECORD_SET_ICON);

  protected readonly moving = signal<MoveDialog>(null);

  protected readonly columns = computed<SfDataTableColumn<ContentEntry>[]>(() => {
    const t = (id: string) => this.transloco.translate(`content.folder.columns.${id}`);
    return [
      { id: 'name', header: t('name'), value: (row) => row.name, sortable: true, hideable: false, width: 280 },
      { id: 'dataset', header: t('dataset'), value: (row) => row.datasetName ?? '', sortable: true, width: 160 },
      { id: 'records', header: t('records'), value: (row) => (row.kind === 'folder' ? -1 : row.recordCount), sortable: true, align: 'end', width: 110 },
      { id: 'status', header: t('status'), value: (row) => localeStatuses(row.release).map((entry) => entry.status).join(), width: 190 },
      { id: 'modified', header: t('modified'), value: (row) => row.changedAt ?? '', sortable: true, width: 170 },
    ];
  });

  /** "Dataset: Products": the table's own filter chips; a folder has no dataset, so it drops out while one is picked. */
  protected readonly filters = computed<SfDataTableFilter<ContentEntry>[]>(() => [
    {
      id: DATASET_FILTER,
      label: this.transloco.translate('content.folder.datasetFilter'),
      options: this.datasets().flatMap((dataset) => (dataset.uuid ? [{ value: dataset.uuid, label: dataset.displayName ?? dataset.uid ?? dataset.uuid }] : [])),
      match: (row, values) => row.datasetUuid !== null && values.includes(row.datasetUuid),
    },
  ]);

  /** A right click on a row: *Open* (one row) and the bulk actions, acting on the row or on the selection it is part of. */
  protected readonly rowMenu = (rows: ContentEntry[]): ContextMenuItem[] => [
    ...(rows.length === 1
      ? [{ label: this.transloco.translate('shared.dataTable.open'), icon: 'open_in_new', shortcut: 'Enter', action: () => this.open(rows[0]) }]
      : []),
    ...bulkActionsAsMenu(this.bulkActions(), rows, this.rowKey),
  ];

  /** A right click on empty space acts as one on the open folder: only the *New …* options. */
  protected readonly emptyMenu = (): ContextMenuItem[] =>
    !this.canEdit()
      ? []
      : [
          { label: this.transloco.translate('content.folder.newFolder'), icon: 'create_new_folder', action: () => this.newFolder.emit() },
          ...(this.datasets().length === 0
            ? []
            : [{ label: this.transloco.translate('content.folder.newRecordSet'), icon: 'playlist_add', action: () => this.newRecordSet.emit() }]),
        ];

  protected readonly bulkActions = computed<SfDataTableBulkAction<ContentEntry>[]>(() => {
    if (!this.canEdit()) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`content.folder.bulk.${id}`);
    return [
      { id: 'move', label: t('move'), icon: 'drive_file_move', action: (selection) => this.moving.set({ entries: selection.rows }) },
      { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: (selection) => void this.delete(selection.rows) },
    ];
  });

  /** The folder's ⋮ menu; the store root has none (it cannot be renamed, moved or deleted). */
  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    if (this.isRoot()) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`content.folder.menu.${id}`);
    const disabled = !this.canEdit();
    return [
      { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', disabled },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled },
    ];
  });

  constructor() {
    // The frame's breadcrumb ends with the open folder, with the folders above it as links.
    useFrameItem(() => {
      const folder = this.folder();
      return folder ? { label: folder.name, trail: this.trail(), asset: { uuid: folder.uuid } } : null;
    });

    inject(ShortcutService).use([
      {
        id: 'contentFolder.rename',
        keys: 'F2',
        scope: 'screen',
        group: 'screen',
        description: 'content.folder.menu.rename',
        enabled: () => !this.isRoot() && this.canEdit(),
        handler: () => this.renameOpen(),
      },
    ]);
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  protected open(row: ContentEntry): void {
    if (row.kind === 'folder') {
      this.openFolder.emit(row.uuid);
    } else {
      this.openSet.emit(row.uuid);
    }
  }

  protected statuses(row: ContentEntry) {
    return localeStatuses(row.release).map((entry) => ({
      key: entry.key,
      tag: localeTag(entry.key),
      label: statusLabel(entry.status),
      tone: releaseTone(entry.status),
    }));
  }

  // ── Header actions ─────────────────────────────────────────────────────────

  protected onMenu(item: SfMenuItem): void {
    const folder = this.folder();
    if (!folder) {
      return;
    }
    switch (item.id) {
      case 'rename':
        this.renameOpen();
        break;
      case 'move':
        this.moving.set({ entries: [folder] });
        break;
      case 'delete':
        void this.delete([folder]);
        break;
    }
  }

  private renameOpen(): void {
    const uuid = this.folder()?.uuid;
    if (uuid) {
      this.rename.emit(uuid);
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  protected excludedFolders(entries: readonly ContentEntry[]): string[] {
    return entries.filter((entry) => entry.kind === 'folder').map((entry) => entry.uuid);
  }

  /** The tree the move dialog shows: folders only, a record set can only go into a folder. */
  protected readonly folderTree = computed(() => foldersOnly(this.tree()));

  protected onMoveChosen(entries: readonly ContentEntry[], target: string | null): void {
    this.moving.set(null);
    void this.move(entries, target === this.wrapperUuid() ? null : target);
  }

  private async move(entries: readonly ContentEntry[], target: string | null): Promise<void> {
    const index = this.index();
    const change = await this.actions.move(this.projectKey(), entries, target, (entry) => index.parentOf.get(entry.uuid) ?? null);
    if (change.done.length > 0) {
      const message = this.transloco.translate('shared.tree.moved', { count: change.done.length, name: change.done[0].name });
      this.undo.offerGroup(message, this.withRefresh(change.steps));
    }
    if (change.failed) {
      this.toasts.show(this.transloco.translate('content.folder.bulk.moveFailed'), 'error');
    }
    this.refresh.notify();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private async delete(entries: readonly ContentEntry[]): Promise<void> {
    if (entries.length === 0 || !(await this.actions.confirmDelete(entries))) {
      return;
    }
    const open = this.folder()?.uuid;
    const parent = open ? (this.index().parentOf.get(open) ?? null) : null;
    const change = await this.actions.delete(this.projectKey(), entries);
    if (change.done.length > 0) {
      const message = this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].name });
      this.undo.offerGroup(message, this.withRefresh(change.steps));
    }
    if (change.failed) {
      this.toasts.show(this.transloco.translate('content.folder.bulk.deleteFailed'), 'error');
    }
    this.refresh.notify();
    // The open folder itself was deleted: the view goes up to where it was.
    if (open && change.done.some((entry) => entry.uuid === open)) {
      this.openFolder.emit(parent);
    }
  }

  /** After an Undo the area reads the store again: the first step is the one that runs last. */
  private withRefresh(steps: readonly UndoStep[]): UndoStep[] {
    return [async () => this.refresh.notify(), ...steps];
  }
}
