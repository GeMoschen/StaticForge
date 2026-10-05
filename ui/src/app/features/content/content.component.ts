import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { type Observable, Subscription, filter, forkJoin, map, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FAVORITES_NODE, FavoriteTreeService, isFavoriteNode } from '../../core/assets/favorite-tree.service';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import {
  type SfTreeAction,
  SfTreeComponent,
  type SfTreeCreateRequest,
  type SfTreeDeleteRequest,
  type SfTreeMoveRequest,
  type SfTreeNameContext,
  type SfTreeRenameRequest,
} from '../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../shared/components/tree/tree-model';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { FolderMoveDialogComponent } from '../pages/folder-move-dialog.component';
import type { ReleaseChoice } from '../release/release-choice.util';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';
import { ContentFolderViewComponent } from './content-folder-view.component';
import { ContentItemActions } from './content-item-actions.service';
import { ContentStoreRefresh } from './content-store-refresh.service';
import { releaseChoicesOf } from './content-release.util';
import {
  type ContentEntry,
  type ContentNodeOptions,
  EMPTY_INDEX,
  RECORD_SET_ICON,
  buildIndex,
  childEntries,
  childNodes,
  foldersOnly,
  idPath,
  isChildRoute,
  isEmptyIndex,
  searchPaths,
  setUuidFromUrl,
} from './content-tree.util';
import {
  ContentService,
  type DatasetSummaryView,
  type FolderView,
  type RecordSetSummaryView,
} from './content.service';

const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * Content store (M19.4.1, record sets since M25.5.1): Content folders holding **record sets**, each of one dataset and
 * holding that dataset's records. The area (M35.20): the tree on the left, and in the main pane the open record set or
 * record (the router outlet), the open folder's table, or the Favorites list.
 *
 * <p>The tree (`sf-tree`) holds folders and, as leaves, the record sets in them — with their record count, a badge when
 * a set's stored query no longer validates and its release status — and loads lazily from the folder tree and set list
 * this screen keeps in memory, so its filter is answered locally. A *Favorites* node is pinned on top while the project
 * has favorites. Selecting a set opens the set view (a child route: query panel and record grid); a record opens in the
 * record editor, another child route, so the tree stays where it is. The open folder is in the URL (`?folder=`), so it is
 * recorded as a recent and survives a reload.
 *
 * <p>Datasets are defined by developers in the Templates store; with none defined the store explains that and links
 * developers there. Every create, rename, move and delete control is disabled in time travel and for viewers; each change
 * offers one Undo (M35.13), and the tree and the folder table read the store again when anything changed
 * (`ContentStoreRefresh`).
 */
@Component({
  selector: 'sf-content',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ContentFolderViewComponent,
    FavoritesViewComponent,
    FolderMoveDialogComponent,
    ReleaseDialogComponent,
    RouterOutlet,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfMenuComponent,
    SfRenameAssetDialogComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  providers: [ContentStoreRefresh],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
})
export class ContentComponent {
  readonly projectKey = input.required<string>();
  /** `?folder=<uuid>` is the open folder (kept in the URL, so recents and deep links find it). */
  readonly folder = input<string | undefined>();
  /** `?favorites=1` shows the Favorites list. */
  readonly favoritesParam = input<string | undefined>(undefined, { alias: 'favorites' });

  private readonly content = inject(ContentService);
  private readonly api = inject(ApiClient);
  private readonly actions = inject(ContentItemActions);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly refresh = inject(ContentStoreRefresh);
  private readonly projectContext = inject(ProjectContextStore);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly favorites = inject(FavoritesService);
  private readonly favoriteTree = inject(FavoriteTreeService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly developerMode = inject(DeveloperModeService);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly locales = inject(LocalesStore);

  /** Creating, renaming, moving and deleting: editors, outside time travel and archived projects. */
  protected readonly canEdit = this.permissions.canEditContent;
  protected readonly isDeveloper = computed(() => this.developerMode.enabled() && this.permissions.canEditTemplates());

  private readonly tree = viewChild<SfTreeComponent<ContentEntry>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  /** Record sets are copied (a new set on the same dataset and query, without records); folders are only moved. */
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'copy', 'create'];

