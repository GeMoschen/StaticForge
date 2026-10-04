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
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { type Observable, Subscription, forkJoin, tap } from 'rxjs';
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
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
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
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { GlobalSetDetailComponent, type DeletedGlobalSet } from './global-set-detail.component';
import { GlobalsItemActions } from './globals-item-actions.service';
import {
  EMPTY_INDEX,
  GLOBAL_SET_ICON,
  type GlobalEntry,
  type GlobalsNodeOptions,
  buildIndex,
  childEntries,
  childNodes,
  foldersOnly,
  idPath,
  isEmptyIndex,
  searchPaths,
} from './globals-tree.util';
import { GlobalsService, type FolderView, type GlobalSetSummaryView } from './globals.service';

/** The Content CDL a newly created property set starts with — one field, so the Values tab is never blank. */
const STARTER_CONTENT = `editor text title { label "Title" required }
`;

const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * Globals store (M35.22) — the project's named property sets ("global sets"): the tree on the left, and in the main pane
 * the open set, the open folder or the Favorites list.
 *
 * <p>The tree (`sf-tree`) holds folders and, as leaves, the sets in them and loads lazily from the folder tree and set
 * list this screen keeps in memory, so its filter is answered locally. A *Favorites* node is pinned on top while the
 * project has favorites. The open item is in the URL (`?asset=<uuid>`, `?gtab=` for the tab, `?favorites=1`), so it
 * survives a reload and is recorded as a recent. Changing it — another set, a folder, leaving the area — goes through
 * the unsaved-changes guard on the route (`globalsLeaveGuard`).
 *
 * <p>Creating, renaming, moving and deleting are for developers outside time travel; each change offers one Undo, and
 * every delete asks first (`ConfirmService`).
 */
