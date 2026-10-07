import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { bulkActionsAsMenu } from '../../../shared/components/data-table/data-table-menu';
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
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { toContextItems } from '../../../shared/components/menu/sf-menu-item';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import {
  DATASETS,
  SampleContentEntry,
  combinedStatus,
  contentChildren,
  contentEntry,
  contentParentOf,
  contentPath,
  datasetById,
  recordsInside,
} from './sample-content-data';
import { releaseContent } from './sample-content-release';
import { contentFavorite } from './sample-favorites';
import { SAMPLE_LANGS } from './sample-data';
import { STATUS_ICONS, STATUS_TONES, SampleState } from './sample-state';

const DATASET_FILTER = 'dataset';

/** The tree's clipboard scope: a cut or copy here pastes in the Content tree and the other way round. */
const CLIPBOARD_SCOPE = 'sample:content';

/**
 * The Content folder view (M35.20 mocked): page header with the folder's actions and a table of its folders and record
 * sets — dataset, record count, release status per language, last change — with a dataset filter ("Dataset: Products"
 * chips), multi-select and bulk actions. Nothing is changed: Delete confirms and offers Undo; Move (bulk and the folder's
 * menu) asks for the target folder and only announces the move. The folder's menu is Rename, Move and Delete (the store's
 * top level has none). Gate round 11 added the Status column and the Rename and Move dialogs. A right click on a row opens
 * the tree's menu for it (*Open*, *New folder* / *New record set* in a folder, *Rename…* in the dialog, *Cut*, *Copy* of
 * record sets, *Paste*, *Move to…*, the favorite toggle, *Release…*, *Delete*); on a selection of several rows it is *Cut*,
 * *Copy* and the bulk actions. Empty space offers *New folder* and *New record set*. Everything is announced only.
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
    SfStatusComponent,
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
  private readonly clipboard = inject(TreeClipboardService);
  private readonly table = viewChild.required<SfDataTableComponent<SampleContentEntry>>(SfDataTableComponent);
  private readonly now = Date.now();

  protected readonly title = computed(() => this.state.contentFolder()?.name ?? this.state.t('content.title'));
  protected readonly rows = computed(() => contentChildren(this.state.contentFolderId()));
  protected readonly langs = SAMPLE_LANGS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
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
      {
        id: 'status',
        header: header('status'),
        value: (r) => this.statuses(r).map((entry) => entry.status).join(),
        width: 150,
        searchable: false,
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
    { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: (s) => void this.move(s.rows) },
    { id: 'release', label: this.state.t('menus.release'), icon: 'publish', action: (s) => releaseContent(this.state, this.toasts, s.rows) },
    { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
  ]);

  /**
   * A right click on a row: *Open* first, then the same entries as the Content tree's menu for that item. On a selection
   * of several rows: *Cut*, *Copy* (record sets only) and the bulk actions.
   */
  protected readonly rowMenu = (rows: SampleContentEntry[]): ContextMenuItem[] => {
    const t = (key: string) => this.state.t(`menus.${key}`);
    const copyable = rows.every((row) => row.kind === 'recordset');
    const cut: SfMenuItem = { id: 'cut', label: t('cut'), icon: 'content_cut', shortcut: 'Mod+X', action: () => this.cut(rows) };
    const copy: SfMenuItem = { id: 'copy', label: t('copy'), icon: 'content_copy', shortcut: 'Mod+C', action: () => this.copy(rows) };
    if (rows.length !== 1) {
      return [...toContextItems([cut, ...(copyable ? [copy] : [])]), ...bulkActionsAsMenu(this.bulkActions(), rows, this.rowKey)];
    }
    const row = rows[0];
    const favorite = contentFavorite(row);
    const target = this.pasteTarget(row);
    return toContextItems([
      { id: 'open', label: t('open'), icon: 'open_in_new', shortcut: 'Enter', action: () => this.open(row) },
      ...(row.kind === 'folder'
        ? [
            { id: 'new-folder', label: t('newFolder'), icon: 'create_new_folder', action: () => this.state.notice('folder.newFolderNotice') },
            { id: 'new-set', label: t('newRecordSet'), icon: 'playlist_add', action: () => void this.state.newRecordSet(row.id) },
          ]
        : []),
      { id: 'rename', label: t('renameDialog'), icon: 'edit', shortcut: 'F2', action: () => void this.state.renameContent(row) },
      cut,
      ...(copyable ? [copy] : []),
      { id: 'paste', label: t('paste'), icon: 'content_paste', shortcut: 'Mod+V', disabled: !this.canPaste(target), action: () => this.paste(target) },
      { id: 'move-to', label: t('moveTo'), icon: 'drive_file_move', action: () => void this.move(rows) },
      {
        id: 'favorite',
        label: this.state.t(this.state.isFavoriteKey(favorite.key) ? 'favorites.remove' : 'favorites.add'),
        icon: 'star',
        action: () => this.state.toggleFavoriteOf(favorite),
      },
      { id: 'release', label: t('release'), icon: 'publish', action: () => releaseContent(this.state, this.toasts, rows) },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, shortcut: 'Del', separatorBefore: true, action: () => void this.deleteEntries([row.name]) },
    ]);
  };

  /** A right click on empty space acts as one on the open folder: only the *New …* options. */
  protected readonly emptyMenu = (): ContextMenuItem[] =>
    toContextItems([
      { id: 'new-folder', label: this.state.t('menus.newFolder'), icon: 'create_new_folder', action: () => this.state.notice('folder.newFolderNotice') },
      { id: 'new-set', label: this.state.t('menus.newRecordSet'), icon: 'playlist_add', action: () => void this.state.newRecordSet(this.state.contentFolderId()) },
    ]);

  /** The folder's menu; the top level of the store has none (it cannot be renamed, moved or deleted). */
  protected readonly moreActions = computed<SfMenuItem[]>(() =>
    this.state.contentFolder()
      ? [
          { id: 'rename', label: this.state.t('folder.rename'), icon: 'edit', shortcut: 'F2' },
          { id: 'move', label: this.state.t('folder.move'), icon: 'drive_file_move' },
          { id: 'delete', label: this.state.t('folder.delete'), icon: 'delete', danger: true, separatorBefore: true },
        ]
      : [],
  );

  constructor() {
    // The scripted `view=contentfolder` state: one dataset filter applied, so its chip shows; `dialog=rename|move` opens
    // that dialog on the open folder, `dialog=bulkmove` the Move dialog for the folder's first two entries.
    afterNextRender(() => {
      const dataset = this.state.presetFilter();
      if (dataset) {
        this.table().toggleFilterValue(DATASET_FILTER, dataset);
        this.state.presetFilter.set(null);
      }
      const dialog = this.state.contentDialog();
      this.state.contentDialog.set(null);
      const folder = this.state.contentFolder();
      if (dialog === 'rename' && folder) {
        void this.state.renameContent(folder);
      } else if (dialog === 'move' && folder) {
        void this.state.moveContent([folder]);
      } else if (dialog === 'bulkmove') {
        void this.state.moveContent(this.rows().slice(0, 2));
      }
    });
  }

  /** The release status per language of what the row holds: its records, or those of every set inside the folder. */
  protected statuses(row: SampleContentEntry) {
    const records = recordsInside(row, (id) => this.state.recordsOf(id));
    return this.langs.flatMap((lang) => {
      const status = combinedStatus(records, lang);
      return status ? [{ lang, status, tone: this.tones[status], icon: this.icons[status] }] : [];
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
    const folder = this.state.contentFolder();
    if (item.id === 'delete') {
      void this.deleteEntries([this.title()]);
    } else if (folder) {
      void (item.id === 'rename' ? this.state.renameContent(folder) : this.state.moveContent([folder]));
    }
  }

  // ── Cut, copy and paste (the Content tree's clipboard; announced only) ─────

  private cut(rows: readonly SampleContentEntry[]): void {
    this.clipboard.cutNodes(
      CLIPBOARD_SCOPE,
      rows.map((row) => ({ id: row.id, label: row.name, data: row })),
    );
  }

  private copy(rows: readonly SampleContentEntry[]): void {
    this.clipboard.copyNodes(
      CLIPBOARD_SCOPE,
      rows.map((row) => ({ id: row.id, label: row.name, data: row })),
    );
  }

  /** Where a paste onto a row goes, as the tree does it: into a folder, next to a record set (the open folder). */
  private pasteTarget(row: SampleContentEntry): string | null {
    return row.kind === 'folder' ? row.id : this.state.contentFolderId();
  }

  private pasted(): SampleContentEntry[] {
    const clip = this.clipboard.nodes();
    return clip?.scope === CLIPBOARD_SCOPE ? clip.nodes.flatMap((node) => (node.data ? [node.data as SampleContentEntry] : [])) : [];
  }

  /** Something is cut and does not go into itself or where it already is; something copied is record sets and goes anywhere. */
  private canPaste(target: string | null): boolean {
    const entries = this.pasted();
    if (this.clipboard.nodes()?.mode === 'copy') {
      return entries.length > 0 && entries.every((entry) => entry.kind === 'recordset');
    }
    const chain = contentPath(target).map((entry) => entry.id);
    return (
      entries.length > 0 &&
      !entries.some((entry) => entry.kind === 'folder' && chain.includes(entry.id)) &&
      !entries.every((entry) => contentParentOf(entry.id) === target)
    );
  }

  private paste(target: string | null): void {
    const entries = this.pasted();
    if (!this.canPaste(target)) {
      return;
    }
    const params = { count: entries.length, name: entries[0].name };
    if (this.clipboard.nodes()?.mode === 'copy') {
      this.toasts.undo(this.state.t('menus.copied', params), () => this.state.notice('menus.copiedBack'));
      return;
    }
    this.clipboard.clear();
    const name = contentEntry(target)?.name ?? this.state.t('content.title');
    this.toasts.undo(this.state.t('contentMove.moved', { ...params, target: name }), () => this.state.notice('contentMove.movedBack'));
  }

  private async move(entries: readonly SampleContentEntry[]): Promise<void> {
    if (await this.state.moveContent(entries)) {
      this.table().clearSelection();
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
