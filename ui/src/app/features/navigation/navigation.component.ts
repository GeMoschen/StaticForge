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
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { FAVORITES_NODE, FavoriteTreeService, isFavoriteNode } from '../../core/assets/favorite-tree.service';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
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
  type SfTreeReorderRequest,
} from '../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../shared/components/tree/tree-model';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { assetRoute } from '../../shared/asset-route.util';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { FolderMoveDialogComponent } from '../pages/folder-move-dialog.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { NavEntryDrawerComponent } from './nav-entry-drawer.component';
import { NavFolderViewComponent, type NavVisibilityRequest } from './nav-folder-view.component';
import { NavItemDetailComponent, storedLabel } from './nav-item-detail.component';
import { NavigationItemActions } from './navigation-item-actions.service';
import { NavigationStoreRefresh } from './navigation-store-refresh.service';
import {
  EMPTY_NAV_INDEX,
  type NavEntry,
  type NavNodeOptions,
  type NavUrls,
  buildNavIndex,
  entryFolderPath,
  isEmptyNavIndex,
  navChildren,
  navFolderTree,
  navIdPath,
  navNodes,
  navSearchPaths,
  orderWith,
} from './navigation-tree.util';
import { pickPageUrls } from './navigation-urls.util';
import { NavigationService, type NavTreeView, etagFor } from './navigation.service';