  // ── Data ───────────────────────────────────────────────────────────────────

  protected readonly folders = signal<FolderView[]>([]);
  protected readonly datasets = signal<DatasetSummaryView[]>([]);
  private readonly sets = signal<RecordSetSummaryView[]>([]);
  /** The first read of the store returned (until then the tree and the empty states say nothing). */
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly index = computed(() => (this.loaded() ? buildIndex(this.folders(), this.sets()) : EMPTY_INDEX));
  /** The folder tree without record sets: where a move can go. */
  protected readonly folderTree = computed(() => foldersOnly(this.folders()));

  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly nodeOptions = computed<ContentNodeOptions>(() => {
    this.language();
    const t = (key: string) => this.transloco.translate(`content.tree.status.${key}`);
    return {
      dev: this.developerMode.enabled(),
      locale: this.editingLocale.locale(),
      invalidQuery: this.transloco.translate('content.tree.invalidQuery'),
      labels: {
        released: t('released'),
        changed: t('changed'),
        draft: t('draft'),
        scheduled: t('scheduled'),
        unpublished: t('unpublished'),
        deletion: t('deletion'),
      },
    };
  });

  // ── What is open ───────────────────────────────────────────────────────────

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** A record set or a record is open in the router outlet. */
  protected readonly childOpen = computed(() => isChildRoute(this.url()));
  private readonly setUuid = computed(() => setUuidFromUrl(this.url()));
  protected readonly mode = computed<'child' | 'favorites' | 'folder'>(() =>
    this.childOpen() ? 'child' : this.favoritesParam() ? 'favorites' : 'folder',
  );
  protected readonly folderUuid = computed(() => (this.mode() === 'folder' ? (this.folder() ?? null) : null));

  protected readonly treeSelection = computed<string[]>(() => {
    const set = this.setUuid();
    if (set) {
      return [set];
    }
    if (this.mode() === 'favorites') {
      return [FAVORITES_NODE];
    }
    const folder = this.folderUuid();
    return folder ? [folder] : [];
  });

  /** A store with no folders and no record sets: the main pane explains what to do. */
  protected readonly emptyStore = computed(() => this.loaded() && !this.failed() && isEmptyIndex(this.index()));
  protected readonly noDatasets = computed(() => this.datasets().length === 0);
  protected readonly emptyKind = computed(() => (this.noDatasets() ? (this.isDeveloper() ? 'developer' : 'editor') : 'recordSets'));
  protected readonly primaryLabel = computed<string | null>(() => {
    this.language();
    if (!this.canEdit()) {
      return null;
    }
    if (!this.noDatasets()) {
      return this.transloco.translate('content.shell.empty.newRecordSet');
    }
    return this.isDeveloper() ? this.transloco.translate('content.shell.empty.goTemplates') : null;
  });

  // ── Tree wiring ────────────────────────────────────────────────────────────

  protected readonly loader = computed<SfTreeLoader<ContentEntry>>(() => {
    const index = this.index();
    const options = this.nodeOptions();
    const favorites = this.favorites.list();
    const key = this.projectKey();
    const label = this.transloco.translate('content.tree.favorites');
    return (parent) => {
      if (parent === null) {
        const nodes = childNodes(index, null, options);
        return favorites.length > 0 ? [this.favoriteTree.rootNode<ContentEntry>(label), ...nodes] : nodes;
      }
      if (parent.id === FAVORITES_NODE) {
        return this.favoriteTree.nodes<ContentEntry>(favorites);
      }
      if (isFavoriteNode(parent.id)) {
        return this.favoriteTree.children<ContentEntry>(key, parent);
      }
      return childNodes(index, parent.id, options);
    };
  });

  protected readonly search = (query: string): readonly (readonly string[])[] => searchPaths(this.index(), query);

