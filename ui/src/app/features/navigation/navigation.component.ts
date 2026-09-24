import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTreeComponent } from '../../shared/components/sf-tree.component';
import {
  SfStoreTreeNodeComponent,
  type FolderRenameFn,
  type StoreTreeMoveEvent,
  type StoreTreeNode,
} from '../../shared/components/sf-store-tree-node.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { NavFolderDetailComponent } from './nav-folder-detail.component';
import { NavReferenceDetailComponent } from './nav-reference-detail.component';
import { etagFor, NavigationService, type NavigationFolderView, type NavTreeView, type PageReferenceView } from './navigation.service';
import { sortNavTree } from '../../shared/tree-sort.util';
import { consumeQueryParam } from '../../shared/deep-link';
import { ProjectAccessStore } from '../../core/project/project-access.store';

interface RawFolderPayload {
  scope?: string;
  protected?: boolean;
  startNode?: { kind?: string; assetUuid?: string } | null;
}

interface RawReferencePayload {
  target?: { kind?: string; assetUuid?: string };
  label?: string | null;
}

/**
 * Navigation store — the same "tree + detail drawer" shape used by the
 * pages/media stores. Renders `GET .../navigation/tree` (always exactly one
 * top-level entry: the fixed, protected "All Navigation" wrapper root, spec
 * M13.1.2-style, generalized), and opens a folder- or reference-shaped
 * drawer on selection. The wrapper is unwrapped for display (`topLevelNodes`)
 * — its own "All navigation" affordance (the `navigation__clear` button)
 * replaces it, exactly matching Pages/Media's tree visualization — rather
 * than rendering the wrapper a second time as an ordinary folder row.
 */
