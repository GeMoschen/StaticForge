import { bulkActionsAsMenu } from '../../shared/components/data-table/data-table-menu';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { type Observable, Subscription, concat, defer, forkJoin, last, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FavoritesService } from '../../core/assets/favorites.service';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import type {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableSelection,
} from '../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfTableIdentityComponent } from '../../shared/components/data-table/sf-table-identity.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { moveBackBody } from '../../shared/folder-tree.util';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import type { ReleaseChoice } from '../release/release-choice.util';
import { deleteQuestion, isOnline, localeStatuses, localeTag, statusLabel } from '../release/release-status.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { FolderMoveDialogComponent } from './folder-move-dialog.component';
import { FolderSettingsDrawerComponent } from './folder-settings-drawer.component';
import { type FolderRow, folderChain, folderRows, folderTrail, releaseTone } from './folder-view.util';
import { type PageAddress, PageUrlService, pageAddress } from './page-url.service';
import { PagesItemActions } from './pages-item-actions';
import { PagesTreeRefresh } from './pages-tree-refresh.service';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** What the page is currently asking the person about, besides the table. */
type Dialog = { kind: 'release'; choices: ReleaseChoice[] } | { kind: 'move'; rows: readonly FolderRow[] } | null;

/**
 * A folder's contents (M35.18): a page header with the folder's name, its path as navigable crumbs and its actions
 * (*New page*, *New folder*, *Release folder…*, ⋮), and a table of what lies directly inside — the sub-folders first, then the
 * pages: name (with a ☆ that shows on hover or focus and stays while it is a favorite), template, a status chip per
 * language, who changed it when, when it was last released and, in developer mode, its path. Selecting rows offers the bulk
 * actions *Move…*, *Release…*, *Duplicate* and *Delete*; each that changes something offers one Undo. *Folder settings…* opens
 * the settings drawer. The Pages area's shell decides what opening a row does (`openPage`, `openFolder`).
 */