  /** The *Favorites* branch is a view: nothing in it is renamed, deleted, moved or created. */
  protected readonly allowAction = (action: SfTreeAction, nodes: readonly SfTreeNode<ContentEntry>[]): boolean =>
    this.canEdit() &&
    !nodes.some((node) => isFavoriteNode(node.id)) &&
    (action !== 'copy' || nodes.every((node) => node.data?.kind === 'set'));

  /** Nothing goes into a favorite, only into a real folder (the tree's own rules cover the rest). */
  protected readonly canDrop = (_dragged: readonly SfTreeNode<ContentEntry>[], target: SfTreeNode<ContentEntry> | null): boolean =>
    target === null || !isFavoriteNode(target.id);

  /** A name is free among the siblings of its kind (the server enforces it for UIDs; this answers before the round trip). */
  protected readonly validateName = (name: string, context: SfTreeNameContext<ContentEntry>): string | null => {
    const kind = context.node?.data?.kind ?? 'folder';
    const taken = childEntries(this.index(), context.parent?.id ?? null).some(
      (sibling) => sibling.uuid !== context.node?.id && sibling.kind === kind && sibling.name.toLowerCase() === name.toLowerCase(),
    );
    return taken ? this.transloco.translate('content.tree.nameTaken') : null;
  };

  protected readonly confirmDelete = (nodes: readonly SfTreeNode<ContentEntry>[]): Promise<boolean> =>
    this.actions.confirmDelete(
      nodes.flatMap((node) => (node.data ? [node.data] : [])),
      this.injector,
    );