@Component({
  selector: 'sf-navigation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfTreeComponent,
    SfCreateAssetDialogComponent,
    NavFolderDetailComponent,
    NavReferenceDetailComponent,
    SfStoreTreeNodeComponent,
  ],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` selects that page reference or folder (search deep link, M23.4.1). */
  readonly asset = input<string | undefined>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly nav = inject(NavigationService);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly loading = signal(false);
  readonly forest = signal<NavTreeView[]>([]);
  readonly selectedUuid = signal<string | null>(null);

  readonly folderDetail = signal<NavigationFolderView | null>(null);
  readonly referenceDetail = signal<PageReferenceView | null>(null);
  readonly detailLoading = signal(false);

  readonly newFolderOpen = signal(false);
  readonly creatingFolder = signal(false);
  readonly newReferenceOpen = signal(false);
  readonly creatingReference = signal(false);

  readonly selectedNode = computed<NavTreeView | null>(() => {
    const uuid = this.selectedUuid();
    if (!uuid) {
      return null;
    }
    return findNode(this.forest(), uuid);
  });

  /** The store's real top-level entries — the fixed "All Navigation" wrapper root's children
   * (see the class doc). */
  readonly topLevelNodes = computed<NavTreeView[]>(() => this.forest()[0]?.children ?? []);

  /**
   * The same entries in the store-agnostic shape {@link SfStoreTreeNodeComponent} renders. A
   * reference shows its resolved page path as the trailing badge; a folder shows one only when it
   * actually has a `startNode`, because for a folder an absent path is ambiguous (no entry page at
   * all vs. a broken one) and flagging it "unresolved" would be wrong.
   */
  readonly treeNodes = computed<StoreTreeNode[]>(() => this.topLevelNodes().map(toStoreNode));

  /** Navigation folders rename through the folder endpoint, not the generic asset one. */
  protected readonly renameFolder: FolderRenameFn = (projectKey, uuid, displayName, revision) =>
    this.nav.renameFolder(projectKey, uuid, displayName, revision === undefined ? undefined : etagFor(revision));

  /** The folder currently targeted by "New folder"/"New reference" — the selected folder, or
   * `undefined` (the project root — matches Pages' `selectedFolder() ?? undefined`) if nothing
   * folder-shaped is selected. */
  readonly targetFolderUuid = computed<string | undefined>(() => {
    const node = this.selectedNode();
    return node && node.type === 'FOLDER' && node.uuid ? node.uuid : undefined;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.reload(key));
    });
    effect(() => {
      const uuid = this.asset();
      if (!uuid) {
        return;
      }
      untracked(() => {
        this.select(uuid);
        consumeQueryParam(this.router, this.route, 'asset');
      });
    });
  }

  protected select(uuid: string): void {
    this.selectedUuid.set(uuid);
    this.loadDetail(uuid);
  }

  protected closeDetail(): void {
    this.selectedUuid.set(null);
    this.folderDetail.set(null);
    this.referenceDetail.set(null);
  }

  protected newFolder(): void {
    if (this.readOnly()) {
      return;
    }
    this.newFolderOpen.set(true);
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    if (this.readOnly()) {
      return;
    }
    const parentUuid = this.targetFolderUuid();
    this.creatingFolder.set(true);
    this.nav.createFolder(this.projectKey(), value.displayName, parentUuid).subscribe({
      next: () => {
        this.creatingFolder.set(false);
        this.newFolderOpen.set(false);
        this.toasts.show('Folder created', 'success');
        this.reload(this.projectKey());
      },
      error: () => {
        this.creatingFolder.set(false);
        this.toasts.show('Could not create folder — a folder with that name may already exist here.', 'error');
      },
    });
  }

  protected newReference(): void {
    if (this.readOnly()) {
      return;
    }
    this.newReferenceOpen.set(true);
  }

  protected closeNewReference(): void {
    this.newReferenceOpen.set(false);
  }

  protected submitNewReference(value: CreateAssetFormValue): void {
    if (this.readOnly()) {
      return;
    }
    const folderUuid = this.targetFolderUuid();
    this.creatingReference.set(true);
    this.nav
      .createReference(this.projectKey(), {
        displayName: value.displayName,
        folderUuid,
        targetKind: value.targetKind ?? 'PAGE',
        targetAssetUuid: value.targetAssetUuid,
      })
      .subscribe({
        next: (created) => {
          this.creatingReference.set(false);
          this.newReferenceOpen.set(false);
          this.toasts.show('Reference created', 'success');
          this.reload(this.projectKey());
          if (created.uuid) {
            this.select(created.uuid);
          }
        },
        error: () => {
          this.creatingReference.set(false);
          this.toasts.show('Could not create reference — try again in a moment.', 'error');
        },
      });
  }

  protected onMove(event: StoreTreeMoveEvent): void {
    if (this.readOnly()) {
      return;
    }
    const source = findNode(this.forest(), event.source);
    if (!source) {
      return;
    }
    const key = this.projectKey();
    const request$ =
      source.type === 'FOLDER'
        ? this.nav.moveFolder(key, event.source, event.target)
        : this.nav.moveReference(key, event.source, event.target);
    request$.subscribe({
      next: () => {
        this.toasts.show('Moved', 'success');
        this.reload(key);
      },
      error: () => this.toasts.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  protected onFolderChanged(): void {
    const uuid = this.selectedUuid();
    this.reload(this.projectKey());
    if (uuid) {
      this.loadDetail(uuid);
    }
  }

  protected onReferenceChanged(): void {
    const uuid = this.selectedUuid();
    this.reload(this.projectKey());
    if (uuid) {
      this.loadDetail(uuid);
    }
  }

  /** A tree-node's own context-menu Rename (folder or reference) succeeded — reload the tree, and the open detail drawer if it's showing the renamed node. */
  protected onTreeNodeRenamed(): void {
    const uuid = this.selectedUuid();
    this.reload(this.projectKey());
    if (uuid) {
      this.loadDetail(uuid);
    }
  }

  protected onFolderDeleted(): void {
    this.closeDetail();
    this.reload(this.projectKey());
  }

  protected onReferenceDeleted(): void {
    this.closeDetail();
    this.reload(this.projectKey());
  }

  /** Drop target for the "All navigation" root button — moves the dragged node to the project's
   * navigation root (mirrors `PagesListComponent.onRootDragOver`). */
  protected onRootDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  protected onRootDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    if (!source || this.readOnly()) {
      return;
    }
    const node = findNode(this.forest(), source);
    if (!node) {
      return;
    }
    const key = this.projectKey();
    const request$ = node.type === 'FOLDER'
      ? this.nav.moveFolder(key, source, undefined)
      : this.nav.moveReference(key, source, undefined);
    request$.subscribe({
      next: () => {
        this.toasts.show('Moved to root', 'success');
        this.reload(key);
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  /** "All navigation" is the store's root — it can't be renamed, moved, or deleted, but you can
   * create a folder/reference directly in it (mirrors `PagesListComponent.onRootContextMenu`). */
  protected onRootContextMenu(event: MouseEvent): void {
    if (this.readOnly()) {
      return;
    }
    this.closeDetail();
    const items: ContextMenuItem[] = [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.newFolder() },
      { label: 'New reference', icon: 'link', action: () => this.newReference() },
    ];
    this.menu.open(event, items);
  }

  private reload(key: string): void {
    if (!key) {
      return;
    }
    this.loading.set(true);
    this.nav.tree(key).subscribe({
      next: (tree) => {
        this.forest.set(sortNavTree(tree));
        this.loading.set(false);
      },
      error: () => {
        this.toasts.show('Could not load navigation tree — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }

  private loadDetail(uuid: string): void {
    this.detailLoading.set(true);
    this.api.assetDetail(this.projectKey(), uuid).subscribe({
      next: (detail) => {
        this.detailLoading.set(false);
        if (detail.type === 'FOLDER') {
          const payload = (detail.payload ?? {}) as unknown as RawFolderPayload;
          const startNode = payload.startNode;
          this.folderDetail.set({
            uuid: detail.uuid,
            uid: detail.uid,
            displayName: detail.displayName,
            revision: detail.revision,
            folderPath: detail.folderPath,
            protectedFolder: payload.protected === true,
            startNode:
              startNode && startNode.kind && startNode.assetUuid
                ? { kind: startNode.kind, assetUuid: startNode.assetUuid }
                : undefined,
          });
          this.referenceDetail.set(null);
        } else if (detail.type === 'PAGE_REFERENCE') {
          const payload = (detail.payload ?? {}) as unknown as RawReferencePayload;
          this.referenceDetail.set({
            uuid: detail.uuid,
            uid: detail.uid,
            displayName: detail.displayName,
            revision: detail.revision,
            folderPath: detail.folderPath,
            targetKind: payload.target?.kind,
            targetAssetUuid: payload.target?.assetUuid,
            label: payload.label ?? undefined,
          });
          this.folderDetail.set(null);
        }
      },
      error: () => {
        this.detailLoading.set(false);
        this.toasts.show('Could not load details — try again in a moment.', 'error');
      },
    });
  }
}

function toStoreNode(node: NavTreeView): StoreTreeNode {
  const isFolder = node.type === 'FOLDER';
  const path = node.resolvedPagePath;
  return {
    uuid: node.uuid,
    uid: node.uid,
    displayName: node.displayName,
    kind: isFolder ? 'FOLDER' : 'LEAF',
    icon: 'link',
    protectedFolder: node.protectedFolder === true,
    revision: node.revision,
    badge: path
      ? { text: `→ ${path}` }
      : isFolder
        ? undefined
        : { text: 'unresolved', broken: true },
    children: (node.children ?? []).map(toStoreNode),
  };
}

function findNode(nodes: NavTreeView[], uuid: string): NavTreeView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const found = findNode(node.children ?? [], uuid);
    if (found) {
      return found;
    }
  }
  return null;
}