const TREE_WIDTH = 300;
const TREE_WIDTH_NARROW = 260;
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * The Navigation store (M35.22, decisions 23 and 24): the website's menu. The tree (`sf-tree`) on the left shows the menu
 * in its stored order — each entry with where it leads ("Company → /about-us/": the label, then the public URL of its
 * target page) — and can be reordered among siblings by drag before/after and `Alt+↑/↓`, and moved into folders, each with
 * one Undo. A *Favorites* node is pinned on top while the project has favorites. The main pane shows what is selected:
 * a menu folder's table of items with its entry page line, a menu item's detail (label, "Visible in menu", target page as
 * a picker card, public URL), the Favorites list, or "Select a menu item". The tree title opens the fixed "All navigation"
 * wrapper as a folder too, so the menu's own entry page is reachable; *Entry page…* (a folder's ⋮ menu, the tree's context
 * menu, the entry line's *Change…*) opens the entry-page drawer. An entry hidden from the menu stays listed here, muted
 * and marked, until shown again (*Hide from menu* / *Show in menu* on the table's selection and a folder's ⋮ menu).
 *
 * <p>The selection is in the URL (`?asset=<uuid>`, or `?favorites=1`) so a reload, the browser's back button and the
 * recents find it; a change of selection with unsaved edits in the open item asks first (the route's leave guard). The
 * menu is read as one tree (`GET …/navigation/tree`) and kept in memory: the tree loads lazily from it and answers its
 * own filter locally. Every create, rename, move, reorder and delete control is disabled in time travel and for viewers;
 * each change offers one Undo (M35.13), and the area reads the menu again whenever anything changed
 * (`NavigationStoreRefresh`).
 */
@Component({
  selector: 'sf-navigation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FavoritesViewComponent,
    FolderMoveDialogComponent,
    NavEntryDrawerComponent,
    NavFolderViewComponent,
    NavItemDetailComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  providers: [NavigationStoreRefresh],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` is the open menu folder or item (kept in the URL, so recents and deep links find it). */
  readonly asset = input<string | undefined>();
  /** `?favorites=1` shows the Favorites list. */
  readonly favoritesParam = input<string | undefined>(undefined, { alias: 'favorites' });

  private readonly nav = inject(NavigationService);
  private readonly api = inject(ApiClient);
  private readonly actions = inject(NavigationItemActions);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly refresh = inject(NavigationStoreRefresh);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly favorites = inject(FavoritesService);
  private readonly favoriteTree = inject(FavoriteTreeService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly developerMode = inject(DeveloperModeService);
  private readonly permissions = inject(ProjectPermissionsStore);

  /** Creating, renaming, moving, reordering and deleting: editors, outside time travel and archived projects. */
  protected readonly canEdit = this.permissions.canEditContent;

  private readonly tree = viewChild<SfTreeComponent<NavEntry>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'create'];

  // ── Data ───────────────────────────────────────────────────────────────────

  protected readonly forest = signal<NavTreeView[]>([]);
  /** The first read of the menu returned (until then the tree and the empty states say nothing). */
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly urls = signal<NavUrls>(new Map());
  protected readonly index = computed(() => (this.loaded() ? buildNavIndex(this.forest()) : EMPTY_NAV_INDEX));
  /** The menu folders: where a move can go. */
  protected readonly folderTree = computed(() => navFolderTree(this.forest()));

  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly nodeOptions = computed<NavNodeOptions>(() => {
    this.language();
    const t = (key: string) => this.transloco.translate(`navigation.tree.status.${key}`);
    return {
      dev: this.developerMode.enabled(),
      locale: this.editingLocale.locale(),
      urls: this.urls(),
      hiddenLabel: t('hidden'),
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

  /** The fixed "All navigation" wrapper as the folder view shows it (its stored name is not the label). */
  private readonly rootEntry = computed<NavEntry | null>(() => {
    this.language();
    const root = this.index().root;
    return root ? { ...root, label: this.transloco.translate('navigation.folder.root') } : null;
  });
  protected readonly selected = computed<NavEntry | null>(() => {
    const uuid = this.asset();
    if (!uuid) {
      return null;
    }
    const index = this.index();
    return uuid === index.rootUuid ? this.rootEntry() : (index.entries.get(uuid) ?? null);
  });
  protected readonly selectedIsRoot = computed(() => this.selected() !== null && this.selected()?.uuid === this.index().rootUuid);
  protected readonly mode = computed<'favorites' | 'folder' | 'item' | 'empty'>(() => {
    if (this.favoritesParam()) {
      return 'favorites';
    }
    return this.selected()?.kind ?? 'empty';
  });
  protected readonly treeSelection = computed<string[]>(() => {
    if (this.mode() === 'favorites') {
      return [FAVORITES_NODE];
    }
    const selected = this.selected();
    return selected && !this.selectedIsRoot() ? [selected.uuid] : [];
  });
  protected readonly emptyMenu = computed(() => this.loaded() && !this.failed() && isEmptyNavIndex(this.index()));

  // ── Tree wiring ────────────────────────────────────────────────────────────

  protected readonly loader = computed<SfTreeLoader<NavEntry>>(() => {
    const index = this.index();
    const options = this.nodeOptions();
    const favorites = this.favorites.list();
    const key = this.projectKey();
    const label = this.transloco.translate('navigation.tree.favorites');
    return (parent) => {
      if (parent === null) {
        const nodes = navNodes(index, null, options);
        return favorites.length > 0 ? [this.favoriteTree.rootNode<NavEntry>(label), ...nodes] : nodes;
      }
      if (parent.id === FAVORITES_NODE) {
        return this.favoriteTree.nodes<NavEntry>(favorites);
      }
      if (isFavoriteNode(parent.id)) {
        return this.favoriteTree.children<NavEntry>(key, parent);
      }
      return navNodes(index, parent.id, options);
    };
  });

  protected readonly search = (query: string): readonly (readonly string[])[] => navSearchPaths(this.index(), query, this.urls());

  /** The *Favorites* branch is a view: nothing in it is renamed, deleted, moved, reordered or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<NavEntry>[]): boolean =>
    this.canEdit() && !nodes.some((node) => isFavoriteNode(node.id));

  /** Nothing goes into a favorite, only into a real folder (the tree's own rules cover the rest). */
  protected readonly canDrop = (_dragged: readonly SfTreeNode<NavEntry>[], target: SfTreeNode<NavEntry> | null): boolean =>
    target === null || !isFavoriteNode(target.id);

  /** A label is free among the siblings of its kind (the server enforces the UID; this answers before the round trip). */
  protected readonly validateName = (name: string, context: SfTreeNameContext<NavEntry>): string | null => {
    const kind = context.node?.data?.kind ?? 'folder';
    const taken = navChildren(this.index(), context.parent?.id ?? null).some(
      (sibling) => sibling.uuid !== context.node?.id && sibling.kind === kind && sibling.label.toLowerCase() === name.toLowerCase(),
    );
    return taken ? this.transloco.translate('navigation.tree.nameTaken') : null;
  };

  protected readonly confirmDelete = (nodes: readonly SfTreeNode<NavEntry>[]): Promise<boolean> =>
    this.actions.confirmDelete(
      nodes.flatMap((node) => (node.data ? [node.data] : [])),
      this.index(),
      this.injector,
    );

  /**
   * The host's entries of the one menu, between the tree's own (*New folder*, *Rename*, *Cut*, *Paste*, *Move to…*) and
   * *Delete*: *New menu item* and *Entry page…* in a folder, *Hide from menu* / *Show in menu*, *Open page* on an item,
   * *Add to favorites*.
   */
  protected readonly menuItems = (nodes: readonly SfTreeNode<NavEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    const entry = node?.data;
    if (!node || !entry || isFavoriteNode(node.id)) {
      return [];
    }
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const items: ContextMenuItem[] = [];
    if (this.canEdit() && entry.kind === 'folder') {
      items.push({ label: t('navigation.tree.newMenuItem'), icon: 'add_link', action: () => this.openNewItem(node.id) });
      items.push({ label: t('navigation.folder.menu.entryPage'), icon: 'login', action: () => this.openEntryDrawer(entry) });
    }
    if (this.canEdit()) {
      items.push(
        entry.visible
          ? { label: t('navigation.folder.menu.hide'), icon: 'visibility_off', action: () => void this.setVisibility({ entries: [entry], visible: false }) }
          : { label: t('navigation.folder.menu.show'), icon: 'visibility', action: () => void this.setVisibility({ entries: [entry], visible: true }) },
      );
    }
    if (entry.kind === 'item' && entry.targetUuid) {
      items.push({ label: t('navigation.tree.openPage'), icon: 'open_in_new', action: () => this.openPage(entry.targetUuid!) });
    }
    const on = this.favorites.isFavorite(node.id);
    items.push({
      label: t(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: node.label }),
      icon: 'star',
      action: () => this.toggleFavorite(node),
    });
    return items;
  };

  /** A right click on empty space acts as one on the root folder: only the *New …* options. */
  protected readonly rootMenuItems = (): ContextMenuItem[] =>
    !this.canEdit()
      ? []
      : [
          { label: this.transloco.translate('navigation.tree.newItem'), icon: 'add_link', action: () => this.openNewItem(null) },
          { label: this.transloco.translate('navigation.tree.newFolder'), icon: 'create_new_folder', action: () => void this.tree()?.startCreate(null, 'folder') },
        ];

  /** The head's *New* menu: where it creates is the open folder (or the folder of the open item). */
  protected readonly newItems = computed<SfMenuItem[]>(() => {
    this.language();
    return [
      {
        id: 'item',
        label: this.transloco.translate('navigation.tree.newItem'),
        icon: 'add_link',
        action: () => this.openNewItem(this.openFolderUuid()),
      },
      {
        id: 'folder',
        label: this.transloco.translate('navigation.tree.newFolder'),
        icon: 'create_new_folder',
        action: () => void this.tree()?.startCreate(this.openFolderUuid(), 'folder'),
      },
    ];
  });

  // ── Dialogs ────────────────────────────────────────────────────────────────

  protected readonly newItemOpen = signal(false);
  protected readonly creating = signal(false);
  /** The folder the open "New menu item" dialog creates into (`null` = the top level). */
  private createTarget: string | null = null;
  protected readonly moving = signal<readonly NavEntry[] | null>(null);
  /** The folder whose entry-page drawer is open (`null` = closed); looked up in the menu, so it follows reads and goes with a deleted folder. */
  private readonly entryDrawerUuid = signal<string | null>(null);
  protected readonly entryDrawerFolder = computed<NavEntry | null>(() => {
    const uuid = this.entryDrawerUuid();
    if (uuid === null) {
      return null;
    }
    const index = this.index();
    return uuid === index.rootUuid ? this.rootEntry() : (index.entries.get(uuid) ?? null);
  });

  constructor() {
    // The menu again whenever something changed: a create, move, reorder, delete or undo, a save in the detail, a release.
    effect(() => {
      const key = this.projectKey();
      this.refresh.tick();
      this.releaseEvents.version();
      if (key) {
        untracked(() => this.reload(key));
      }
    });

    // The public URLs again when the project, the editing language or the menu changed.
    effect(() => {
      const key = this.projectKey();
      this.refresh.tick();
      this.releaseEvents.version();
      const locale = this.editingLocale.locale();
      if (key) {
        untracked(() => void this.loadUrls(key, locale));
      }
    });

    // Keep the open entry visible in the tree (expanding its ancestors).
    effect(() => {
      this.asset();
      this.mode();
      if (this.loaded()) {
        untracked(() => afterNextRender(() => void this.revealOpen(), { injector: this.injector }));
      }
    });
  }

  /** `n` creates a menu item (M35.14). */
  private readonly newItemShortcut = inject(ShortcutService).use([
    createShortcut({
      handler: () => (this.canEdit() ? this.openNewItem(this.openFolderUuid()) : false),
      palette: { label: 'frame.shortcuts.items.createMenuItem' },
    }),
  ]);

  // ── Reading ────────────────────────────────────────────────────────────────

  private menuRead: Subscription | null = null;
  private urlRead = 0;

  /** The menu as one tree, in the stored order; a newer read replaces the one in flight. */
  private reload(key: string): void {
    this.menuRead?.unsubscribe();
    this.menuRead = this.nav.tree(key).subscribe({
      next: (tree) => {
        this.actions.forgetRevisions();
        this.forest.set(tree ?? []);
        this.failed.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.failed.set(true);
        this.loaded.set(true);
        this.toasts.show(this.transloco.translate('navigation.tree.toast.loadFailed'), 'error');
      },
    });
  }

  /** Every page row of the URL registry (a few requests at most); a failure leaves the URLs as they were. */
  private async loadUrls(key: string, locale: string | null): Promise<void> {
    const read = ++this.urlRead;
    try {
      const rows = [];
      for (let page = 0; page < 10; page++) {
        const result = await firstValueFrom(this.nav.pageUrlRows(key, page));
        rows.push(...(result.content ?? []));
        if (result.last !== false) {
          break;
        }
      }
      if (read === this.urlRead) {
        this.urls.set(pickPageUrls(rows, locale));
      }
    } catch {
      // The menu shows the target page's name where it has no URL.
    }
  }

  /** Something changed: the area reads the menu again. */
  protected changed(): void {
    this.refresh.notify();
  }

  /** The folder an action without a target aims at: the open folder, the folder of the open item, else the top level. */
  private openFolderUuid(): string | null {
    const selected = this.selected();
    if (!selected || this.selectedIsRoot()) {
      return null;
    }
    return selected.kind === 'folder' ? selected.uuid : (this.index().parentOf.get(selected.uuid) ?? null);
  }

  private async revealOpen(): Promise<void> {
    const tree = this.tree();
    const selected = this.selected();
    if (!tree || !selected) {
      return;
    }
    const path = navIdPath(this.index(), selected.uuid);
    for (const ancestor of selected.kind === 'folder' ? path : path.slice(0, -1)) {
      await tree.expand(ancestor);
    }
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  protected onOpen(node: SfTreeNode<NavEntry>): void {
    const key = this.projectKey();
    if (node.id === FAVORITES_NODE) {
      void this.router.navigate(['/p', key, 'navigation'], { queryParams: { favorites: 1 } });
      return;
    }
    if (isFavoriteNode(node.id)) {
      const route = this.favoriteTree.routeOf(key, node);
      if (route) {
        void this.router.navigate([...route.commands], { queryParams: route.queryParams });
      }
      return;
    }
    this.openEntry(node.id);
  }

  /** Opens a folder or item: the selection lives in the URL. */
  protected openEntry(uuid: string | null): void {
    void this.router.navigate(['/p', this.projectKey(), 'navigation'], { queryParams: uuid ? { asset: uuid } : {} });
  }

  /** The tree title: the fixed "All navigation" wrapper, with the menu's own entry page. */
  protected openRoot(): void {
    this.openEntry(this.index().rootUuid);
  }

  /** Opens the entry-page drawer of a menu folder (the wrapper included). */
  protected openEntryDrawer(folder: NavEntry): void {
    if (folder.kind === 'folder') {
      this.entryDrawerUuid.set(folder.uuid);
    }
  }

  protected closeEntryDrawer(): void {
    this.entryDrawerUuid.set(null);
  }

  /**
   * *Show in menu* / *Hide from menu*: one revision per entry, one Undo for the group. An entry that already has the value
   * is left alone; the area reads the menu again afterwards.
   */
  protected async setVisibility(request: NavVisibilityRequest): Promise<void> {
    if (!this.canEdit() || request.entries.length === 0) {
      return;
    }
    const change = await this.actions.setVisibility(this.projectKey(), request.entries, request.visible);
    if (change.done.length > 0) {
      const message = this.transloco.translate(request.visible ? 'navigation.tree.toast.shown' : 'navigation.tree.toast.hidden', {
        count: change.done.length,
        name: change.done[0].label,
      });
      this.undo.offerGroup(message, this.withRefresh(change.steps));
    } else if (!change.failed) {
      this.toasts.show(this.transloco.translate('navigation.tree.toast.visibilityUnchanged'), 'info');
    }
    if (change.failed) {
      this.toasts.show(
        this.transloco.translate('navigation.tree.toast.visibilityFailed', { name: request.entries[change.done.length]?.label ?? '' }),
        'error',
      );
    }
    this.changed();
  }

  protected openPage(pageUuid: string): void {
    const target = assetRoute(this.projectKey(), { type: 'PAGE', uuid: pageUuid });
    void this.router.navigate(target.commands, { queryParams: target.queryParams });
  }

  /** The folder view's header *Rename*: the same in-place edit as F2 in the tree. */
  protected renameInTree(uuid: string): void {
    this.tree()?.startRename(uuid);
  }

  protected createFolderAtRoot(): void {
    void this.tree()?.startCreate(null, 'folder');
  }

  // ── Favorites ──────────────────────────────────────────────────────────────

  private toggleFavorite(node: SfTreeNode<NavEntry>): void {
    const entry = node.data;
    if (!entry) {
      return;
    }
    const on = this.favorites.toggle({
      type: entry.kind === 'folder' ? 'FOLDER' : 'PAGE_REFERENCE',
      uuid: entry.uuid,
      displayName: entry.label,
      folderPath: entryFolderPath(this.index(), entry),
    });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name: node.label }), 'info');
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /** A folder created in place in the tree. */
  protected onCreate(request: SfTreeCreateRequest<NavEntry>): void {
    if (request.kind !== 'folder' || !this.canEdit()) {
      return;
    }
    this.nav.createFolder(this.projectKey(), request.name, request.parent?.id).subscribe({
      next: (created) => {
        this.toasts.show(this.transloco.translate('navigation.tree.toast.folderCreated', { name: request.name }), 'success');
        this.changed();
        if (request.parent) {
          void this.tree()?.expand(request.parent.id);
        }
        if (created.uuid) {
          this.openEntry(created.uuid);
        }
      },
      error: () => this.toasts.show(this.transloco.translate('navigation.tree.toast.folderCreateFailed'), 'error'),
    });
  }

  /** Opens the "New menu item" dialog; it creates in `folderUuid` (`null` = the top level). */
  protected openNewItem(folderUuid: string | null): void {
    if (this.canEdit()) {
      this.createTarget = folderUuid;
      this.newItemOpen.set(true);
    }
  }

  /** The folder view's *New menu item* creates in the folder it shows. */
  protected openNewItemHere(): void {
    this.openNewItem(this.openFolderUuid());
  }

  protected submitNewItem(value: CreateAssetFormValue): void {
    if (!this.canEdit()) {
      return;
    }
    this.creating.set(true);
    this.nav
      .createReference(this.projectKey(), {
        displayName: value.displayName,
        folderUuid: this.createTarget ?? undefined,
        targetKind: value.targetKind ?? 'PAGE',
        targetAssetUuid: value.targetAssetUuid,
      })
      .subscribe({
        next: (created) => {
          this.creating.set(false);
          this.newItemOpen.set(false);
          this.toasts.show(this.transloco.translate('navigation.tree.toast.itemCreated', { name: value.displayName }), 'success');
          this.changed();
          if (created.uuid) {
            this.openEntry(created.uuid);
          }
        },
        error: () => {
          this.creating.set(false);
          this.toasts.show(this.transloco.translate('navigation.tree.toast.itemCreateFailed'), 'error');
        },
      });
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  /** F2 in the tree: a folder is renamed, an item's *label* (in the editing language) is what the name stands for. */
  protected onRename(request: SfTreeRenameRequest<NavEntry>): void {
    const entry = request.node.data;
    if (!entry || !this.canEdit()) {
      return;
    }
    void (entry.kind === 'folder' ? this.renameFolder(entry, request.name) : this.renameItem(entry, request.name));
  }

  private async renameFolder(entry: NavEntry, name: string): Promise<void> {
    const key = this.projectKey();
    const from = entry.label;
    const rename = (to: string, revision: number | null | undefined) =>
      firstValueFrom(this.nav.renameFolder(key, entry.uuid, to, revision == null ? undefined : etagFor(revision)));
    try {
      const renamed = await rename(name, entry.revision);
      // Undo renames back; the etag is the revision the rename produced.
      this.undo.offer(this.transloco.translate('navigation.tree.toast.renamed', { from, to: name }), () =>
        rename(from, renamed.revision).then(() => this.changed()),
      );
      this.changed();
    } catch {
      this.toasts.show(this.transloco.translate('navigation.tree.toast.renameFailed', { name: from }), 'error');
      this.changed();
    }
  }

  private async renameItem(entry: NavEntry, name: string): Promise<void> {
    const key = this.projectKey();
    const locale = this.editingLocale.locale();
    const from = entry.label;
    try {
      const detail = await firstValueFrom(this.api.assetDetail(key, entry.uuid));
      const payload = (detail.payload ?? {}) as { target?: { kind?: string; assetUuid?: string }; label?: unknown };
      const targetKind = payload.target?.kind === 'FOLDER' ? 'FOLDER' : 'PAGE';
      const targetAssetUuid = payload.target?.assetUuid;
      if (!targetAssetUuid) {
        throw new Error('no target');
      }
      const before = storedLabel(payload.label, locale);
      const write = (label: string, revision: number | null | undefined) =>
        firstValueFrom(
          this.nav.updateReference(
            key,
            entry.uuid,
            { targetKind, targetAssetUuid, label: label || undefined },
            revision == null ? undefined : etagFor(revision),
            locale ?? undefined,
          ),
        );
      const updated = await write(name, detail.revision);
      this.undo.offer(this.transloco.translate('navigation.tree.toast.renamed', { from, to: name }), () =>
        write(before, updated.revision).then(() => this.changed()),
      );
      this.changed();
    } catch {
      this.toasts.show(this.transloco.translate('navigation.tree.toast.renameFailed', { name: from }), 'error');
      this.changed();
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /** The tree's own delete (it asked already through `confirmDelete`). */
  protected onDelete(request: SfTreeDeleteRequest<NavEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void (async () => {
      const change = await this.actions.delete(this.projectKey(), entries);
      if (change.done.length > 0) {
        this.leaveDeleted(change.done.map((entry) => entry.uuid));
      }
      this.changed();
      if (change.failed) {
        // What was deleted before the failure stays deleted and stays undoable.
        this.toasts.show(this.transloco.translate('navigation.tree.toast.deleteFailed', { name: entries[change.done.length]?.label ?? '' }), 'error');
        if (change.done.length > 0) {
          this.undo.offerGroup(this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].label }), this.withRefresh(change.steps));
        }
        return;
      }
      request.completed(() => void this.actions.runUndo(this.withRefresh(change.steps)));
    })();
  }

  /** A delete from the folder table, the item's ⋮ or the folder's ⋮: asks, deletes, offers the one Undo. */
  protected async deleteEntries(entries: readonly NavEntry[]): Promise<void> {
    if (entries.length === 0 || !this.canEdit() || !(await this.actions.confirmDelete(entries, this.index()))) {
      return;
    }
    const change = await this.actions.delete(this.projectKey(), entries);
    if (change.done.length > 0) {
      this.leaveDeleted(change.done.map((entry) => entry.uuid));
      this.undo.offerGroup(this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].label }), this.withRefresh(change.steps));
    }
    if (change.failed) {
      this.toasts.show(this.transloco.translate('navigation.tree.toast.deleteFailed', { name: entries[change.done.length]?.label ?? '' }), 'error');
    }
    this.changed();
  }

  /** What is open was deleted (or lay inside what was): the area goes up to the folder it was in. */
  private leaveDeleted(uuids: readonly string[]): void {
    const index = this.index();
    const open = this.selected()?.uuid;
    if (open && uuids.some((uuid) => uuid === open || navIdPath(index, open).includes(uuid))) {
      const parent = uuids.includes(open) ? (index.parentOf.get(open) ?? null) : null;
      this.openEntry(parent !== null && !uuids.includes(parent) ? parent : null);
    }
  }

  // ── Move and reorder ───────────────────────────────────────────────────────

  /** Drag and drop into a folder, and cut + paste in the tree. */
  protected onMove(request: SfTreeMoveRequest<NavEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void this.transfer(entries, request.target?.id ?? null, (steps) => request.completed(steps ? () => void this.actions.runUndo(steps) : undefined));
  }

  /** The tree's *Move to…*, the table's bulk *Move…* and the ⋮ menus' *Move…*: a picker for the destination. */
  protected openMoveDialog(entries: readonly NavEntry[]): void {
    if (this.canEdit() && entries.length > 0) {
      this.moving.set(entries);
    }
  }

  protected openMoveDialogForNodes(nodes: SfTreeNode<NavEntry>[]): void {
    this.openMoveDialog(nodes.flatMap((node) => (node.data ? [node.data] : [])));
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
      const message = this.transloco.translate('shared.tree.moved', { count: entries.length, name: entries[0]?.label ?? '' });
      if (steps) {
        this.undo.offerGroup(message, steps);
      } else {
        this.toasts.show(message, 'success');
      }
    });
  }

  /**
   * Moves into the folder `target` (`null` = the top level). Undo moves back. Stops at the first failure; what was done up
   * to there stays and is announced.
   */
  private async transfer(entries: readonly NavEntry[], target: string | null, completed: (undo?: UndoStep[]) => void): Promise<void> {
    const index = this.index();
    const change = await this.actions.move(this.projectKey(), entries, target, (entry) => index.parentOf.get(entry.uuid) ?? null);
    this.changed();
    if (change.failed) {
      this.toasts.show(this.transloco.translate('navigation.tree.toast.moveFailed', { name: entries[change.done.length]?.label ?? '' }), 'error');
      if (change.done.length === 0) {
        return;
      }
    }
    completed(change.done.length > 0 ? this.withRefresh(change.steps) : undefined);
  }

  /**
   * Drag before/after and `Alt+↑/↓` (decision 23): `node` goes to `index` among the children of `parent`. Dropped next to a
   * row of another folder it is moved there first. The stored order is the folder's list of children; Undo writes the
   * previous list (and moves back).
   */
  protected onReorder(request: SfTreeReorderRequest<NavEntry>): void {
    const entry = request.node.data;
    if (!entry || !this.canEdit()) {
      return;
    }
    const key = this.projectKey();
    const parentId = request.parent?.id ?? null;
    void (async () => {
      const snapshot = this.index();
      const from = snapshot.parentOf.get(entry.uuid) ?? null;
      const steps: UndoStep[] = [];
      if (from !== parentId) {
        const moved = await this.actions.move(key, [entry], parentId, () => from);
        if (moved.failed) {
          this.toasts.show(this.transloco.translate('navigation.tree.toast.moveFailed', { name: entry.label }), 'error');
          this.changed();
          return;
        }
        steps.push(...moved.steps);
      }
      const previous = [...(snapshot.childrenOf.get(parentId) ?? [])];
      const result = await this.actions.reorder(key, snapshot, parentId, orderWith(snapshot, parentId, entry.uuid, request.index), previous);
      this.changed();
      if (!result.ok) {
        this.toasts.show(this.transloco.translate('navigation.tree.toast.reorderFailed', { name: entry.label }), 'error');
        return;
      }
      if (result.undo) {
        steps.push(result.undo);
      }
      request.completed(() => void this.actions.runUndo(this.withRefresh(steps)));
    })();
  }

  /** After an Undo the area reads the menu again: the first step is the one that runs last. */
  private withRefresh(steps: readonly UndoStep[]): UndoStep[] {
    return [async () => this.changed(), ...steps];
  }
}