  /**
   * The host's entries of the one menu, between the tree's own (*New folder*, *Rename*, *Cut*, *Paste*, *Move to…*) and
   * *Delete*: *New record set* in a folder; *New record*, *History* and *Used by* on a record set; *Add to favorites*.
   */
  protected readonly menuItems = (nodes: readonly SfTreeNode<ContentEntry>[]): ContextMenuItem[] => {
    if (nodes.length === 0 || nodes.some((node) => !node.data || isFavoriteNode(node.id))) {
      return [];
    }
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const items: ContextMenuItem[] = [];
    const release: ContextMenuItem = {
      label: t('content.tree.release'),
      icon: 'publish',
      action: () => this.releaseEntries(nodes.flatMap((node) => (node.data ? [node.data] : []))),
    };
    const node = nodes.length === 1 ? nodes[0] : null;
    const entry = node?.data;
    if (!node || !entry) {
      return this.permissions.canRelease() ? [release] : [];
    }
    if (this.canEdit() && entry.kind === 'folder') {
      items.push({
        label: t('content.tree.newRecordSet'),
        icon: 'playlist_add',
        disabled: this.noDatasets(),
        action: () => this.openNewSet(node.id),
      });
    }
    if (entry.kind === 'set') {
      if (this.canEdit()) {
        items.push({ label: t('content.tree.newRecord'), icon: 'post_add', action: () => this.openSet(node.id, { newRecord: '1' }) });
      }
      items.push(
        { label: t('content.tree.history'), icon: 'history', action: () => this.openSet(node.id, { panel: 'history' }) },
        { label: t('content.tree.usedBy'), icon: 'link', action: () => this.openSet(node.id, { panel: 'usages' }) },
      );
    }
    const on = this.favorites.isFavorite(node.id);
    items.push({
      label: t(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: node.label }),
      icon: 'star',
      action: () => this.toggleFavorite(node),
    });
    if (this.permissions.canRelease()) {
      items.push(release);
    }
    return items;
  };

  /** A right click on empty space acts as one on the root folder: only the *New …* options. */
  protected readonly rootMenuItems = (): ContextMenuItem[] =>
    !this.canEdit()
      ? []
      : [
          { label: this.transloco.translate('content.tree.newFolder'), icon: 'create_new_folder', action: () => void this.tree()?.startCreate(null, 'folder') },
          ...(this.noDatasets() ? [] : [{ label: this.transloco.translate('content.tree.newRecordSet'), icon: 'playlist_add', action: () => this.openNewSet(null) }]),
        ];

  /** The head's *New* menu: where it creates is the open folder (or the folder of the open set). */
  protected readonly newItems = computed<SfMenuItem[]>(() => {
    this.language();
    return [
      {
        id: 'folder',
        label: this.transloco.translate('content.tree.newFolder'),
        icon: 'create_new_folder',
        action: () => void this.tree()?.startCreate(this.openFolderUuid(), 'folder'),
      },
      {
        id: 'set',
        label: this.transloco.translate('content.tree.newRecordSet'),
        icon: 'playlist_add',
        disabled: this.noDatasets(),
        disabledReason: this.noDatasets() ? this.transloco.translate('content.tree.noDatasets') : undefined,
        action: () => this.openNewSet(this.openFolderUuid()),
      },
    ];
  });

  // ── Dialogs ────────────────────────────────────────────────────────────────

  protected readonly newFolderOpen = signal(false);
  protected readonly newSetOpen = signal(false);
  protected readonly creating = signal(false);
  /** The folder the open "New …" dialog creates into (`null` = the store root). */
  private createTarget: string | null = null;
  protected readonly moving = signal<readonly ContentEntry[] | null>(null);
  protected readonly renaming = signal<ContentEntry | null>(null);
  protected readonly renameBusy = signal(false);
  protected readonly releaseChoices = signal<ReleaseChoice[] | null>(null);

  constructor() {
    // The store again whenever something changed: a create, move, delete or undo, a record added in the set view, a release.
    effect(() => {
      const key = this.projectKey();
      this.refresh.tick();
      this.releaseEvents.version();
      if (key) {
        untracked(() => this.reload(key));
      }
    });

    // An open editor's release bar read a new status: the tree row shows it at once (M27.6.1).
    effect(
      () => {
        const observed = this.releaseEvents.observed();
        const next = untracked(() => withObservedRelease(this.sets(), observed));
        if (next) {
          this.sets.set(next);
        }
      },
      { allowSignalWrites: true },
    );

    // Keep the open set or folder visible in the tree (expanding its ancestors).
    effect(() => {
      this.setUuid();
      this.folder();
      this.mode();
      if (this.loaded()) {
        untracked(() => afterNextRender(() => void this.revealOpen(), { injector: this.injector }));
      }
    });
  }

  /** `n` creates a record set (M35.14). */
  private readonly newSetShortcut = inject(ShortcutService).use([
    createShortcut({
      handler: () => (this.canEdit() && !this.noDatasets() ? this.openNewSet(this.openFolderUuid()) : false),
      palette: { label: 'frame.shortcuts.items.createRecordSet' },
    }),
  ]);

  // ── Reading ────────────────────────────────────────────────────────────────

  private storeRead: Subscription | null = null;

  /** The folder tree, the datasets and the record sets; a newer read replaces the one in flight. */
  private reload(key: string): void {
    this.storeRead?.unsubscribe();
    this.storeRead = forkJoin({
      folders: this.content.folders(key),
      datasets: this.content.listDatasets(key),
      sets: this.content.listRecordSets(key),
    }).subscribe({
      next: ({ folders, datasets, sets }) => {
        this.folders.set(folders ?? []);
        // Other screens (export picker, search) read the shared tree: keep it as current as this one.
        this.projectContext.updateContentFolderTree(key, folders ?? []);
        this.datasets.set(datasets ?? []);
        this.sets.set(sets ?? []);
        this.failed.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.failed.set(true);
        this.loaded.set(true);
        this.toasts.show(this.transloco.translate('content.tree.toast.loadFailed'), 'error');
      },
    });
  }

  /** Something changed: the tree and the folder table read the store again. */
  protected changed(): void {
    this.refresh.notify();
  }

  /** The folder an action without a target aims at: the open folder, the folder of the open set, else the root. */
  private openFolderUuid(): string | null {
    const set = this.setUuid();
    if (set) {
      return this.index().parentOf.get(set) ?? null;
    }
    return this.shownFolder();
  }

  /** The open folder, `null` at the store root (and for a uuid that is not in the tree any more). */
  private shownFolder(): string | null {
    const folder = this.folderUuid();
    return folder && this.index().entries.has(folder) ? folder : null;
  }

  private async revealOpen(): Promise<void> {
    const tree = this.tree();
    const index = this.index();
    const set = this.setUuid();
    const id = set ?? (this.mode() === 'folder' ? this.folder() : null);
    if (!tree || !id) {
      return;
    }
    const path = idPath(index, id);
    for (const ancestor of set ? path.slice(0, -1) : path) {
      await tree.expand(ancestor);
    }
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  protected onOpen(node: SfTreeNode<ContentEntry>): void {
    const key = this.projectKey();
    if (node.id === FAVORITES_NODE) {
      void this.router.navigate(['/p', key, 'content'], { queryParams: { favorites: 1 } });
      return;
    }
    if (isFavoriteNode(node.id)) {
      const route = this.favoriteTree.routeOf(key, node);
      if (route) {
        void this.router.navigate([...route.commands], { queryParams: route.queryParams });
      }
      return;
    }
    if (node.data?.kind === 'folder') {
      this.openFolder(node.id);
    } else {
      this.openSet(node.id);
    }
  }

  protected openSet(uuid: string, queryParams: Record<string, string> = {}): void {
    void this.router.navigate(['/p', this.projectKey(), 'content', 'sets', uuid], { queryParams });
  }

  protected openFolder(uuid: string | null): void {
    void this.router.navigate(['/p', this.projectKey(), 'content'], { queryParams: uuid ? { folder: uuid } : {} });
  }

  protected onEmptyPrimary(): void {
    if (this.noDatasets()) {
      void this.router.navigate(['/p', this.projectKey(), 'templates'], { queryParams: { kind: 'DATASET' } });
    } else {
      this.openNewSet(null);
    }
  }

  protected createFolderAtRoot(): void {
    void this.tree()?.startCreate(null, 'folder');
  }

  /** The folder view's header *Rename*: the same in-place edit as F2 in the tree. */
  protected renameInTree(uuid: string): void {
    this.tree()?.startRename(uuid);
  }

  // ── Favorites ──────────────────────────────────────────────────────────────

  private toggleFavorite(node: SfTreeNode<ContentEntry>): void {
    const entry = node.data;
    if (!entry) {
      return;
    }
    const on = this.favorites.toggle({
      type: entry.kind === 'folder' ? 'FOLDER' : 'RECORD_SET',
      uuid: entry.uuid,
      displayName: entry.name,
      folderPath: entry.path,
    });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name: node.label }), 'info');
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /** A folder created in place in the tree. */
  protected onCreate(request: SfTreeCreateRequest<ContentEntry>): void {
    if (request.kind !== 'folder' || !this.canEdit()) {
      return;
    }
    this.content.createFolder(this.projectKey(), request.name, request.parent?.id).subscribe({
      next: (created) => {
        this.toasts.show(this.transloco.translate('content.tree.toast.folderCreated', { name: request.name }), 'success');
        this.changed();
        if (request.parent) {
          void this.tree()?.expand(request.parent.id);
        }
        if (created.uuid) {
          this.openFolder(created.uuid);
        }
      },
      error: () => this.toasts.show(this.transloco.translate('content.tree.toast.folderCreateFailed'), 'error'),
    });
  }

  /** The folder view's *New folder*. */
  protected openNewFolder(): void {
    if (this.canEdit()) {
      this.createTarget = this.shownFolder();
      this.newFolderOpen.set(true);
    }
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    if (!this.canEdit()) {
      return;
    }
    this.creating.set(true);
    this.content.createFolder(this.projectKey(), value.displayName, this.createTarget ?? undefined).subscribe({
      next: (created) => {
        this.creating.set(false);
        this.newFolderOpen.set(false);
        this.toasts.show(this.transloco.translate('content.tree.toast.folderCreated', { name: value.displayName }), 'success');
        this.changed();
        if (created.uuid) {
          this.openFolder(created.uuid);
        }
      },
      error: () => {
        this.creating.set(false);
        this.toasts.show(this.transloco.translate('content.tree.toast.folderCreateFailed'), 'error');
      },
    });
  }

  /** Opens the "New record set" dialog; it creates in `folderUuid` (`null` = the store root). */
  protected openNewSet(folderUuid: string | null): void {
    if (this.canEdit() && !this.noDatasets()) {
      this.createTarget = folderUuid;
      this.newSetOpen.set(true);
    }
  }

  /** A folder table row's *New folder*: creates inside that folder. */
  protected openNewFolderIn(folderUuid: string): void {
    if (this.canEdit()) {
      this.createTarget = folderUuid;
      this.newFolderOpen.set(true);
    }
  }

  /** The folder view's *New record set* creates in the folder it shows. */
  protected openNewSetHere(): void {
    this.openNewSet(this.shownFolder());
  }

  protected submitNewSet(value: CreateAssetFormValue): void {
    if (!this.canEdit() || !value.datasetUuid) {
      return;
    }
    this.creating.set(true);
    this.content
      .createRecordSet(this.projectKey(), {
        folderUuid: this.createTarget ?? undefined,
        datasetUuid: value.datasetUuid,
        uid: value.uid,
        displayName: value.displayName,
      })
      .subscribe({
        next: (created) => {
          this.creating.set(false);
          this.newSetOpen.set(false);
          this.toasts.show(this.transloco.translate('content.tree.toast.recordSetCreated', { name: value.displayName }), 'success');
          this.changed();
          if (created.uuid) {
            this.openSet(created.uuid);
          }
        },
        error: (err: unknown) => {
          this.creating.set(false);
          const detail = err instanceof HttpErrorResponse ? (err.error as { detail?: string } | null)?.detail : undefined;
          this.toasts.show(detail ?? this.transloco.translate('content.tree.toast.recordSetCreateFailed'), 'error');
        },
      });
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected onRename(request: SfTreeRenameRequest<ContentEntry>): void {
    const entry = request.node.data;
    if (entry) {
      this.rename(entry, request.name);
    }
  }

  private rename(entry: ContentEntry, name: string, done?: () => void): void {
    if (!this.canEdit()) {
      return;
    }
    const key = this.projectKey();
    const from = entry.name;
    const call = (displayName: string, etag?: number): Observable<{ revision?: number }> =>
      entry.kind === 'folder'
        ? this.api.renameFolder(key, entry.uuid, { displayName }, etag)
        : this.api.renameAsset(key, entry.uuid, { displayName }, etag);
    call(name).subscribe({
      next: (renamed) => {
        const message = this.transloco.translate('content.tree.toast.renamed', { from, to: name });
        // Undo renames back; the etag is the revision the rename produced.
        this.undo.offer(message, () => call(from, renamed.revision).pipe(tap(() => this.changed())));
        this.changed();
        done?.();
      },
      error: () => {
        this.renameBusy.set(false);
        this.toasts.show(this.transloco.translate('content.tree.toast.renameFailed', { name: from }), 'error');
      },
    });
  }

  /** A folder table row's *Rename…*: the shared rename dialog. */
  protected openRenameDialog(entry: ContentEntry): void {
    if (this.canEdit()) {
      this.renaming.set(entry);
    }
  }

  protected renameDisplayName(name: string): void {
    const entry = this.renaming();
    if (!entry) {
      return;
    }
    this.renameBusy.set(true);
    this.rename(entry, name, () => {
      this.renameBusy.set(false);
      this.renaming.set(null);
    });
  }

  // ── Release ────────────────────────────────────────────────────────────────

  /** *Release…* on tree or table entries: a folder with everything inside it; nothing to release only says so. */
  protected releaseEntries(entries: readonly ContentEntry[]): void {
    const choices = releaseChoicesOf(this.index(), entries, this.editingLocale.locale(), (code) => this.locales.labelOf(code));
    if (choices.length === 0) {
      this.toasts.show(this.transloco.translate('content.tree.nothingToRelease'), 'info');
      return;
    }
    this.releaseChoices.set(choices);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  protected onDelete(request: SfTreeDeleteRequest<ContentEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void (async () => {
      const change = await this.actions.delete(this.projectKey(), entries);
      if (change.done.length > 0) {
        this.leaveDeleted(change.done.map((entry) => entry.uuid));
      }
      this.changed();
      if (change.failed) {
        // What was deleted before the failure stays deleted and stays undoable.
        this.toasts.show(this.transloco.translate('content.tree.toast.deleteFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
        if (change.done.length > 0) {
          this.undo.offerGroup(this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].name }), this.withRefresh(change.steps));
        }
        return;
      }
      request.completed(() => void this.actions.runUndo(this.withRefresh(change.steps)));
    })();
  }

  /** What is open was deleted: the area goes back to the folder it was in. */
  private leaveDeleted(uuids: readonly string[]): void {
    const index = this.index();
    const open = this.setUuid() ?? this.folder() ?? null;
    if (open && uuids.some((uuid) => uuid === open || idPath(index, open).includes(uuid))) {
      this.openFolder(null);
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  /** Drag and drop and cut + paste in the tree. */
  protected onMove(request: SfTreeMoveRequest<ContentEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    if (request.copy) {
      void this.copyEntries(entries, request.target?.id ?? null, (steps) => request.completed(steps ? () => void this.actions.runUndo(steps) : undefined));
      return;
    }
    void this.transfer(entries, request.target?.id ?? null, (steps) => request.completed(steps ? () => void this.actions.runUndo(steps) : undefined));
  }

  /** The tree's *Move to…*: a picker for the destination. */
  protected openMoveDialog(nodes: SfTreeNode<ContentEntry>[]): void {
    this.moving.set(nodes.flatMap((node) => (node.data ? [node.data] : [])));
  }

  protected movingFolders(): string[] {
    return (this.moving() ?? []).filter((entry) => entry.kind === 'folder').map((entry) => entry.uuid);
  }

  protected onMoveChosen(target: string | null): void {
    const entries = this.moving();
    this.moving.set(null);
    if (!entries) {
      return;
    }
    const to = target === this.index().rootUuid ? null : target;
    void this.transfer(entries, to, (steps) => {
      const message = this.transloco.translate('shared.tree.moved', { count: entries.length, name: entries[0]?.name ?? '' });
      if (steps) {
        this.undo.offerGroup(message, steps);
      } else {
        this.toasts.show(message, 'success');
      }
    });
  }

  /**
   * Moves into the folder `target` (`null` = the store root). Undo moves back. Stops at the first failure; what was done
   * up to there stays and is announced.
   */
  private async transfer(entries: readonly ContentEntry[], target: string | null, completed: (undo?: UndoStep[]) => void): Promise<void> {
    const index = this.index();
    const change = await this.actions.move(this.projectKey(), entries, target, (entry) => index.parentOf.get(entry.uuid) ?? null);
    this.changed();
    if (change.failed) {
      this.toasts.show(this.transloco.translate('content.tree.toast.moveFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
      if (change.done.length === 0) {
        return;
      }
    }
    completed(change.done.length > 0 ? this.withRefresh(change.steps) : undefined);
  }

  /** Copy + paste in the tree: the record sets are duplicated into `target`; Undo deletes the copies. */
  private async copyEntries(entries: readonly ContentEntry[], target: string | null, completed: (undo?: UndoStep[]) => void): Promise<void> {
    const change = await this.actions.copy(this.projectKey(), entries, target);
    this.changed();
    if (change.failed) {
      this.toasts.show(this.transloco.translate('content.tree.toast.copyFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
    }
    completed(change.steps.length > 0 ? this.withRefresh(change.steps) : undefined);
  }

  /** After an Undo the tree and the table read the store again: the first step is the one that runs last. */
  private withRefresh(steps: readonly UndoStep[]): UndoStep[] {
    return [async () => this.changed(), ...steps];
  }

  /** The icon of a record set, for the empty states. */
  protected readonly setIcon = RECORD_SET_ICON;
}
