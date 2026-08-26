import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTreeComponent } from '../../shared/components/sf-tree.component';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../shared/components/sf-asset-picker-dialog.component';
import { NavFolderDetailComponent } from './nav-folder-detail.component';
import { NavReferenceDetailComponent } from './nav-reference-detail.component';
import { NavTreeNodeComponent, type NavMoveEvent } from './nav-tree-node.component';
import { NavigationService, type NavigationFolderView, type NavTreeView, type PageReferenceView } from './navigation.service';

interface RawFolderPayload {
  scope?: string;
  startNode?: { kind?: string; assetUuid?: string } | null;
}

interface RawReferencePayload {
  target?: { kind?: string; assetUuid?: string };
  label?: string | null;
}

/**
 * Navigation store — the same "tree + detail drawer" shape used by the
 * pages/media stores. Renders `GET .../navigation/tree` (folders +
 * `PageReference` leaves), and opens a folder- or reference-shaped drawer on
 * selection. The single eager navigation root (`M8.1.2`) is shown as the
 * top-level tree node with rename/delete disabled, matching how the media
 * store's "All media" root restricts itself to "new subfolder" only.
 */
@Component({
  selector: 'sf-navigation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfSpinnerComponent,
    SfTreeComponent,
    SfAssetPickerDialogComponent,
    NavFolderDetailComponent,
    NavReferenceDetailComponent,
    NavTreeNodeComponent,
  ],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
  readonly projectKey = input.required<string>();

  private readonly nav = inject(NavigationService);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  readonly loading = signal(false);
  readonly root = signal<NavTreeView | null>(null);
  readonly selectedUuid = signal<string | null>(null);

  readonly folderDetail = signal<NavigationFolderView | null>(null);
  readonly referenceDetail = signal<PageReferenceView | null>(null);
  readonly detailLoading = signal(false);

  /** Target folder uuid for a pending "New reference" creation, awaiting a page pick from the shared asset picker. */
  private pendingReferenceFolderUuid: string | null = null;
  private pendingReferenceName: string | null = null;
  readonly creatingReference = signal(false);

  readonly selectedNode = computed<NavTreeView | null>(() => {
    const uuid = this.selectedUuid();
    const root = this.root();
    if (!uuid || !root) {
      return null;
    }
    return findNode(root, uuid);
  });

  readonly isRootSelected = computed(() => {
    const root = this.root();
    const uuid = this.selectedUuid();
    return root != null && uuid != null && root.uuid === uuid;
  });

  /** The folder currently targeted by "New folder"/"New reference" — the selected folder, or the root if nothing (folder-shaped) is selected. */
  readonly targetFolderUuid = computed<string | null>(() => {
    const node = this.selectedNode();
    if (node && node.type === 'FOLDER' && node.uuid) {
      return node.uuid;
    }
    return this.root()?.uuid ?? null;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.reload(key));
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
    const parentUuid = this.targetFolderUuid();
    const displayName = window.prompt('Folder name');
    if (!displayName || !displayName.trim()) {
      return;
    }
    this.nav.createFolder(this.projectKey(), displayName.trim(), parentUuid ?? undefined).subscribe({
      next: () => {
        this.toasts.show('Folder created', 'success');
        this.reload(this.projectKey());
      },
      error: () => this.toasts.show('Could not create folder — a folder with that name may already exist here.', 'error'),
    });
  }

  protected newReference(): void {
    const parentUuid = this.targetFolderUuid();
    if (!parentUuid) {
      return;
    }
    const displayName = window.prompt('Reference name');
    if (!displayName || !displayName.trim()) {
      return;
    }
    this.pendingReferenceFolderUuid = parentUuid;
    this.pendingReferenceName = displayName.trim();
    this.creatingReference.set(true);
  }

  protected cancelCreateReference(): void {
    this.creatingReference.set(false);
    this.pendingReferenceFolderUuid = null;
    this.pendingReferenceName = null;
  }

  protected onReferenceTargetPicked(picked: AssetPicked): void {
    const folderUuid = this.pendingReferenceFolderUuid;
    const displayName = this.pendingReferenceName;
    this.creatingReference.set(false);
    this.pendingReferenceFolderUuid = null;
    this.pendingReferenceName = null;
    if (!folderUuid || !displayName) {
      return;
    }
    this.nav
      .createReference(this.projectKey(), {
        displayName,
        folderUuid,
        targetKind: 'PAGE',
        targetAssetUuid: picked.uuid,
      })
      .subscribe({
        next: (created) => {
          this.toasts.show('Reference created', 'success');
          this.reload(this.projectKey());
          if (created.uuid) {
            this.select(created.uuid);
          }
        },
        error: () => this.toasts.show('Could not create reference — try again in a moment.', 'error'),
      });
  }

  protected onMove(event: NavMoveEvent): void {
    const root = this.root();
    if (!root) {
      return;
    }
    const source = findNode(root, event.source);
    if (!source || source.uuid === root.uuid) {
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

  protected onFolderDeleted(): void {
    this.closeDetail();
    this.reload(this.projectKey());
  }

  protected onReferenceDeleted(): void {
    this.closeDetail();
    this.reload(this.projectKey());
  }

  private reload(key: string): void {
    if (!key) {
      return;
    }
    this.loading.set(true);
    this.nav.tree(key).subscribe({
      next: (tree) => {
        this.root.set(tree);
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

function findNode(node: NavTreeView, uuid: string): NavTreeView | null {
  if (node.uuid === uuid) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findNode(child, uuid);
    if (found) {
      return found;
    }
  }
  return null;
}
