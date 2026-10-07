import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { bulkActionsAsMenu } from '../../../shared/components/data-table/data-table-menu';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableSelection,
} from '../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { UNASSIGNED_URL_PAGES } from './pages/pages-data';
import { SamplePagesReview } from './pages/sample-pages-review';
import { SAMPLE_LANGS, SampleEntry, childrenOf } from './sample-data';
import { STATUS_ICONS, STATUS_TONES, SampleState } from './sample-state';

/**
 * The folder view (M35.18): page header with the folder's actions, and a table of its children with status per
 * language, who changed what when, multi-select and bulk actions. Nothing is changed: Delete confirms and offers Undo.
 */
@Component({
  selector: 'sf-sample-folder-view',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SfAvatarComponent,
    SfBadgeComponent,
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
  templateUrl: './sample-folder-view.component.html',
  styleUrl: './sample-folder-view.component.scss',
})
export class SampleFolderViewComponent {
  protected readonly state = inject(SampleState);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  protected readonly review = inject(SamplePagesReview);
  private readonly table = viewChild.required<SfDataTableComponent<SampleEntry>>(SfDataTableComponent);

  protected readonly langs = SAMPLE_LANGS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  private readonly now = Date.now();

  protected readonly title = computed(() => this.state.folder()?.name ?? this.state.t('rail.pages'));
  protected readonly rows = computed(() => (['empty', 'loading', 'error'].includes(this.review.folder()) ? [] : childrenOf(this.state.folderId())));
  /** The table is reading (`fstate=loading`) or the read failed (`fstate=error`, with Retry). */
  protected readonly loading = computed(() => this.review.folder() === 'loading');
  protected readonly failed = computed(() => this.review.folder() === 'error');
  /** The Pages root has no rename, move or delete. */
  protected readonly isRoot = computed(() => this.state.folderId() === null);
  protected readonly rowKey = (row: SampleEntry) => row.id;
  protected readonly rowLabel = (row: SampleEntry) => row.name;

  protected readonly columns = computed<SfDataTableColumn<SampleEntry>[]>(() => {
    const header = (id: string) => this.state.t(`folder.columns.${id}`);
    const columns: SfDataTableColumn<SampleEntry>[] = [
      { id: 'name', header: header('name'), value: (r) => r.name, sortable: true, hideable: false, width: 250 },
      { id: 'template', header: header('template'), value: (r) => r.template ?? '', sortable: true, width: 120 },
      { id: 'status', header: header('status'), value: (r) => r.status.de, width: 128 },
      { id: 'modified', header: header('modified'), value: (r) => r.modifiedMinutes, sortable: true, width: 150 },
      { id: 'released', header: header('released'), value: (r) => r.releasedMinutes ?? Number.MAX_SAFE_INTEGER, sortable: true, width: 120 },
    ];
    if (this.state.devMode()) {
      // The registered URL; a page without one shows its computed address (muted, "Not assigned yet").
      columns.push({ id: 'url', header: header('url'), value: (r) => r.url, width: 200 });
    }
    return columns;
  });

  /**
   * A right click on a row, as in the app: that item's menu (the page tree's entries) for one row, the bulk actions that fit
   * for a selection. Nothing is changed: the entries announce what they would do.
   */
  protected readonly rowMenu = (rows: SampleEntry[]): ContextMenuItem[] =>
    rows.length === 1
      ? this.itemMenu(rows[0])
      : bulkActionsAsMenu(
          this.bulkActions().filter((action) => action.id !== 'duplicate' || rows.some((row) => row.kind === 'page')),
          rows,
          this.rowKey,
        );

  /** New page / New folder (folders only), Rename…, Cut, Copy (pages), Paste, Move to…, favorite, Duplicate (pages), Release, Delete. */
  private itemMenu(row: SampleEntry): ContextMenuItem[] {
    const t = (key: string) => this.state.t(key);
    const isFolder = row.kind === 'folder';
    const separator: ContextMenuItem = { label: '', separator: true };
    // A paste onto a folder goes into it; onto a page, next to it (into the open folder).
    const pasteTarget = isFolder ? row.id : this.state.folderId();
    const items: ContextMenuItem[] = [];
    if (!this.review.readOnly()) {
      if (isFolder) {
        items.push(
          { label: t('folder.newPage'), icon: 'note_add', action: () => this.newItem('page') },
          { label: t('folder.newFolder'), icon: 'create_new_folder', action: () => this.newItem('folder') },
        );
      }
      items.push(
        { label: t('folder.menu.rename'), icon: 'edit', action: () => void this.review.rename(row) },
        separator,
        { label: t('folder.menu.cut'), icon: 'content_cut', shortcut: 'Mod+X', action: () => this.review.cut([row]) },
        ...(isFolder ? [] : [{ label: t('folder.menu.copy'), icon: 'content_copy', shortcut: 'Mod+C', action: () => this.review.copy([row]) }]),
        {
          label: t('folder.menu.paste'),
          icon: 'content_paste',
          shortcut: 'Mod+V',
          disabled: !this.review.canPaste(pasteTarget),
          action: () => this.review.paste(pasteTarget),
        },
        { label: t('folder.menu.moveTo'), icon: 'drive_file_move', action: () => this.review.openMove([row]) },
        separator,
      );
    }
    items.push({
      label: t(this.state.isFavorite(row.id) ? 'favorites.remove' : 'favorites.add'),
      icon: 'star',
      action: () => this.state.toggleFavorite(row.id),
    });
    if (!this.review.readOnly()) {
      if (!isFolder) {
        items.push({ label: t('folder.bulk.duplicate'), icon: 'content_copy', action: () => this.duplicate([row]) });
      }
      items.push(
        { label: t('folder.bulk.release'), icon: 'publish', action: () => this.review.release([row]) },
        separator,
        { label: t('folder.bulk.delete'), icon: 'delete', danger: true, shortcut: 'Del', action: () => void this.deleteEntries([row.name], undefined, isFolder) },
      );
    }
    return items;
  }

