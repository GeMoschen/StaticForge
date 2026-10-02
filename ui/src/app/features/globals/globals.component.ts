import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, tap, type Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { findFolderById, findFolderByPath, findParentFolder, moveBackBody } from '../../shared/folder-tree.util';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import {
  SfStoreTreeNodeComponent,
  type FolderRenameFn,
  type StoreTreeMoveEvent,
  type StoreTreeNode,
} from '../../shared/components/sf-store-tree-node.component';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { consumeQueryParam } from '../../shared/deep-link';
import { GlobalSetDetailComponent, type DeletedGlobalSet } from './global-set-detail.component';
import { etagFor, GlobalsService, type FolderView, type GlobalSetSummaryView } from './globals.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';

/** The Content CDL a newly created property set starts with — one field, so the Values tab is never blank. */
const STARTER_CONTENT = `editor text title { label "Title" required }
`;

/**
 * Globals store — the project's named property sets, in the "tree on the left, detail on the
 * right" shape every other store uses.
 *
 * <p>The tree is assembled client-side from two calls: the folders (`/folders?scope=GLOBALS`) and
 * the flat set list, bucketed by `folderPath`. That is the Media/Templates pattern, and it means
 * the Globals store needs no tree endpoint of its own — folders already work through the generic
 * folder API. The fixed, protected "All Globals" root is unwrapped for display, exactly as the
 * navigation store unwraps "All Navigation".
 */