@Component({
  selector: 'sf-globals',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FavoritesViewComponent,
    FolderMoveDialogComponent,
    GlobalSetDetailComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  templateUrl: './globals.component.html',
  styleUrl: './globals.component.scss',
})
export class GlobalsComponent {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` is the open set or folder (kept in the URL, so recents and deep links find it). */
  readonly asset = input<string | undefined>();
  /** `?favorites=1` shows the Favorites list. */
  readonly favoritesParam = input<string | undefined>(undefined, { alias: 'favorites' });
  /** `?gtab=schema` opens the set's Schema tab (developer mode only). */
  readonly gtab = input<string | undefined>();

  private readonly globals = inject(GlobalsService);
  private readonly actions = inject(GlobalsItemActions);
  private readonly api = inject(ApiClient);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly favorites = inject(FavoritesService);
  private readonly favoriteTree = inject(FavoriteTreeService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly developerMode = inject(DeveloperModeService);

  /** Creating, renaming, moving and deleting: developers, outside time travel and archived projects. */
  protected readonly canManage = inject(ProjectPermissionsStore).canEditTemplates;

  private readonly tree = viewChild<SfTreeComponent<GlobalEntry>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  /** Sets are not copied, only moved. */
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'create'];

  // ── Data ───────────────────────────────────────────────────────────────────

  protected readonly folders = signal<FolderView[]>([]);
  private readonly sets = signal<GlobalSetSummaryView[]>([]);
  /** The first read of the store returned. */
  protected readonly loaded = signal(false);
  protected readonly failed = signal(false);
  protected readonly index = computed(() => (this.loaded() ? buildIndex(this.folders(), this.sets()) : EMPTY_INDEX));
  /** The folder tree without sets: where a move can go. */
  protected readonly folderTree = computed(() => foldersOnly(this.folders()));

  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly nodeOptions = computed<GlobalsNodeOptions>(() => {
    this.language();
    const t = (key: string) => this.transloco.translate(`globals.tree.status.${key}`);
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

  /** The open set or folder; `null` when `?asset=` names nothing in the store (yet). */
  protected readonly openEntry = computed<GlobalEntry | null>(() => {
    const uuid = this.asset();
    return uuid ? (this.index().entries.get(uuid) ?? null) : null;
  });
  protected readonly mode = computed<'set' | 'folder' | 'favorites' | 'none'>(() => {
    const entry = this.openEntry();
    if (entry) {
      return entry.kind;
    }
    return this.asset() ? 'none' : this.favoritesParam() ? 'favorites' : 'none';
  });
  protected readonly setTab = computed<'values' | 'schema'>(() => (this.gtab() === 'schema' ? 'schema' : 'values'));

  protected readonly treeSelection = computed<string[]>(() => {
    const entry = this.openEntry();
    if (entry) {
      return [entry.uuid];
    }
    return this.mode() === 'favorites' ? [FAVORITES_NODE] : [];
  });

  protected readonly emptyStore = computed(() => this.loaded() && !this.failed() && isEmptyIndex(this.index()));

  // ── Tree wiring ────────────────────────────────────────────────────────────

  protected readonly loader = computed<SfTreeLoader<GlobalEntry>>(() => {
    const index = this.index();
    const options = this.nodeOptions();
    const favorites = this.favorites.list();
    const key = this.projectKey();
    const label = this.transloco.translate('globals.tree.favorites');
    return (parent) => {
      if (parent === null) {
        const nodes = childNodes(index, null, options);
        return favorites.length > 0 ? [this.favoriteTree.rootNode<GlobalEntry>(label), ...nodes] : nodes;
      }
      if (parent.id === FAVORITES_NODE) {
        return this.favoriteTree.nodes<GlobalEntry>(favorites);
      }
      if (isFavoriteNode(parent.id)) {
        return this.favoriteTree.children<GlobalEntry>(key, parent);
      }
      return childNodes(index, parent.id, options);
    };
  });

  protected readonly search = (query: string): readonly (readonly string[])[] => searchPaths(this.index(), query);

  /** The *Favorites* branch is a view: nothing in it is renamed, deleted, moved or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<GlobalEntry>[]): boolean =>
    this.canManage() && !nodes.some((node) => isFavoriteNode(node.id));

  /** Nothing goes into a favorite, only into a real folder. */
  protected readonly canDrop = (_dragged: readonly SfTreeNode<GlobalEntry>[], target: SfTreeNode<GlobalEntry> | null): boolean =>
    target === null || !isFavoriteNode(target.id);

  /** A name is free among the siblings of its kind (the server enforces it for UIDs; this answers before the round trip). */
  protected readonly validateName = (name: string, context: SfTreeNameContext<GlobalEntry>): string | null => {
    const kind = context.node?.data?.kind ?? 'folder';
    const taken = childEntries(this.index(), context.parent?.id ?? null).some(
      (sibling) => sibling.uuid !== context.node?.id && sibling.kind === kind && sibling.name.toLowerCase() === name.toLowerCase(),
    );
    return taken ? this.transloco.translate('globals.tree.nameTaken') : null;
  };

  protected readonly confirmDelete = (nodes: readonly SfTreeNode<GlobalEntry>[]): Promise<boolean> =>
    this.actions.confirmDelete(
      nodes.flatMap((node) => (node.data ? [node.data] : [])),
      this.injector,
    );

  /**
   * The host's entries of the one menu, between the tree's own (*New folder*, *Rename*, *Cut*, *Paste*, *Move to…*) and
   * *Delete*: *New global set* in a folder, and *Add to / Remove from favorites*.
   */
  protected readonly menuItems = (nodes: readonly SfTreeNode<GlobalEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    const entry = node?.data;
    if (!node || !entry || isFavoriteNode(node.id)) {
      return [];
    }
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const items: ContextMenuItem[] = [];
    if (this.canManage() && entry.kind === 'folder') {
      items.push({ label: t('globals.tree.newSet'), icon: 'note_add', action: () => this.openNewSet(node.id) });
    }
    const on = this.favorites.isFavorite(node.id);
    items.push({
      label: t(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: node.label }),
      icon: 'star',
      action: () => this.toggleFavorite(node),
    });
    return items;
  };

  /** The head's *New* menu: where it creates is the open folder (or the folder of the open set). */
  protected readonly newItems = computed<SfMenuItem[]>(() => {
    this.language();
    return [
      {
        id: 'set',
        label: this.transloco.translate('globals.tree.newSet'),
        icon: 'note_add',
        action: () => this.openNewSet(this.openFolderUuid()),
      },
      {
        id: 'folder',
        label: this.transloco.translate('globals.tree.newFolder'),
        icon: 'create_new_folder',
        action: () => void this.tree()?.startCreate(this.openFolderUuid(), 'folder'),
      },
    ];
  });

  // ── Dialogs ────────────────────────────────────────────────────────────────

  protected readonly newFolderOpen = signal(false);
  protected readonly newSetOpen = signal(false);
  protected readonly creating = signal(false);
  /** The folder the open "New …" dialog creates into (`null` = the store root). */
  private createTarget: string | null = null;
  protected readonly moving = signal<readonly GlobalEntry[] | null>(null);

  constructor() {
    // The store again whenever something changed here, or a release action changed the statuses (M27.6.1).
    effect(() => {
      const key = this.projectKey();
      this.releaseEvents.version();
      if (key) {
        untracked(() => this.reload(key));
      }
    });

    // An open editor's release bar read a new status: the tree row shows it at once.
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
      this.asset();
      if (this.loaded()) {
        untracked(() => afterNextRender(() => void this.revealOpen(), { injector: this.injector }));
      }
    });
  }

  /** `n` creates a global set (M35.14). */
  private readonly newSetShortcut = inject(ShortcutService).use([
    createShortcut({
      handler: () => (this.canManage() ? this.openNewSet(this.openFolderUuid()) : false),
      palette: { label: 'frame.shortcuts.items.createGlobalSet' },
    }),
  ]);

  // ── Reading ────────────────────────────────────────────────────────────────

  private storeRead: Subscription | null = null;

  /** The folder tree and the set list; a newer read replaces the one in flight. */
  private reload(key: string): void {
    this.storeRead?.unsubscribe();
    this.storeRead = forkJoin({ folders: this.globals.folders(key), sets: this.globals.list(key) }).subscribe({
      next: ({ folders, sets }) => {
        this.folders.set(folders ?? []);
        this.sets.set(sets ?? []);
        this.failed.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.failed.set(true);
        this.loaded.set(true);
        this.toasts.show(this.transloco.translate('globals.tree.toast.loadFailed'), 'error');
      },
    });
  }

  /** Something changed: the tree reads the store again. */
  protected changed(): void {
    this.reload(this.projectKey());
  }

  /** The folder an action without a target aims at: the open folder, the folder of the open set, else the root. */
  private openFolderUuid(): string | null {
    const entry = this.openEntry();
    if (!entry) {
      return null;
    }
    return entry.kind === 'folder' ? entry.uuid : (this.index().parentOf.get(entry.uuid) ?? null);
  }

  private async revealOpen(): Promise<void> {
    const tree = this.tree();
    const entry = this.openEntry();
    if (!tree || !entry) {
      return;
    }
    const path = idPath(this.index(), entry.uuid);
    for (const ancestor of entry.kind === 'set' ? path.slice(0, -1) : path) {
      await tree.expand(ancestor);
    }
  }

  // ── Opening (the URL is the selection; the route's guard asks about unsaved edits) ──

  protected onOpen(node: SfTreeNode<GlobalEntry>): void {
    const key = this.projectKey();
    if (node.id === FAVORITES_NODE) {
      void this.router.navigate(['/p', key, 'globals'], { queryParams: { favorites: 1 } });
      return;
    }
    if (isFavoriteNode(node.id)) {
      const route = this.favoriteTree.routeOf(key, node);
      if (route) {
        void this.router.navigate([...route.commands], { queryParams: route.queryParams });
      }
      return;
    }
    this.openEntryByUuid(node.id);
  }

  protected openEntryByUuid(uuid: string | null): void {
    void this.router.navigate(['/p', this.projectKey(), 'globals'], { queryParams: uuid ? { asset: uuid } : {} });
  }

  /** The open set's tab is in the URL too (a replace: it is not a new place to go back to). */
  protected onTabChange(tab: 'values' | 'schema'): void {
    const uuid = this.asset();
    if (uuid) {
      void this.router.navigate(['/p', this.projectKey(), 'globals'], {
        queryParams: { asset: uuid, ...(tab === 'schema' ? { gtab: 'schema' } : {}) },
        replaceUrl: true,
      });
    }
  }

  protected readonly setIcon = GLOBAL_SET_ICON;

  // ── Favorites ──────────────────────────────────────────────────────────────

  private toggleFavorite(node: SfTreeNode<GlobalEntry>): void {
    const entry = node.data;
    if (!entry) {
      return;
    }
    const on = this.favorites.toggle({
      type: entry.kind === 'folder' ? 'FOLDER' : 'GLOBAL_SET',
      uuid: entry.uuid,
      displayName: entry.name,
      folderPath: entry.path,
    });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name: node.label }), 'info');
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /** A folder created in place in the tree. */
  protected onCreate(request: SfTreeCreateRequest<GlobalEntry>): void {
    if (request.kind !== 'folder' || !this.canManage()) {
      return;
    }
    this.globals.createFolder(this.projectKey(), request.name, request.parent?.id).subscribe({
      next: (created) => {
        this.toasts.show(this.transloco.translate('globals.tree.toast.folderCreated', { name: request.name }), 'success');
        this.changed();
        if (request.parent) {
          void this.tree()?.expand(request.parent.id);
        }
        if (created.uuid) {
          this.openEntryByUuid(created.uuid);
        }
      },
      error: () => this.toasts.show(this.transloco.translate('globals.tree.toast.folderCreateFailed'), 'error'),
    });
  }

  /** Opens the "New global set" dialog; it creates in `folderUuid` (`null` = the store root). */
  protected openNewSet(folderUuid: string | null): void {
    if (this.canManage()) {
      this.createTarget = folderUuid;
      this.newSetOpen.set(true);
    }
  }

  /** The empty states' *New global set* creates at the store root, or in the open folder. */
  protected openNewSetHere(): void {
    this.openNewSet(this.openFolderUuid());
  }

  protected createFolderAtRoot(): void {
    void this.tree()?.startCreate(null, 'folder');
  }

  protected submitNewSet(value: CreateAssetFormValue): void {
    if (!this.canManage()) {
      return;
    }
    this.creating.set(true);
    this.globals
      .create(this.projectKey(), {
        parentFolderUuid: this.createTarget ?? undefined,
        displayName: value.displayName,
        contentCdl: STARTER_CONTENT,
      })
      .subscribe({
        next: (created) => {
          this.creating.set(false);
          this.newSetOpen.set(false);
          this.toasts.show(this.transloco.translate('globals.tree.toast.setCreated', { name: value.displayName }), 'success');
          this.changed();
          if (created.uuid) {
            this.openEntryByUuid(created.uuid);
          }
        },
        error: (err: unknown) => {
          this.creating.set(false);
          const detail = err instanceof HttpErrorResponse ? (err.error as { detail?: string } | null)?.detail : undefined;
          this.toasts.show(detail ?? this.transloco.translate('globals.tree.toast.setCreateFailed'), 'error');
        },
      });
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected onRename(request: SfTreeRenameRequest<GlobalEntry>): void {
    const entry = request.node.data;
    if (!entry || !this.canManage()) {
      return;
    }
    const key = this.projectKey();
    const from = entry.name;
    const rename = (name: string, etag?: number): Observable<{ revision?: number }> =>
      entry.kind === 'folder'
        ? this.api.renameFolder(key, entry.uuid, { displayName: name }, etag)
        : this.api.renameAsset(key, entry.uuid, { displayName: name }, etag);
    rename(request.name).subscribe({
      next: (renamed) => {
        const message = this.transloco.translate('globals.tree.toast.renamed', { from, to: request.name });
        // Undo renames back; the etag is the revision the rename produced.
        this.undo.offer(message, () => rename(from, renamed.revision).pipe(tap(() => this.changed())));
        this.changed();
      },
      error: () => this.toasts.show(this.transloco.translate('globals.tree.toast.renameFailed', { name: from }), 'error'),
    });
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  protected onDelete(request: SfTreeDeleteRequest<GlobalEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void (async () => {
      const change = await this.actions.delete(this.projectKey(), entries);
      if (change.done.length > 0) {
        this.leaveDeleted(change.done.map((entry) => entry.uuid));
      }
      this.changed();
      if (change.failed) {
        // What was deleted before the failure stays deleted and stays undoable.
        this.toasts.show(this.transloco.translate('globals.tree.toast.deleteFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
        if (change.done.length > 0) {
          this.undo.offerGroup(
            this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].name }),
            this.withRefresh(change.steps),
          );
        }
        return;
      }
      request.completed(() => void this.actions.runUndo(this.withRefresh(change.steps)));
    })();
  }

  /** What is open was deleted: the area goes back to the store root. */
  private leaveDeleted(uuids: readonly string[]): void {
    const index = this.index();
    const open = this.asset();
    if (open && uuids.some((uuid) => uuid === open || idPath(index, open).includes(uuid))) {
      this.openEntryByUuid(null);
    }
  }

  /** The open set's own *Delete…* (it asked already): the area closes it and offers one Undo that restores it. */
  protected onSetDeleted(deleted: DeletedGlobalSet): void {
    const key = this.projectKey();
    this.openEntryByUuid(null);
    this.changed();
    this.undo.offer(
      this.transloco.translate(deleted.online ? 'globals.detail.toast.deletedOnline' : 'globals.detail.toast.deleted', { name: deleted.name }),
      () => restoreDeletedAsset(this.api, key, deleted.uuid).pipe(tap(() => this.changed())),
    );
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  /** Drag and drop and cut + paste in the tree. */
  protected onMove(request: SfTreeMoveRequest<GlobalEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void this.transfer(entries, request.target?.id ?? null, (steps) => request.completed(steps ? () => void this.actions.runUndo(steps) : undefined));
  }

  /** The tree's *Move to…*: a picker for the destination. */
  protected openMoveDialog(nodes: SfTreeNode<GlobalEntry>[]): void {
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

  /** Moves into the folder `target` (`null` = the store root). Undo moves back. Stops at the first failure. */
  private async transfer(entries: readonly GlobalEntry[], target: string | null, completed: (undo?: UndoStep[]) => void): Promise<void> {
    const index = this.index();
    const change = await this.actions.move(this.projectKey(), entries, target, (entry) => index.parentOf.get(entry.uuid) ?? null);
    this.changed();
    if (change.failed) {
      this.toasts.show(this.transloco.translate('globals.tree.toast.moveFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
      if (change.done.length === 0) {
        return;
      }
    }
    completed(change.done.length > 0 ? this.withRefresh(change.steps) : undefined);
  }

  /** After an Undo the tree reads the store again: the first step is the one that runs last. */
  private withRefresh(steps: readonly UndoStep[]): UndoStep[] {
    return [async () => this.changed(), ...steps];
  }
}
