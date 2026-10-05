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
import { filter, firstValueFrom, map, type Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FAVORITES_NODE, FavoriteTreeService, isFavoriteNode } from '../../core/assets/favorite-tree.service';
import { FavoritesService } from '../../core/assets/favorites.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
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
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { sortFolderTree } from '../../shared/tree-sort.util';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import type { ReleaseChoice } from '../release/release-choice.util';
import { isOnline } from '../release/release-status.util';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { FolderMoveDialogComponent } from './folder-move-dialog.component';
import { FolderViewComponent } from './folder-view.component';
import { PageDeleteDialogComponent } from './page-delete-dialog.component';
import { PagesItemActions } from './pages-item-actions';
import { PagesTreeRefresh } from './pages-tree-refresh.service';
import {
  EMPTY_INDEX,
  type PageNodeData,
  type TreeNodeOptions,
  buildIndex,
  childNodes,
  idPath,
  isEmptyIndex,
  pageUuidFromUrl,
  searchPaths,
} from './pages-tree.util';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type FolderView = components['schemas']['FolderView'];

const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * The Pages area (M35.18): the page tree on the left, and in the main pane the open page (the router outlet), the open
 * folder's table, or the Favorites list. The tree (`sf-tree`) holds folders and pages only — a page's bodies and sections
 * are the editor's outline — and loads lazily from the folder tree and page list this screen keeps in memory, so its
 * filter is answered locally. A *Favorites* node is pinned on top while the project has favorites (any store, folders
 * expand into their real contents).
 *
 * Every change — create, rename, delete, move, duplicate — goes through here and offers Undo (M35.13); the tree and the
 * folder table re-read when anything changed (`PagesTreeRefresh`).
 */