@Component({
  selector: 'sf-folder-view',
  standalone: true,
  imports: [
    FolderMoveDialogComponent,
    FolderSettingsDrawerComponent,
    ReleaseDialogComponent,
    SfAssetFavoriteComponent,
    SfAvatarComponent,
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfRenameAssetDialogComponent,
    SfStatusComponent,
    SfTableIdentityComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-view.component.html',
  styleUrl: './folder-view.component.scss',
})
export class FolderViewComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly transloco = inject(TranslocoService);
  private readonly actions = inject(PagesItemActions);
  private readonly pageUrls = inject(PageUrlService);
  protected readonly favorites = inject(FavoritesService);
  protected readonly developerMode = inject(DeveloperModeService);
  protected readonly permissions = inject(ProjectPermissionsStore);
  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly projectKey = input.required<string>();
  /** The open folder; `null` is the Pages root. */
  readonly folderUuid = input<string | null>(null);

  readonly openPage = output<string>();
  readonly openFolder = output<string | null>();

  // ── What is shown ──────────────────────────────────────────────────────────

  protected readonly tree = computed<readonly FolderView[]>(() => this.store.pageFolderTree());
  /** The fixed "All Pages" wrapper: it stands for the project root. */
  private readonly wrapper = computed<FolderView | null>(() => this.tree()[0] ?? null);
  protected readonly isRoot = computed(() => this.folderUuid() === null || this.folderUuid() === this.wrapper()?.uuid);
  /** The open folder (the wrapper while at the root). */
  protected readonly folder = computed<FolderView | null>(() => {
    const uuid = this.folderUuid();
    return uuid === null ? this.wrapper() : (folderChain(this.tree(), uuid).at(-1) ?? null);
  });
  /** The folder whose pages are listed: the wrapper at the root. */
  private readonly listUuid = computed(() => this.folder()?.uuid ?? null);
  private readonly pages = signal<readonly AssetSummaryView[]>([]);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  private pagesRead: Subscription | null = null;
  /** The registered URL of each page (uuid → URL), read from the URL registry in developer mode. */
  private readonly registeredUrls = signal<ReadonlyMap<string, string>>(new Map());
  private urlsRead: Subscription | null = null;

  protected readonly title = computed(() => (this.isRoot() ? this.transloco.translate('pages.folder.root') : (this.folder()?.displayName ?? this.folder()?.uid ?? '')));
  protected readonly rows = computed<FolderRow[]>(() => folderRows(this.folder()?.children ?? [], this.pages()));
  protected readonly pageCount = computed(() => this.rows().filter((row) => row.kind === 'page').length);
  protected readonly folderCount = computed(() => this.rows().filter((row) => row.kind === 'folder').length);
  protected readonly trail = computed(() => {
    const chain = this.folderUuid() === null ? [] : folderChain(this.tree(), this.folderUuid()!);
    return folderTrail(chain, this.projectKey(), this.wrapper()?.uuid ?? null);
  });

  protected readonly dialog = signal<Dialog>(null);
  protected readonly newPageOpen = signal(false);
  protected readonly newFolderOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly settingsRename = signal(false);
  /** The row the *Rename…* dialog is open for. */
  protected readonly renaming = signal<FolderRow | null>(null);
  protected readonly renameBusy = signal(false);
  /** The folder the open *New page* / *New folder* dialog creates into; `null` = the open folder. */
  private readonly createIn = signal<string | null>(null);

  protected readonly rowKey = (row: FolderRow): string => row.key;
  protected readonly rowLabel = (row: FolderRow): string => row.name;

  protected readonly columns = computed<SfDataTableColumn<FolderRow>[]>(() => {
    const t = (id: string) => this.transloco.translate(`pages.folder.columns.${id}`);
    const columns: SfDataTableColumn<FolderRow>[] = [
      { id: 'name', header: t('name'), value: (row) => row.name, sortable: true, hideable: false, width: 320 },
      { id: 'template', header: t('template'), value: (row) => row.templateName ?? '', sortable: true, width: 160 },
      { id: 'status', header: t('status'), value: (row) => localeStatuses(row.release).map((entry) => entry.status).join(), width: 200 },
      { id: 'modified', header: t('modified'), value: (row) => row.changedAt ?? '', sortable: true, width: 190 },
      { id: 'released', header: t('released'), value: (row) => row.releasedAt ?? '', sortable: true, width: 150 },
    ];
    if (this.developerMode.enabled()) {
      columns.push({ id: 'path', header: t('path'), value: (row) => this.urlOf(row), width: 240 });
    }
    return columns;
  });

  /**
   * A right click on a row: the entries of the page tree's menu for that item (one row), or the bulk actions that fit
   * (a selection: Move, Release, Duplicate when it holds pages, Delete) — the same as the bulk bar offers.
   */
  protected readonly rowMenu = (rows: FolderRow[]): ContextMenuItem[] =>
    rows.length === 1
      ? this.itemMenu(rows[0])
      : bulkActionsAsMenu(
          this.bulkActions().filter((action) => action.id !== 'duplicate' || rows.some((row) => row.kind === 'page')),
          rows,
          this.rowKey,
        );

  /** The page tree's menu for one item: New page/folder here, Rename…, Cut, Copy, Paste, Move to…, favorite, Duplicate, Release…, Delete. */
  private itemMenu(row: FolderRow): ContextMenuItem[] {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const key = this.projectKey();
    const editable = !this.readOnly();
    const isFolder = row.kind === 'folder';
    const separator: ContextMenuItem = { label: '', separator: true };
    // A paste onto a folder goes into it; onto a page, next to it (into the open folder).
    const pasteTarget = isFolder ? row.uuid : this.isRoot() ? null : (this.folder()?.uuid ?? null);
    const items: ContextMenuItem[] = [];
    if (editable) {
      if (isFolder && this.pageTemplates().length > 0) {
        items.push({ label: t('pages.tree.newPageHere'), icon: 'note_add', action: () => this.newPage(row.uuid) });
      }
      if (isFolder) {
        items.push({ label: t('pages.folder.newFolder'), icon: 'create_new_folder', action: () => this.newFolder(row.uuid) });
      }
      items.push(
        { label: t('templates.menu.rename'), icon: 'edit', action: () => this.renaming.set(row) },
        separator,
        { label: t('shared.tree.cut'), icon: 'content_cut', shortcut: 'Mod+X', action: () => this.actions.cut(key, [row]) },
        ...(isFolder ? [] : [{ label: t('shared.tree.copy'), icon: 'content_copy', shortcut: 'Mod+C', action: () => this.actions.copy(key, [row]) }]),
        {
          label: t('shared.tree.paste'),
          icon: 'content_paste',
          shortcut: 'Mod+V',
          disabled: !this.actions.canPaste(key, this.tree(), pasteTarget),
          action: () => void this.actions.paste(key, this.tree(), pasteTarget),
        },
        { label: t('shared.tree.moveTo'), icon: 'drive_file_move', action: () => this.moveRows([row]) },
        separator,
      );
    }
    const on = this.favorites.isFavorite(row.uuid);
    items.push({ label: t(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: row.name }), icon: 'star', action: () => this.actions.toggleFavorite(row) });
    if (editable && !isFolder) {
      items.push({ label: t('pages.tree.duplicate'), icon: 'content_copy', action: () => void this.actions.duplicate(key, row) });
    }
    if (editable && this.permissions.canRelease()) {
      items.push({ label: t('pages.bulk.release'), icon: 'publish', action: () => void this.releaseRows([row]) });
    }
    if (editable) {
      items.push(separator, { label: t('pages.bulk.delete'), icon: 'delete', danger: true, shortcut: 'Del', action: () => void this.deleteRows([row]) });
    }
    return items;
  }

  /** A right click on empty space acts as one on the open folder: only the *New …* options. */
  protected readonly emptyMenu = (): ContextMenuItem[] =>
    this.readOnly()
      ? []
      : [
          { label: this.transloco.translate('pages.folder.newPage'), icon: 'note_add', action: () => this.newPage() },
          { label: this.transloco.translate('pages.folder.newFolder'), icon: 'create_new_folder', action: () => this.newFolder() },
        ];

  protected readonly bulkActions = computed<SfDataTableBulkAction<FolderRow>[]>(() => {
    const t = (id: string) => this.transloco.translate(`pages.bulk.${id}`);
    const actions: SfDataTableBulkAction<FolderRow>[] = [];
    if (!this.readOnly()) {
      actions.push({ id: 'move', label: t('move'), icon: 'drive_file_move', action: (s) => this.moveRows(s.rows) });
    }
    if (this.permissions.canRelease() && !this.readOnly()) {
      actions.push({ id: 'release', label: t('release'), icon: 'publish', action: (s) => void this.releaseRows(s.rows) });
    }
    if (!this.readOnly()) {
      actions.push(
        { id: 'duplicate', label: t('duplicate'), icon: 'content_copy', action: (s) => this.duplicateRows(s.rows) },
        { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: (s) => void this.deleteRows(s.rows) },
      );
    }
    return actions;
  });

  /** The folder's ⋮ menu; the root has no rename, move or delete. */
  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (id: string) => this.transloco.translate(`pages.folder.menu.${id}`);
    const items: SfMenuItem[] = [{ id: 'settings', label: t('settings'), icon: 'settings' }];
    if (!this.isRoot()) {
      items.push(
        { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', disabled: this.readOnly() },
        { id: 'move', label: t('move'), icon: 'drive_file_move', disabled: this.readOnly() },
        { id: 'copyLink', label: t('copyLink'), icon: 'link' },
        { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled: this.readOnly() },
      );
    } else {
      items.push({ id: 'copyLink', label: t('copyLink'), icon: 'link' });
    }
    return items;
  });

  constructor() {
    // The frame's breadcrumb ends with the open folder, with the folders above it as links.
    useFrameItem(() => (this.isRoot() ? null : { label: this.title(), trail: this.trail(), asset: this.folder()?.uuid ? { uuid: this.folder()!.uuid! } : undefined }));

    effect(() => {
      const key = this.projectKey();
      if (key) {
        untracked(() => this.store.loadFor(key).subscribe());
      }
    });

    // The pages of the folder, again after a release, an undo or a change of revision.
    effect(() => {
      const key = this.projectKey();
      const folder = this.listUuid();
      this.releaseEvents.version();
      this.treeRefresh.version();
      const revision = this.timeTravel.activeRevision();
      if (!key || folder === null) {
        return;
      }
      untracked(() => this.read(key, folder, revision));
    });

    // The registered page URLs for the URL column: one request per load of the folder, only while the column is shown.
    effect(() => {
      const key = this.projectKey();
      const folder = this.listUuid();
      const shown = this.developerMode.enabled();
      this.releaseEvents.version();
      this.treeRefresh.version();
      this.timeTravel.activeRevision();
      if (!key || folder === null || !shown) {
        return;
      }
      untracked(() => {
        this.urlsRead?.unsubscribe();
        this.urlsRead = this.pageUrls.registered(key).subscribe((urls) => this.registeredUrls.set(urls));
      });
    });

    inject(ShortcutService).use([
      {
        id: 'folder.rename',
        keys: 'F2',
        scope: 'screen',
        group: 'screen',
        description: 'pages.folder.menu.rename',
        enabled: () => !this.isRoot() && !this.readOnly(),
        handler: () => this.openSettings(true),
      },
    ]);
  }

  protected retry(): void {
    this.treeRefresh.notify();
  }

  private read(key: string, folder: string, revision: number | null): void {
    this.loading.set(true);
    this.failed.set(false);
    this.pagesRead?.unsubscribe();
    this.pagesRead = this.api.listPages(key, { folder, revision: revision ?? undefined }).subscribe({
      next: (pages) => {
        this.pages.set(pages ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  protected open(row: FolderRow): void {
    if (row.kind === 'folder') {
      this.openFolder.emit(row.uuid);
    } else {
      this.openPage.emit(row.uuid);
    }
  }

  protected crumbOf(index: number): string | null {
    return this.trail()[index]?.queryParams?.['folder'] ?? null;
  }

  /** A page's address: its registered URL, else the computed one (`registered: false`); a folder has none. */
  protected addressOf(row: FolderRow): PageAddress | null {
    return row.kind === 'page' ? pageAddress(this.registeredUrls(), row.uuid, row.path, row.uid) : null;
  }

  protected urlOf(row: FolderRow): string {
    return this.addressOf(row)?.url ?? row.path;
  }

  protected statuses(row: FolderRow) {
    return localeStatuses(row.release).map((entry) => ({
      key: entry.key,
      tag: localeTag(entry.key),
      label: statusLabel(entry.status),
      tone: releaseTone(entry.status),
    }));
  }

  // ── Header actions ─────────────────────────────────────────────────────────

  protected onMenu(item: SfMenuItem): void {
    switch (item.id) {
      case 'settings':
        this.openSettings(false);
        break;
      case 'rename':
        this.openSettings(true);
        break;
      case 'move':
        this.dialog.set({ kind: 'move', rows: this.ownRow() });
        break;
      case 'copyLink':
        void this.copyLink();
        break;
      case 'delete':
        void this.deleteOwn();
        break;
    }
  }

  protected openSettings(rename: boolean): void {
    this.settingsRename.set(rename);
    this.settingsOpen.set(true);
  }

  private ownRow(): FolderRow[] {
    const folder = this.folder();
    return folder?.uuid ? folderRows([folder], []) : [];
  }

  private async copyLink(): Promise<void> {
    const uuid = this.isRoot() ? null : this.folder()?.uuid;
    const url = `${window.location.origin}/p/${this.projectKey()}/pages${uuid ? `?folder=${uuid}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toasts.show(this.transloco.translate('pages.folder.linkCopied'), 'success');
    } catch {
      this.toasts.show(this.transloco.translate('pages.folder.linkFailed'), 'error');
    }
  }

  protected onSettingsChanged(): void {
    this.store.loadFor(this.projectKey(), true).subscribe();
    this.treeRefresh.notify();
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  protected readonly pageTemplates = computed(() => this.store.pageTemplates());

  /** Opens *New page*; `into` is a sub-folder to create it in (default: the open folder). */
  protected newPage(into: string | null = null): void {
    if (!this.readOnly()) {
      this.createIn.set(into);
      this.newPageOpen.set(true);
    }
  }

  protected newFolder(into: string | null = null): void {
    if (!this.readOnly()) {
      this.createIn.set(into);
      this.newFolderOpen.set(true);
    }
  }

  /** The folder new items are created in (`undefined` = the project root). */
  private target(): string | undefined {
    return this.createIn() ?? (this.isRoot() ? undefined : (this.folder()?.uuid ?? undefined));
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected renameTo(row: FolderRow, name: string): void {
    this.renameBusy.set(true);
    this.actions.rename(this.projectKey(), row, name).subscribe((done) => {
      this.renameBusy.set(false);
      if (done) {
        this.renaming.set(null);
      }
    });
  }

  protected submitNewPage(value: CreateAssetFormValue): void {
    this.creating.set(true);
    this.api.createPage(this.projectKey(), { displayName: value.displayName, templateUuid: value.templateUuid, folderUuid: this.target() }).subscribe({
      next: () => {
        this.creating.set(false);
        this.newPageOpen.set(false);
        this.toasts.show(this.transloco.translate('pages.folder.pageCreated'), 'success');
        this.treeRefresh.notify();
      },
      error: () => {
        this.creating.set(false);
        this.toasts.show(this.transloco.translate('pages.folder.pageFailed'), 'error');
      },
    });
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    this.creating.set(true);
    this.api.createFolder(this.projectKey(), { displayName: value.displayName, parentFolderUuid: this.target(), scope: 'PAGES' }).subscribe({
      next: () => {
        this.creating.set(false);
        this.newFolderOpen.set(false);
        this.toasts.show(this.transloco.translate('pages.folder.folderCreated'), 'success');
        this.onSettingsChanged();
      },
      error: () => {
        this.creating.set(false);
        this.toasts.show(this.transloco.translate('pages.folder.folderFailed'), 'error');
      },
    });
  }

  // ── Release ────────────────────────────────────────────────────────────────

  /** *Release folder…*: everything in the folder that has something to release. */
  protected releaseFolder(): void {
    void this.releaseRows(this.rows());
  }

  /** Pages release as they are; a folder with everything inside it (recursively). */
  private async releaseRows(rows: readonly FolderRow[]): Promise<void> {
    const choices = await this.actions.releaseDialogChoices(this.projectKey(), this.tree(), rows);
    if (choices) {
      this.dialog.set({ kind: 'release', choices });
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  private moveRows(rows: readonly FolderRow[]): void {
    this.dialog.set({ kind: 'move', rows });
  }

  protected excludedFolders(rows: readonly FolderRow[]): string[] {
    return rows.filter((row) => row.kind === 'folder').map((row) => row.uuid);
  }

  protected onMoveChosen(rows: readonly FolderRow[], target: string | null): void {
    this.dialog.set(null);
    const key = this.projectKey();
    const back = moveBackBody(this.folder(), this.wrapper()?.uuid);
    const toRoot = target === null || target === this.wrapper()?.uuid;
    const body = toRoot ? {} : { folderUuid: target! };
    const done: FolderRow[] = [];
    const run = concat(
      ...rows.map((row) =>
        defer(() => this.moveOne(key, row, body)).pipe(
          tap(() => done.push(row)),
        ),
      ),
    ).pipe(last(undefined, undefined));
    run.subscribe({
      next: () => this.afterMove(key, done, back),
      error: () => {
        // What moved before the failure stays moved and stays undoable.
        this.afterMove(key, done, back);
        this.toasts.show(this.transloco.translate('pages.bulk.moveFailed'), 'error');
      },
    });
  }

  private moveOne(key: string, row: FolderRow, body: { folderUuid?: string }): Observable<unknown> {
    return row.kind === 'folder' ? this.api.moveFolder(key, row.uuid, body) : this.api.moveAsset(key, row.uuid, body);
  }

  private afterMove(key: string, moved: readonly FolderRow[], back: { folderUuid?: string }): void {
    if (moved.length > 0) {
      const steps: UndoStep[] = moved.map((row) => () => this.moveOne(key, row, back).pipe(tap(() => this.treeRefresh.notify())));
      this.undo.offerGroup(this.transloco.translate(moved.length === 1 ? 'pages.bulk.movedOne' : 'pages.bulk.moved', { count: moved.length, name: moved[0].name }), steps);
    }
    this.onSettingsChanged();
  }

  // ── Duplicate ──────────────────────────────────────────────────────────────

  private duplicateRows(rows: readonly FolderRow[]): void {
    const pages = rows.filter((row) => row.kind === 'page');
    if (pages.length === 0) {
      this.toasts.show(this.transloco.translate('pages.bulk.foldersNotDuplicated'), 'info');
      return;
    }
    const key = this.projectKey();
    const copies: string[] = [];
    concat(
      ...pages.map((page) =>
        defer(() => this.api.duplicateAsset(key, page.uuid)).pipe(
          tap((copy) => {
            if (copy.uuid) {
              copies.push(copy.uuid);
            }
          }),
        ),
      ),
    )
      .pipe(last(undefined, undefined))
      .subscribe({
        next: () => this.afterDuplicate(key, copies, rows.length - pages.length),
        error: () => {
          this.afterDuplicate(key, copies, 0);
          this.toasts.show(this.transloco.translate('pages.bulk.duplicateFailed'), 'error');
        },
      });
  }

  private afterDuplicate(key: string, copies: readonly string[], skippedFolders: number): void {
    if (copies.length > 0) {
      const steps: UndoStep[] = copies.map((uuid) => () => this.api.deleteAsset(key, uuid).pipe(tap(() => this.treeRefresh.notify())));
      const message = this.transloco.translate(skippedFolders > 0 ? 'pages.bulk.duplicatedSkipped' : copies.length === 1 ? 'pages.bulk.duplicatedOne' : 'pages.bulk.duplicated', { count: copies.length, skipped: skippedFolders });
      this.undo.offerGroup(message, steps);
    }
    this.treeRefresh.notify();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private async deleteOwn(): Promise<void> {
    const folder = this.folder();
    if (!folder?.uuid || this.isRoot()) {
      return;
    }
    const rows = folderRows([folder], []);
    const deleted = await this.confirmAndDelete(rows, this.pageCount() + this.folderCount());
    if (deleted) {
      this.openFolder.emit(null);
    }
  }

  private async deleteRows(rows: readonly FolderRow[]): Promise<void> {
    await this.confirmAndDelete(rows, rows.length);
  }

  /** Confirms (the word `delete` from 25 items on), deletes in order, and offers one Undo for the group. */
  private async confirmAndDelete(rows: readonly FolderRow[], count: number): Promise<boolean> {
    if (rows.length === 0 || this.readOnly()) {
      return false;
    }
    const names = rows.map((row) => row.name);
    const confirmed = await this.confirms.confirm({
      title: this.transloco.translate(rows.length === 1 ? 'pages.bulk.deleteTitleOne' : 'pages.bulk.deleteTitle', { count: rows.length, name: names[0] }),
      message: deleteQuestion(
        this.transloco.translate(rows.some((row) => row.kind === 'folder') ? 'pages.bulk.deleteMessageFolders' : 'pages.bulk.deleteMessage'),
        rows.find((row) => isOnline(row.release))?.release ?? null,
      ),
      confirmLabel: this.transloco.translate(rows.length === 1 ? 'pages.bulk.deleteConfirmOne' : 'pages.bulk.deleteConfirm', { count: rows.length }),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(count),
      details: names.slice(0, 12),
    });
    if (!confirmed) {
      return false;
    }
    const key = this.projectKey();
    const done: FolderRow[] = [];
    const deleteOne = (row: FolderRow): Observable<unknown> =>
      row.kind === 'folder' ? this.api.deleteFolder(key, row.uuid, true) : this.api.deleteAsset(key, row.uuid);
    const outcome = await new Promise<boolean>((resolve) => {
      concat(...rows.map((row) => defer(() => deleteOne(row)).pipe(tap(() => done.push(row)))))
        .pipe(last(undefined, undefined))
        .subscribe({ next: () => resolve(true), error: () => resolve(false) });
    });
    if (done.length > 0) {
      // One restore per item, a folder's with its whole subtree; undone last to first.
      const steps: UndoStep[] = done.map((row) => () =>
        (row.kind === 'folder' ? (this.api.restoreFolder(key, row.uuid) as Observable<unknown>) : (restoreDeletedAsset(this.api, key, row.uuid) as Observable<unknown>)).pipe(tap(() => this.treeRefresh.notify())),
      );
      this.undo.offerGroup(this.transloco.translate(this.deletedKey(done), { count: done.length, name: done[0].name }), steps);
    }
    if (!outcome) {
      this.toasts.show(this.transloco.translate('pages.bulk.deleteFailed'), 'error');
    }
    this.onSettingsChanged();
    return outcome;
  }

  private deletedKey(done: readonly FolderRow[]): string {
    if (done.length > 1) {
      return 'pages.bulk.deleted';
    }
    return done[0].kind === 'folder' ? 'pages.bulk.deletedFolder' : 'pages.bulk.deletedOne';
  }

  protected releaseDone(): void {
    this.dialog.set(null);
    this.treeRefresh.notify();
  }


}