  /** A right click on empty space acts as one on the open folder: only the *New …* options. */
  protected readonly emptyMenu = (): ContextMenuItem[] =>
    this.review.readOnly()
      ? []
      : [
          { label: this.state.t('folder.newPage'), icon: 'note_add', action: () => this.newItem('page') },
          { label: this.state.t('folder.newFolder'), icon: 'create_new_folder', action: () => this.newItem('folder') },
        ];

  /** A page's address: registered unless the page has none yet (then the computed one, marked as not assigned). */
  protected registered(row: SampleEntry): boolean {
    return !UNASSIGNED_URL_PAGES.has(row.id);
  }

  /** Time travel and an archived project are read-only: nothing that changes something is offered. */
  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleEntry>[]>(() =>
    this.review.readOnly()
      ? []
      : [
          { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: (s) => this.review.openMove(s.rows) },
          { id: 'release', label: this.state.t('folder.bulk.release'), icon: 'publish', action: (s) => this.review.release(s.rows) },
          { id: 'duplicate', label: this.state.t('folder.bulk.duplicate'), icon: 'content_copy', action: (s) => this.duplicate(s.rows) },
          { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
        ],
  );

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const locked = this.review.readOnly();
    if (this.isRoot()) {
      // The root cannot be renamed, moved or deleted: settings and the link are all it has.
      return [
        { id: 'settings', label: this.state.t('folder.settings'), icon: 'settings' },
        { id: 'copyLink', label: this.state.t('folder.copyLink'), icon: 'link' },
      ];
    }
    return [
      {
        id: 'favorite',
        label: this.state.t(this.state.isFavorite(this.state.folderId()!) ? 'favorites.remove' : 'favorites.add'),
        icon: 'star',
      },
      { id: 'settings', label: this.state.t('folder.settings'), icon: 'settings' },
      { id: 'rename', label: this.state.t('folder.rename'), icon: 'edit', shortcut: 'F2', disabled: locked },
      { id: 'move', label: this.state.t('folder.move'), icon: 'drive_file_move', disabled: locked },
      { id: 'copyLink', label: this.state.t('folder.copyLink'), icon: 'link' },
      { id: 'delete', label: this.state.t('folder.delete'), icon: 'delete', danger: true, separatorBefore: true, disabled: locked },
    ];
  });

  constructor() {
    // The scripted `view=folder` state: select the fixed rows once the table is there.
    afterNextRender(() => {
      const keys = this.state.preselect();
      if (keys.length === 0) {
        return;
      }
      this.table().selectKeys(keys);
      this.state.preselect.set([]);
    });
  }

  protected open(row: SampleEntry): void {
    if (row.kind === 'folder') {
      this.state.openFolder(row.id);
    } else {
      this.state.openPage(row.id);
    }
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected newItem(kind: 'page' | 'folder'): void {
    this.state.notice(kind === 'page' ? 'folder.newPageNotice' : 'folder.newFolderNotice');
  }

  protected async releaseFolder(): Promise<void> {
    const name = this.title();
    const confirmed = await this.confirms.confirm({
      title: this.state.t('folder.releaseTitle', { name }),
      message: this.state.t('folder.releaseMessage', { count: this.rows().length }),
      confirmLabel: this.state.t('folder.releaseConfirm'),
    });
    if (confirmed) {
      this.toasts.show(this.state.t('folder.releaseDone', { name }), 'success');
    }
  }

  protected secondary(item: SfMenuItem): void {
    if (item.id === 'settings') {
      this.state.closeDrawers();
      this.state.pageSettings.set('folder');
    } else if (item.id === 'favorite') {
      this.state.toggleFavorite(this.state.folderId()!);
    } else if (item.id === 'move') {
      const own = this.state.folder();
      if (own) {
        this.review.openMove([own]);
      }
    } else if (item.id === 'delete') {
      void this.deleteEntries([this.title()], undefined, true);
    } else {
      this.state.notice();
    }
  }

  /** Duplicate: the copies appear next to the originals; Undo removes them. */
  private duplicate(rows: readonly SampleEntry[]): void {
    const pages = rows.filter((row) => row.kind === 'page').length;
    const skipped = rows.length - pages;
    if (pages === 0) {
      this.toasts.show(this.state.t('folder.bulk.foldersNotDuplicated'), 'info');
      return;
    }
    const message =
      skipped > 0
        ? this.state.t('folder.bulk.duplicatedSkipped', { count: pages })
        : this.state.t('folder.bulk.duplicated', { count: pages });
    this.toasts.undo(message, () => this.toasts.show(this.state.t('folder.bulk.duplicatedBack'), 'info'));
  }

  private delete(selection: SfDataTableSelection<SampleEntry>): Promise<void> {
    return this.deleteEntries(
      selection.rows.map((row) => row.name),
      () => this.table().clearSelection(),
      selection.rows.some((row) => row.kind === 'folder'),
    );
  }

  /** Confirms a delete; folders go with everything inside them, and the message says so. */
  private async deleteEntries(names: readonly string[], done?: () => void, folders = false): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.state.t('folder.deleteTitle', { count: names.length, name: names[0] }),
      message: this.state.t(folders ? 'folder.deleteMessageFolders' : 'folder.deleteMessage'),
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