@Component({
  selector: 'sf-globals',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfStoreTreeNodeComponent,
    GlobalSetDetailComponent,
  ],
  templateUrl: './globals.component.html',
  styleUrl: './globals.component.scss',
})
export class GlobalsComponent {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` selects that property set or folder (search deep link, M23.4.1). */
  readonly asset = input<string | undefined>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly globals = inject(GlobalsService);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly api = inject(ApiClient);
  private readonly menu = inject(ContextMenuService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly loading = signal(false);
  protected readonly folders = signal<FolderView[]>([]);
  protected readonly sets = signal<GlobalSetSummaryView[]>([]);
  protected readonly selectedUuid = signal<string | null>(null);

  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  protected readonly newSetOpen = signal(false);
  protected readonly creatingSet = signal(false);

  /** The store's real top level: the children of the fixed "All Globals" root. */
  private readonly rootFolder = computed<FolderView | null>(() => this.folders()[0] ?? null);

  protected readonly treeNodes = computed<StoreTreeNode[]>(() => {
    const root = this.rootFolder();
    if (!root) {
      return [];
    }
    const byFolder = bucketByFolderPath(this.sets());
    return [
      ...(root.children ?? []).map((folder) => folderNode(folder, byFolder)),
      ...leavesOf(root, byFolder),
    ];
  });

  protected readonly selectedSet = computed<GlobalSetSummaryView | null>(() => {
    const uuid = this.selectedUuid();
    return uuid ? (this.sets().find((s) => s.uuid === uuid) ?? null) : null;
  });

  /** New folders and sets land in the selected folder, or in the store root when none is selected. */
  protected readonly targetFolderUuid = computed<string | undefined>(() => {
    const uuid = this.selectedUuid();
    if (!uuid || this.sets().some((s) => s.uuid === uuid)) {
      return undefined;
    }
    return uuid;
  });

  /** Globals folders rename through the folder endpoint, not the generic asset one. */
  protected readonly renameFolder: FolderRenameFn = (projectKey, uuid, displayName, revision) =>
    this.globals.renameFolder(projectKey, uuid, displayName, revision === undefined ? undefined : etagFor(revision));

  constructor() {
    effect(() => {
      const key = this.projectKey();
      // Release actions change the statuses of the tree's folders and sets (M27.6.1).
      this.releaseEvents.version();
      untracked(() => this.reload(key));
    });
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
  }

  protected closeDetail(): void {
    this.selectedUuid.set(null);
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
    this.creatingFolder.set(true);
    this.globals.createFolder(this.projectKey(), value.displayName, this.targetFolderUuid()).subscribe({
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

  /** `n` creates a global set (M35.14). */
  private readonly newSetShortcut = inject(ShortcutService).use([
    createShortcut({ handler: () => this.newSet(), palette: { label: 'frame.shortcuts.items.createGlobalSet' } }),
  ]);


  protected newSet(): void {
    if (this.readOnly()) {
      return;
    }
    this.newSetOpen.set(true);
  }

  protected closeNewSet(): void {
    this.newSetOpen.set(false);
  }

  protected submitNewSet(value: CreateAssetFormValue): void {
    if (this.readOnly()) {
      return;
    }
    this.creatingSet.set(true);
    this.globals
      .create(this.projectKey(), {
        parentFolderUuid: this.targetFolderUuid(),
        displayName: value.displayName,
        contentCdl: STARTER_CONTENT,
      })
      .subscribe({
        next: (created) => {
          this.creatingSet.set(false);
          this.newSetOpen.set(false);
          this.toasts.show('Property set created', 'success');
          this.reload(this.projectKey());
          if (created.uuid) {
            this.select(created.uuid);
          }
        },
        error: () => {
          this.creatingSet.set(false);
          this.toasts.show('Could not create the property set — you may need the developer role.', 'error');
        },
      });
  }

  protected onMove(event: StoreTreeMoveEvent): void {
    if (this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    const back = this.moveBack(event.source);
    const message = `Moved “${this.nameOf(event.source)}” to ${this.nameOf(event.target)}.`;
    this.moveItem(key, event.source, event.target).subscribe({
      next: () => {
        this.offerMoveUndo(key, event.source, back, message);
        this.reload(key);
      },
      error: () => this.toasts.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  /** Sets move through the generic asset move, folders through the folder endpoint. */
  private moveItem(key: string, uuid: string, target: string | undefined): Observable<unknown> {
    return this.sets().some((s) => s.uuid === uuid)
      ? this.globals.moveSet(key, uuid, target)
      : this.globals.moveFolder(key, uuid, target);
  }

  private nameOf(uuid: string): string {
    const set = this.sets().find((s) => s.uuid === uuid);
    const folder = set ? null : findFolderById(this.folders(), uuid);
    return set?.displayName ?? set?.uid ?? folder?.displayName ?? folder?.uid ?? 'item';
  }

  /** The folder an item lives in now (`undefined`: the store root) — where Undo moves it back. */
  private moveBack(uuid: string): string | undefined {
    const set = this.sets().find((s) => s.uuid === uuid);
    const parent = set ? findFolderByPath(this.folders(), set.folderPath ?? '') : findParentFolder(this.folders(), uuid);
    return moveBackBody(parent, this.rootFolder()?.uuid).folderUuid;
  }

  /** One Undo for a move: moves the item back to the folder it came from. */
  private offerMoveUndo(key: string, uuid: string, back: string | undefined, message: string): void {
    this.undo.offer(message, () => this.moveItem(key, uuid, back).pipe(tap(() => this.reload(key))));
  }

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
    const key = this.projectKey();
    const back = this.moveBack(source);
    const message = `Moved “${this.nameOf(source)}” to the root.`;
    this.moveItem(key, source, undefined).subscribe({
      next: () => {
        this.offerMoveUndo(key, source, back, message);
        this.reload(key);
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  protected onRootContextMenu(event: MouseEvent): void {
    if (this.readOnly()) {
      return;
    }
    this.closeDetail();
    const items: ContextMenuItem[] = [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.newFolder() },
      { label: 'New property set', icon: 'tune', action: () => this.newSet() },
    ];
    this.menu.open(event, items);
  }

  protected onSetChanged(): void {
    this.reload(this.projectKey());
  }

  protected onSetDeleted(deleted: DeletedGlobalSet): void {
    const key = this.projectKey();
    this.closeDetail();
    this.reload(key);
    // Undo restores the set from its last live revision.
    this.undo.offer(
      deleted.online
        ? `Deleted “${deleted.name}”. It stays online until you release the deletion.`
        : `Deleted “${deleted.name}”.`,
      () => restoreDeletedAsset(this.api, key, deleted.uuid).pipe(tap(() => this.reload(key))),
    );
  }

  private reload(key: string): void {
    if (!key) {
      return;
    }
    this.loading.set(true);
    forkJoin({ folders: this.globals.folders(key), sets: this.globals.list(key) }).subscribe({
      next: ({ folders, sets }) => {
        this.folders.set(folders ?? []);
        this.sets.set(sets ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.toasts.show('Could not load the Globals store — check your connection and try again.', 'error');
        this.loading.set(false);
      },
    });
  }
}

/** `folderPath` → the sets living directly in that folder. */
function bucketByFolderPath(sets: GlobalSetSummaryView[]): Map<string, GlobalSetSummaryView[]> {
  const byFolder = new Map<string, GlobalSetSummaryView[]>();
  for (const set of sets) {
    const path = set.folderPath ?? '';
    const bucket = byFolder.get(path);
    if (bucket) {
      bucket.push(set);
    } else {
      byFolder.set(path, [set]);
    }
  }
  return byFolder;
}

function leavesOf(folder: FolderView, byFolder: Map<string, GlobalSetSummaryView[]>): StoreTreeNode[] {
  return (byFolder.get(folder.path ?? '') ?? [])
    .slice()
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
    .map((set) => ({
      uuid: set.uuid,
      uid: set.uid,
      displayName: set.displayName,
      kind: 'LEAF' as const,
      icon: 'tune',
      revision: set.revision,
      release: set.release,
      scheduled: set.scheduled,
    }));
}

function folderNode(folder: FolderView, byFolder: Map<string, GlobalSetSummaryView[]>): StoreTreeNode {
  return {
    uuid: folder.uuid,
    uid: folder.uid,
    displayName: folder.displayName,
    kind: 'FOLDER',
    protectedFolder: folder.protectedFolder === true,
    revision: folder.revision,
    release: folder.release,
    scheduled: folder.scheduled,
    children: [
      ...(folder.children ?? []).map((child) => folderNode(child, byFolder)),
      ...leavesOf(folder, byFolder),
    ],
  };
}