@Component({
  selector: 'sf-pages-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FavoritesViewComponent,
    FolderMoveDialogComponent,
    FolderViewComponent,
    PageDeleteDialogComponent,
    ReleaseDialogComponent,
    RouterOutlet,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfMenuComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  templateUrl: './pages-list.component.html',
  styleUrl: './pages-list.component.scss',
})
export class PagesListComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly favorites = inject(FavoritesService);
  private readonly actions = inject(PagesItemActions);
  private readonly favoriteTree = inject(FavoriteTreeService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly developerMode = inject(DeveloperModeService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly projectKey = input.required<string>();
  /** `?folder=<uuid>` is the open folder (kept in the URL, so recents and deep links find it). */
  readonly folder = input<string | undefined>();
  /** `?favorites=1` shows the Favorites list. */
  readonly favoritesParam = input<string | undefined>(undefined, { alias: 'favorites' });

  private readonly tree = viewChild<SfTreeComponent<PageNodeData>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'copy', 'create'];

  // ── Data ───────────────────────────────────────────────────────────────────

  /** The folder tree as it was at the revision being viewed (time travel); `null` until that read returns. */
  private readonly travelTree = signal<FolderView[] | null>(null);
  protected readonly folderTree = computed<FolderView[]>(() =>
    this.timeTravel.isTimeTravel() ? (this.travelTree() ?? []) : this.store.pageFolderTree(),
  );
  private readonly loadedPages = signal<AssetSummaryView[]>([]);
  /** The first read of the pages returned (until then the tree and the empty state say nothing). */
  protected readonly loaded = signal(false);
  protected readonly index = computed(() => (this.loaded() ? buildIndex(this.folderTree(), this.loadedPages()) : EMPTY_INDEX));

  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly nodeOptions = computed<TreeNodeOptions>(() => {
    this.language();
    const t = (key: string) => this.transloco.translate(`pages.tree.status.${key}`);
    return {
      dev: this.developerMode.enabled(),
      locale: this.editingLocale.locale(),
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
  protected readonly pageUuid = computed(() => pageUuidFromUrl(this.url()));
  protected readonly mode = computed<'page' | 'favorites' | 'folder'>(() =>
    this.pageUuid() ? 'page' : this.favoritesParam() ? 'favorites' : 'folder',
  );
  protected readonly folderUuid = computed(() => (this.mode() === 'folder' ? (this.folder() ?? null) : null));

  protected readonly treeSelection = computed<string[]>(() => {
    const page = this.pageUuid();
    if (page) {
      return [page];
    }
    if (this.mode() === 'favorites') {
      return [FAVORITES_NODE];
    }
    const folder = this.folder();
    return folder ? [folder] : [];
  });

  /** A project with no pages and no folders: the main pane explains what to do (decision 87). */
  protected readonly emptyProject = computed(() => this.loaded() && isEmptyIndex(this.index()));
  protected readonly hasTemplates = computed(() => this.store.pageTemplates().length > 0);
  protected readonly isDeveloper = computed(() => this.developerMode.enabled() && this.permissions.canEditTemplates());
  protected readonly pageTemplates = computed(() => this.store.pageTemplates());
  /** The empty state's primary action: a developer without templates goes to create one; with templates anyone creates a page; an editor without templates is told to ask. */
  protected readonly primaryLabel = computed<string | null>(() => {
    this.language();
    if (this.readOnly()) {
      return null;
    }
    if (this.hasTemplates()) {
      return this.transloco.translate('pages.empty.createPage');
    }
    return this.isDeveloper() ? this.transloco.translate('pages.empty.goTemplates') : null;
  });

  // ── Tree wiring ────────────────────────────────────────────────────────────

  protected readonly loader = computed<SfTreeLoader<PageNodeData>>(() => {
    const index = this.index();
    const options = this.nodeOptions();
    const favorites = this.favorites.list();
    const key = this.projectKey();
    const label = this.transloco.translate('pages.tree.favorites');
    return (parent) => {
      if (parent === null) {
        const nodes = childNodes(index, null, options);
        return favorites.length > 0 ? [this.favoriteTree.rootNode<PageNodeData>(label), ...nodes] : nodes;
      }
      if (parent.id === FAVORITES_NODE) {
        return this.favoriteTree.nodes<PageNodeData>(favorites);
      }
      if (isFavoriteNode(parent.id)) {
        return this.favoriteTree.children<PageNodeData>(key, parent);
      }
      return childNodes(index, parent.id, options);
    };
  });

  protected readonly search = (query: string): readonly (readonly string[])[] => searchPaths(this.index(), query);

  /** The *Favorites* branch is a view: nothing in it is renamed, deleted, moved or created. */
  protected readonly allowAction = (action: SfTreeAction, nodes: readonly SfTreeNode<PageNodeData>[]): boolean => {
    if (this.readOnly() || nodes.some((node) => isFavoriteNode(node.id))) {
      return false;
    }
    // Pages are copied (a duplicate); a folder is only moved.
    return action !== 'copy' || nodes.every((node) => node.data?.kind === 'page');
  };

  /** A page cannot go into a favorite, only into a real folder (the tree's own rules cover the rest). */
  protected readonly canDrop = (_dragged: readonly SfTreeNode<PageNodeData>[], target: SfTreeNode<PageNodeData> | null): boolean =>
    target === null || !isFavoriteNode(target.id);

  /** A name is free among the siblings of its kind (the server enforces it for UIDs; this answers before the round trip). */
  protected readonly validateName = (name: string, context: SfTreeNameContext<PageNodeData>): string | null => {
    const kind = context.node?.data?.kind ?? (context.kind === 'folder' ? 'folder' : 'page');
    const siblings = childNodes(this.index(), context.parent?.id ?? null, this.nodeOptions());
    const taken = siblings.some(
      (sibling) =>
        sibling.id !== context.node?.id && sibling.data?.kind === kind && sibling.label.toLowerCase() === name.toLowerCase(),
    );
    return taken ? this.transloco.translate('pages.tree.nameTaken') : null;
  };

  protected readonly confirmDelete = async (nodes: readonly SfTreeNode<PageNodeData>[]): Promise<boolean> => {
    const single = nodes.length === 1 ? nodes[0] : null;
    const page = single?.data?.kind === 'page' ? this.index().pages.get(single.id) : undefined;
    // A page that is online may be redirected: its own dialog asks and deletes (decision 51).
    if (page && isOnline(page.release) && this.permissions.canRedirectOldUrls()) {
      this.deleting.set(page);
      return false;
    }
    const folders = nodes.some((node) => node.data?.kind === 'folder');
    const online = nodes.some((node) => isOnline(node.data?.release));
    const messages = [
      folders ? this.transloco.translate('pages.tree.delete.folderMessage') : null,
      online ? this.transloco.translate('pages.tree.toast.onlinePages') : null,
    ].filter((message): message is string => message !== null);
    const params = { count: nodes.length, name: nodes[0]?.label ?? '' };
    return this.confirms.confirm({
      title: this.transloco.translate('shared.tree.deleteTitle', params),
      message: messages.join(' ') || undefined,
      confirmLabel: this.transloco.translate('shared.tree.deleteConfirm', params),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(nodes.length),
      injector: this.injector,
    });
  };

  protected readonly menuItems = (nodes: readonly SfTreeNode<PageNodeData>[]): ContextMenuItem[] => {
    if (nodes.length > 1) {
      // A selection: Move and Delete are the tree's own; Release is ours.
      const items = nodes.flatMap((node) => (node.data && !isFavoriteNode(node.id) ? [node.data] : []));
      return items.length === nodes.length && this.canRelease() ? [this.releaseEntry(items)] : [];
    }
    const node = nodes[0] ?? null;
    const data = node?.data;
    if (!node || !data || isFavoriteNode(node.id)) {
      return [];
    }
    const items: ContextMenuItem[] = [];
    if (data.kind === 'folder' && !this.readOnly() && this.hasTemplates()) {
      items.push({ label: this.transloco.translate('pages.tree.newPageHere'), icon: 'note_add', action: () => this.openNewPage(node.id) });
    }
    if (data.kind === 'page' && !this.readOnly()) {
      items.push({ label: this.transloco.translate('pages.tree.duplicate'), icon: 'content_copy', action: () => void this.actions.duplicate(this.projectKey(), data) });
    }
    if (this.canRelease()) {
      items.push(this.releaseEntry([data]));
    }
    const on = this.favorites.isFavorite(node.id);
    items.push({
      label: this.transloco.translate(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: node.label }),
      icon: 'star',
      action: () => this.actions.toggleFavorite(data),
    });
    return items;
  };

  private canRelease(): boolean {
    return this.permissions.canRelease() && !this.readOnly();
  }

  private releaseEntry(items: readonly PageNodeData[]): ContextMenuItem {
    return { label: this.transloco.translate('pages.bulk.release'), icon: 'publish', action: () => void this.openRelease(items) };
  }

  /** A right click on empty space acts as one on the root folder: only the *New …* options. */
  protected readonly rootMenuItems = (): ContextMenuItem[] =>
    this.readOnly()
      ? []
      : [
          ...(this.hasTemplates() ? [{ label: this.transloco.translate('pages.tree.newPage'), icon: 'note_add', action: () => this.openNewPage(null) }] : []),
          { label: this.transloco.translate('pages.tree.newFolder'), icon: 'create_new_folder', action: () => void this.tree()?.startCreate(null, 'folder') },
        ];

  protected readonly newItems = computed<SfMenuItem[]>(() => {
    this.language();
    return [
      {
        id: 'page',
        label: this.transloco.translate('pages.tree.newPage'),
        icon: 'note_add',
        disabled: !this.hasTemplates(),
        disabledReason: this.hasTemplates() ? undefined : this.transloco.translate('pages.tree.noTemplates'),
        action: () => this.openNewPage(this.openFolderUuid()),
      },
      {
        id: 'folder',
        label: this.transloco.translate('pages.tree.newFolder'),
        icon: 'create_new_folder',
        action: () => void this.tree()?.startCreate(this.openFolderUuid(), 'folder'),
      },
    ];
  });

  // ── Dialogs ────────────────────────────────────────────────────────────────

  protected readonly newPageOpen = signal(false);
  protected readonly creatingPage = signal(false);
  /** The folder the open "New page" dialog creates into (`null` = the root). */
  private newPageFolder: string | null = null;
  protected readonly deleting = signal<AssetSummaryView | null>(null);
  protected readonly moving = signal<readonly SfTreeNode<PageNodeData>[] | null>(null);
  protected readonly releasing = signal<ReleaseChoice[] | null>(null);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (key) {
        untracked(() => this.store.loadFor(key).subscribe());
      }
    });

    // The pages again whenever something changed: a release, another revision, an undo that restored something.
    effect(() => {
      const key = this.projectKey();
      this.releaseEvents.version();
      this.timeTravel.activeRevision();
      this.treeRefresh.version();
      if (key) {
        untracked(() => this.reload(key));
      }
    });

    // Time travel: the tree as it was then, with what was deleted since and without what was created later.
    effect(
      (onCleanup) => {
        const key = this.projectKey();
        const revision = this.timeTravel.activeRevision();
        this.travelTree.set(null);
        if (!key || revision === null) {
          return;
        }
        const read = this.api.listFolders(key, 'PAGES', 10, revision).subscribe({
          next: (tree) => this.travelTree.set(sortFolderTree(tree ?? [])),
          error: () => this.travelTree.set([]),
        });
        onCleanup(() => read.unsubscribe());
      },
      { allowSignalWrites: true },
    );

    // An open editor's release bar read a new status: the tree row shows it at once (M27.6.1).
    effect(
      () => {
        const observed = this.releaseEvents.observed();
        const next = untracked(() => withObservedRelease(this.loadedPages(), observed));
        if (next) {
          this.loadedPages.set(next);
        }
      },
      { allowSignalWrites: true },
    );

    // Keep the open page or folder visible in the tree (expanding its ancestors).
    effect(() => {
      this.pageUuid();
      this.folder();
      this.mode();
      if (this.loaded()) {
        untracked(() => afterNextRender(() => void this.revealOpen(), { injector: this.injector }));
      }
    });
  }

  /** `n` creates a page (M35.14). */
  private readonly newPageShortcut = inject(ShortcutService).use([
    createShortcut({
      handler: () => (this.readOnly() || !this.hasTemplates() ? false : this.openNewPage(this.openFolderUuid())),
      palette: { label: 'frame.shortcuts.items.createPage' },
    }),
  ]);

  // ── Reading ────────────────────────────────────────────────────────────────

  private pagesRead: Subscription | null = null;

  /** The read of the list in flight: a newer one (another revision) replaces it. */
  private reload(key: string): void {
    this.pagesRead?.unsubscribe();
    this.pagesRead = this.api.listPages(key, { revision: this.timeTravel.activeRevision() ?? undefined }).subscribe({
      next: (pages) => {
        this.loadedPages.set(pages ?? []);
        this.loaded.set(true);
      },
      error: () => {
        this.loaded.set(true);
        this.toasts.show(this.transloco.translate('pages.tree.toast.loadFailed'), 'error');
      },
    });
  }

  /** Re-reads the folder tree and the pages after a change (the folder table follows through `PagesTreeRefresh`). */
  private changed(): void {
    this.store.loadFor(this.projectKey(), true).subscribe();
    this.treeRefresh.notify();
  }

  /** The folder an action without a target aims at: the open folder, the folder of the open page, else the root. */
  private openFolderUuid(): string | null {
    const page = this.pageUuid();
    if (page) {
      return this.index().parentOf.get(page) ?? null;
    }
    return this.mode() === 'folder' ? (this.folder() ?? null) : null;
  }

  private async revealOpen(): Promise<void> {
    const tree = this.tree();
    const index = this.index();
    const page = this.pageUuid();
    const id = page ?? (this.mode() === 'folder' ? this.folder() : null);
    if (!tree || !id) {
      return;
    }
    const path = idPath(index, id);
    for (const ancestor of page ? path.slice(0, -1) : path) {
      await tree.expand(ancestor);
    }
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  protected onOpen(node: SfTreeNode<PageNodeData>): void {
    const key = this.projectKey();
    if (node.id === FAVORITES_NODE) {
      void this.router.navigate(['/p', key, 'pages'], { queryParams: { favorites: 1 } });
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
      void this.router.navigate(['/p', key, 'pages'], { queryParams: { folder: node.id } });
    } else {
      void this.router.navigate(['/p', key, 'pages', node.id]);
    }
  }

  protected openPage(uuid: string): void {
    void this.router.navigate(['/p', this.projectKey(), 'pages', uuid]);
  }

  protected openFolder(uuid: string | null): void {
    void this.router.navigate(['/p', this.projectKey(), 'pages'], { queryParams: uuid ? { folder: uuid } : {} });
  }

  protected onEmptyPrimary(): void {
    if (this.hasTemplates()) {
      this.openNewPage(null);
    } else {
      void this.router.navigate(['/p', this.projectKey(), 'templates']);
    }
  }

  protected createFolderAtRoot(): void {
    void this.tree()?.startCreate(null, 'folder');
  }

  // ── Release ────────────────────────────────────────────────────────────────

  /** *Release…*: a page, or a folder with everything inside it (nothing to release says so). */
  private async openRelease(items: readonly PageNodeData[]): Promise<void> {
    const choices = await this.actions.releaseDialogChoices(this.projectKey(), this.folderTree(), items);
    if (choices) {
      this.releasing.set(choices);
    }
  }

  protected onReleased(): void {
    this.releasing.set(null);
    this.treeRefresh.notify();
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  protected onCreate(request: SfTreeCreateRequest<PageNodeData>): void {
    if (request.kind !== 'folder' || this.readOnly()) {
      return;
    }
    this.api.createFolder(this.projectKey(), { displayName: request.name, parentFolderUuid: request.parent?.id, scope: 'PAGES' }).subscribe({
      next: (created) => {
        this.toasts.show(this.transloco.translate('pages.tree.toast.folderCreated', { name: request.name }), 'success');
        this.changed();
        if (request.parent) {
          void this.tree()?.expand(request.parent.id);
        }
        if (created.uuid) {
          this.openFolder(created.uuid);
        }
      },
      error: () => this.toasts.show(this.transloco.translate('pages.tree.toast.folderCreateFailed'), 'error'),
    });
  }

  protected openNewPage(folderUuid: string | null): void {
    if (this.readOnly() || !this.hasTemplates()) {
      return;
    }
    this.newPageFolder = folderUuid;
    this.newPageOpen.set(true);
  }

  protected submitNewPage(value: CreateAssetFormValue): void {
    if (this.readOnly()) {
      return;
    }
    this.creatingPage.set(true);
    this.api
      .createPage(this.projectKey(), {
        displayName: value.displayName,
        templateUuid: value.templateUuid,
        folderUuid: this.newPageFolder ?? undefined,
      })
      .subscribe({
        next: () => {
          this.creatingPage.set(false);
          this.newPageOpen.set(false);
          this.toasts.show(this.transloco.translate('pages.tree.toast.pageCreated', { name: value.displayName }), 'success');
          this.changed();
        },
        error: () => {
          this.creatingPage.set(false);
          this.toasts.show(this.transloco.translate('pages.tree.toast.pageCreateFailed'), 'error');
        },
      });
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected onRename(request: SfTreeRenameRequest<PageNodeData>): void {
    const data = request.node.data;
    if (!data || this.readOnly()) {
      return;
    }
    this.actions.rename(this.projectKey(), data, request.name).subscribe();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  protected onDelete(request: SfTreeDeleteRequest<PageNodeData>): void {
    const key = this.projectKey();
    const items = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void (async () => {
      try {
        for (const item of items) {
          await firstValueFrom(
            item.kind === 'folder' ? this.api.deleteFolder(key, item.uuid, true) : this.api.deleteAsset(key, item.uuid),
            { defaultValue: undefined },
          );
        }
      } catch {
        this.toasts.show(this.transloco.translate('pages.tree.toast.deleteFailed', { name: items[0]?.name ?? '' }), 'error');
        this.changed();
        return;
      }
      this.leaveDeleted(items.map((item) => item.uuid));
      this.changed();
      request.completed(() => void this.restore(items));
    })();
  }

  /** The page dialog deleted a page itself. */
  protected onPageDeleted(): void {
    const page = this.deleting();
    this.deleting.set(null);
    if (page?.uuid) {
      this.leaveDeleted([page.uuid]);
    }
    this.changed();
  }

  /** What is open was deleted: the area goes back to the folder it was in. */
  private leaveDeleted(uuids: readonly string[]): void {
    const index = this.index();
    const open = this.pageUuid() ?? this.folder() ?? null;
    if (open && uuids.some((uuid) => uuid === open || idPath(index, open).includes(uuid))) {
      this.openFolder(null);
    }
  }

  private async restore(items: readonly PageNodeData[]): Promise<void> {
    const key = this.projectKey();
    try {
      for (const item of [...items].reverse()) {
        await firstValueFrom(item.kind === 'folder' ? this.api.restoreFolder(key, item.uuid) : restoreDeletedAsset(this.api, key, item.uuid), {
          defaultValue: undefined,
        });
      }
      this.toasts.show(this.transloco.translate('shared.undo.done'), 'info');
    } catch {
      this.toasts.show(this.transloco.translate('shared.undo.failed'), 'error');
    }
    this.changed();
  }

  // ── Move and copy ──────────────────────────────────────────────────────────

  protected onMove(request: SfTreeMoveRequest<PageNodeData>): void {
    void this.transfer(request.nodes, request.target?.id ?? null, request.copy, (undo) => request.completed(undo));
  }

  protected openMoveDialog(nodes: SfTreeNode<PageNodeData>[]): void {
    this.moving.set(nodes);
  }

  protected onMoveChosen(target: string | null): void {
    const nodes = this.moving();
    this.moving.set(null);
    if (!nodes) {
      return;
    }
    const message = (count: number, name: string) => this.transloco.translate('shared.tree.moved', { count, name });
    void this.transfer(nodes, target, false, (undo) => {
      const text = message(nodes.length, nodes[0]?.label ?? '');
      if (undo) {
        this.undo.offer(text, async () => undo());
      } else {
        this.toasts.show(text, 'success');
      }
    });
  }

  protected movingFolders(): string[] {
    return (this.moving() ?? []).filter((node) => node.data?.kind === 'folder').map((node) => node.id);
  }

  /** Moves (or, for pages, duplicates into) the folder `target` (`null` = the root); see `PagesItemActions.transfer`. */
  private transfer(
    nodes: readonly SfTreeNode<PageNodeData>[],
    target: string | null,
    copy: boolean,
    completed: (undo?: () => void) => void,
  ): Promise<void> {
    const parentOf = this.index().parentOf;
    return this.actions.transfer(this.projectKey(), nodes, target, copy, (uuid) => parentOf.get(uuid) ?? null, completed);
  }
}
