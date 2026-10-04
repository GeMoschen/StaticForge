import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FAVORITES_NODE, FavoriteTreeService, isFavoriteNode } from '../../../core/assets/favorite-tree.service';
import { FavoritesService } from '../../../core/assets/favorites.service';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { ToastService } from '../../../core/ui/toast.service';
import type { ContextMenuItem } from '../../../shared/services/context-menu.service';
import { SfSearchInputComponent } from '../../../shared/components/forms/sf-search-input.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import {
  type SfTreeAction,
  SfTreeComponent,
  type SfTreeCreateKind,
  type SfTreeCreateRequest,
  type SfTreeForeignDrop,
  type SfTreeMoveRequest,
  type SfTreeNameContext,
  type SfTreeRenameRequest,
} from '../../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../../shared/components/tree/tree-model';
import { MediaUploadStore } from './media-upload.store';
import { MediaFolderActions } from './media-folder-actions';
import { MediaMover } from './media-mover';
import { type FolderView, MediaLibraryStore } from './media-library.store';

/** Whether a folder's name contains `query` (lower case), or any folder below it does: the filter keeps it. */
function folderMatches(folder: FolderView, query: string): boolean {
  return !query || (folder.displayName ?? folder.uid ?? '').toLowerCase().includes(query) || (folder.children ?? []).some((c) => folderMatches(c, query));
}

/** Every folder of a forest, depth first. */
function allFolders(forest: readonly FolderView[]): FolderView[] {
  return forest.flatMap((folder) => [folder, ...allFolders(folder.children ?? [])]);
}

/**
 * The folder pane of the media library (decision 19): the folders only (the pane is titled "Folders", so files don't belong
 * in it) as an `sf-tree` — each folder with its file count and, in developer mode, its UID — under a *New folder* button
 * and a filter field. The filter keeps a folder when its name matches or a folder below it does, and opens the folders on
 * the way (decision 90; the tree's own filter is off). Creating and renaming are inline; deleting asks first and offers Undo;
 * folders are moved by dragging, cut and paste, or *Move to…* — and files are moved by dragging cards from the grid onto a
 * folder (the folder they are in refuses, the top level takes them). The open folder is selected, revealed and expanded.
 *
 * A pinned *Favorites* node heads the tree while the project has favorites (decisions 57–58): it lists them from every
 * store as flat shortcuts, a favorite folder expands lazily, a click on the node opens the Favorites list in the main pane,
 * and nothing in the branch can be renamed, moved or deleted. *Add to / Remove from favorites* is in the folders' menu.
 */
@Component({
  selector: 'sf-media-library-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfBannerComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSearchInputComponent,
    SfSkeletonComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-library-tree.component.html',
  styleUrl: './media-library-tree.component.scss',
})
export class MediaLibraryTreeComponent {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly folders = inject(MediaFolderActions);
  private readonly developerMode = inject(DeveloperModeService);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly mover = inject(MediaMover);
  private readonly uploads = inject(MediaUploadStore);
  private readonly favorites = inject(FavoritesService);
  private readonly favoriteTree = inject(FavoriteTreeService);
  private readonly tree = viewChild<SfTreeComponent<FolderView>>(SfTreeComponent);

  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'create'];
  protected readonly createKinds: readonly SfTreeCreateKind[] = ['folder'];

  /** The filter field's text. */
  protected readonly filter = signal('');
  private readonly query = computed(() => this.filter().trim().toLowerCase());
  /** The filter matches no folder: the pane says so, with *Clear filter*. */
  protected readonly noMatch = computed(
    () => this.query() !== '' && this.library.treeReady() && !this.library.topLevelFolders().some((f) => folderMatches(f, this.query())),
  );
  /** What the tree should show as selected: the Favorites node in the Favorites list, else the open folder. */
  private readonly expectedSelection = computed<string[]>(() => {
    if (this.library.favoritesView()) {
      return [FAVORITES_NODE];
    }
    return this.library.folderUuid() ? [this.library.folderUuid()] : [];
  });
  /** Two-way with the tree, which selects a node on click: {@link resyncUnless} puts it back when the click did not navigate. */
  protected readonly selection = signal<string[]>([]);

  /**
   * The folders (the wrapper root's children and below), each with its file count (once the project's files are read) and,
   * in developer mode, its UID. A new loader is made whenever the folders, the counts or the filter change; the tree then
   * reloads and keeps what is expanded.
   */
  protected readonly loader = computed<SfTreeLoader<FolderView>>(() => {
    const dev = this.developerMode.enabled();
    const query = this.query();
    const roots = this.library.topLevelFolders();
    const counts = this.library.allLoaded() ? this.library.mediaByFolder() : null;
    const children = (parent: FolderView | null): FolderView[] => (parent === null ? roots : (parent.children ?? [])).filter((f) => folderMatches(f, query));
    const favorites = this.favorites.list();
    const key = this.library.projectKey();
    const favoritesLabel = this.transloco.translate('media.folders.favorites');
    const folderNodes = (parent: SfTreeNode<FolderView> | null): SfTreeNode<FolderView>[] =>
      children(parent?.data ?? null).map<SfTreeNode<FolderView>>((folder) => ({
        id: folder.uuid ?? '',
        label: folder.displayName ?? folder.uid ?? '',
        icon: 'folder',
        secondary: dev ? (folder.uid ?? null) : null,
        badges: counts ? [{ kind: 'badge', label: String(counts.get(folder.path ?? '')?.length ?? 0) }] : [],
        hasChildren: children(folder).length > 0,
        droppable: true,
        data: folder,
      }));
    return (parent) => {
      if (parent === null) {
        // The pinned Favorites node only while there are favorites (and the folder filter is not narrowing the tree).
        return favorites.length > 0 && !query ? [this.favoriteTree.rootNode<FolderView>(favoritesLabel), ...folderNodes(null)] : folderNodes(null);
      }
      if (parent.id === FAVORITES_NODE) {
        return this.favoriteTree.nodes<FolderView>(favorites);
      }
      return isFavoriteNode(parent.id) ? this.favoriteTree.children<FolderView>(key, parent) : folderNodes(parent);
    };
  });

  /** The *Favorites* branch is a view: nothing in it is renamed, deleted, moved or created. */
  protected readonly allowAction = (_action: SfTreeAction, nodes: readonly SfTreeNode<FolderView>[]): boolean =>
    this.library.canEdit() && !nodes.some((node) => isFavoriteNode(node.id));

  /** A folder never goes into a favorite, only into a real folder. */
  protected readonly canDrop = (_dragged: readonly SfTreeNode<FolderView>[], target: SfTreeNode<FolderView> | null): boolean =>
    target === null || !isFavoriteNode(target.id);

  /** Files dragged from the grid may land on any real folder but the one they are in, and on the top level. */
  protected readonly acceptDrag = (event: DragEvent, target: SfTreeNode<FolderView> | null): boolean =>
    this.mover.acceptsDrag(event, target) && (target === null || !isFavoriteNode(target.id));

  /** *Add to / Remove from favorites* for a folder (decision 57); the Favorites branch itself has no menu. */
  protected readonly menuItems = (nodes: readonly SfTreeNode<FolderView>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node?.data?.uuid || isFavoriteNode(node.id)) {
      return [];
    }
    const on = this.favorites.isFavorite(node.id);
    return [
      ...(this.uploads.canUpload() && !this.library.favoritesView()
        ? [{ label: this.transloco.translate('media.toolbar.upload'), icon: 'upload', action: () => this.uploads.pickFiles(node.id) }]
        : []),
      {
        label: this.transloco.translate(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: node.label }),
        icon: 'star',
        action: () => this.toggleFavorite(node),
      },
    ];
  };

  /** A right click on empty space acts as one on the top level: *Upload* and *New folder*. */
  protected readonly rootMenuItems = (): ContextMenuItem[] =>
    [
      ...(this.uploads.canUpload() ? [{ label: this.transloco.translate('media.toolbar.upload'), icon: 'upload', action: () => this.uploads.pickFiles('') }] : []),
      ...(this.library.canEdit()
        ? [{ label: this.transloco.translate('shared.tree.newFolder'), icon: 'create_new_folder', action: () => void this.tree()?.startCreate(null, 'folder') }]
        : []),
    ];

  /** A folder name is free among its siblings (the server enforces it; this answers before the round trip). */
  protected readonly validateName = (name: string, context: SfTreeNameContext<FolderView>): string | null => {
    const parent = context.parent?.data ?? null;
    const siblings = parent === null ? this.library.topLevelFolders() : (parent.children ?? []);
    const taken = siblings.some(
      (sibling) => sibling.uuid !== context.node?.id && (sibling.displayName ?? sibling.uid ?? '').toLowerCase() === name.toLowerCase(),
    );
    return taken ? this.transloco.translate('media.folders.nameTaken') : null;
  };

  /** Deleting asks, deletes and offers Undo itself (with the count of what is inside), so the tree's own flow is skipped. */
  protected readonly confirmDelete = async (nodes: readonly SfTreeNode<FolderView>[]): Promise<boolean> => {
    for (const node of nodes) {
      if (node.data) {
        await this.folders.deleteFolder(node.data);
      }
    }
    return false;
  };

  constructor() {
    // The tree's selection follows the URL: the open folder, or the Favorites node.
    effect(() => {
      const expected = this.expectedSelection();
      untracked(() => this.selection.set(expected));
    });

    // The page header's folder menu and the empty library ask for an inline rename or create.
    effect(() => {
      const request = this.folders.treeRequest();
      const tree = this.tree();
      if (request && tree) {
        untracked(() => {
          this.folders.treeRequest.set(null);
          if (request.kind === 'rename' && request.uuid) {
            tree.startRename(request.uuid);
          } else if (request.kind === 'create') {
            void tree.startCreate(request.uuid, 'folder');
          }
        });
      }
    });

    // Keep the open folder visible and expanded in the tree.
    effect(() => {
      this.library.folderUuid();
      const ready = this.library.treeReady();
      if (ready && !this.library.favoritesView()) {
        untracked(() => setTimeout(() => void this.reveal()));
      }
    });

    // With a filter, the folders on the way to a match open.
    effect(() => {
      const query = this.query();
      if (query && this.library.treeReady()) {
        // The tree reloads for the new filter first; then the folders that lead to a match open.
        untracked(() => setTimeout(() => void this.expandMatches(query)));
      }
    });
  }

  private async reveal(): Promise<void> {
    for (const folder of this.library.folderTrail()) {
      if (folder.uuid) {
        await this.tree()?.expand(folder.uuid);
      }
    }
  }

  private async expandMatches(query: string): Promise<void> {
    if (query !== this.query()) {
      return; // typed on since
    }
    for (const folder of allFolders(this.library.topLevelFolders())) {
      if (folder.uuid && (folder.children ?? []).some((child) => folderMatches(child, query))) {
        await this.tree()?.expand(folder.uuid);
      }
    }
  }

  /** A left click on empty space opens the top level (the library root). */
  protected onOpenRoot(): void {
    void this.library.openFolder(null).then((followed) => this.resyncUnless(followed));
  }

  protected onOpen(node: SfTreeNode<FolderView>): void {
    if (node.id === FAVORITES_NODE) {
      void this.library.openFavorites().then((followed) => this.resyncUnless(followed));
    } else if (isFavoriteNode(node.id)) {
      const route = this.favoriteTree.routeOf(this.library.projectKey(), node);
      if (route) {
        void this.router.navigate([...route.commands], { queryParams: route.queryParams });
      }
    } else {
      void this.library.openFolder(node.id).then((followed) => this.resyncUnless(followed));
    }
  }

  /**
   * The tree selects a node when it is clicked. When the library did not follow (the drawer's leave guard refused: the open
   * file has unsaved edits and the person kept them), the selection goes back to what the URL says.
   */
  private resyncUnless(followed: boolean): void {
    if (!followed) {
      // A copy: the binding only reaches the tree when the value is not the one it was last given.
      this.selection.set([...this.expectedSelection()]);
    }
  }

  private toggleFavorite(node: SfTreeNode<FolderView>): void {
    const folder = node.data;
    if (!folder?.uuid) {
      return;
    }
    const on = this.favorites.toggle({ type: 'FOLDER', uuid: folder.uuid, displayName: node.label, folderPath: folder.path });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name: node.label }), 'info');
  }

  protected onCreate(request: SfTreeCreateRequest<FolderView>): void {
    if (request.kind !== 'folder' || !this.library.canEdit()) {
      return;
    }
    this.folders.createFolder(request.parent?.id, request.name).subscribe({
      next: (created) => {
        if (request.parent) {
          void this.tree()?.expand(request.parent.id);
        }
        if (created.uuid) {
          this.library.openFolder(created.uuid);
        }
      },
      error: () => undefined, // the action toasted
    });
  }

  protected onRename(request: SfTreeRenameRequest<FolderView>): void {
    const folder = request.node.data;
    if (!folder || !this.library.canEdit()) {
      return;
    }
    this.folders.renameFolderTo(folder, request.name).subscribe({
      next: () => this.library.reloadFolders(),
      error: () => {
        this.toasts.show(this.transloco.translate('media.folders.renameFailed', { name: folder.displayName ?? folder.uid ?? '' }), 'error');
        this.library.reloadFolders();
      },
    });
  }

  protected onMove(request: SfTreeMoveRequest<FolderView>): void {
    void this.mover.moveTo(
      request.nodes.map((node) => node.id),
      request.target?.id ?? null,
      'folder',
    );
  }

  protected onMoveTo(nodes: SfTreeNode<FolderView>[]): void {
    void this.mover.moveFolders(nodes.map((node) => node.id));
  }

  /** Files dropped from the grid onto a folder (or the top level) move there, with Undo. */
  protected onForeignDrop(drop: SfTreeForeignDrop<FolderView>): void {
    void this.mover.drop(drop.event, drop.target);
  }
}
