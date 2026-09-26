import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { PageNavNodeComponent } from './page-nav-node.component';
import type { FolderMoveEvent } from './types';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ReleaseBadgeComponent } from '../release/release-badge.component';
import { deleteQuestion } from '../release/release-status.util';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/**
 * Recursive folder-tree node. Supports expand/collapse, selection, native
 * HTML5 drag-move (drag a folder or page onto another folder to move it —
 * the parent performs the move via the generic `ApiClient.moveAsset`), and
 * a right-click menu (new page/subfolder, rename, cut/paste, delete). Also
 * renders this folder's own pages (from `pagesByFolder`, keyed by the
 * folder's canonical path) as navigable `sf-page-nav-node` leaves — always
 * after its sub-folders, so folders sort first.
 *
 * The fixed, protected "All Pages" root folder (`node().protectedFolder`) renders with no
 * rename/cut/delete/drag affordance — mirrors `sf-nav-tree-node`'s treatment of its own fixed
 * "All Navigation" root — new pages/subfolders can still be created inside it.
 */
@Component({
  selector: 'sf-folder-node',
  standalone: true,
  imports: [SfIconComponent, PageNavNodeComponent, SfCreateAssetDialogComponent, SfRenameAssetDialogComponent, ReleaseBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-node.component.html',
  styleUrl: './folder-node.component.scss',
})
export class FolderNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly node = input.required<FolderView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);
  readonly projectKey = input<string>('');
  readonly pagesByFolder = input<ReadonlyMap<string, AssetSummaryView[]>>(new Map());

  readonly select = output<string>();
  readonly move = output<FolderMoveEvent>();
  /** Request to open the "new page" form targeting this folder (already selected). */
  readonly newPage = output<void>();
  /** Emitted after this folder (or something inside it) was created/renamed/moved/deleted, so the parent reloads. */
  readonly changed = output<void>();

  protected readonly expanded = signal(true);
  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  private pendingNewFolderParentUuid: string | null = null;

  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected readonly isProtected = computed<boolean>(() => this.node().protectedFolder === true);

  protected ownPages(): AssetSummaryView[] {
    return this.pagesByFolder().get(this.node().path ?? '') ?? [];
  }

  protected hasChildren(): boolean {
    return (this.node().children ?? []).length > 0 || this.ownPages().length > 0;
  }

  protected isSelected(): boolean {
    const uuid = this.node().uuid;
    return uuid != null && this.selectedUuid() === uuid;
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  protected onSelect(): void {
    if (this.node().uuid != null) {
      this.select.emit(this.node().uuid as string);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect();
    } else if (event.key === 'ArrowRight' && !this.expanded()) {
      this.expanded.set(true);
    } else if (event.key === 'ArrowLeft' && this.expanded()) {
      this.expanded.set(false);
    }
  }

  protected onDragStart(event: DragEvent): void {
    const uuid = this.node().uuid;
    if (uuid == null || this.isProtected() || this.readOnly()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
    this.expanded.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    const target = this.node().uuid;
    if (source && target && source !== target && !this.readOnly()) {
      this.move.emit({ source, target });
    }
  }

  protected onDragEnd(): void {
    // No-op; sibling visual state is managed by the parent.
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.node().uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    const clip = this.clipboard.entry();
    const protectedFolder = this.isProtected();
    const items: ContextMenuItem[] = [
      {
        label: 'New page here',
        icon: 'note_add',
        action: () => {
          this.select.emit(uuid);
          this.newPage.emit();
        },
      },
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.newSubfolder(uuid) },
    ];
    if (!protectedFolder) {
      items.push({ label: 'Rename', icon: 'edit', action: () => this.renameOpen.set(true) });
    }
    items.push({ label: '', separator: true });
    if (!protectedFolder) {
      items.push({
        label: 'Cut',
        icon: 'content_cut',
        action: () => this.clipboard.cut('FOLDER', uuid, this.node().displayName ?? this.node().uid ?? 'folder'),
      });
    }
    items.push({ label: 'Paste', icon: 'content_paste', disabled: !clip, action: () => this.paste(uuid) });
    if (!protectedFolder) {
      items.push({ label: '', separator: true });
      items.push({ label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteFolder(uuid) });
    }
    this.menu.open(event, items);
  }

  private newSubfolder(parentUuid: string): void {
    this.pendingNewFolderParentUuid = parentUuid;
    this.newFolderOpen.set(true);
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    const parentUuid = this.pendingNewFolderParentUuid;
    if (!parentUuid || this.readOnly()) {
      return;
    }
    this.creatingFolder.set(true);
    this.api
      .createFolder(this.projectKey(), { displayName: value.displayName, parentFolderUuid: parentUuid, scope: 'PAGES' })
      .subscribe({
        next: () => {
          this.creatingFolder.set(false);
          this.newFolderOpen.set(false);
          this.toast.show('Folder created', 'success');
          this.changed.emit();
        },
        error: () => {
          this.creatingFolder.set(false);
          this.toast.show('Could not create folder — a folder with that name may already exist here.', 'error');
        },
      });
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const uuid = this.node().uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    this.renamingName.set(true);
    this.api.renameFolder(this.projectKey(), uuid, { displayName }, this.node().revision).subscribe({
      next: () => {
        this.renamingName.set(false);
        this.renameOpen.set(false);
        this.toast.show('Folder renamed', 'success');
        this.changed.emit();
      },
      error: () => {
        this.renamingName.set(false);
        this.toast.show('Could not rename folder — try again in a moment.', 'error');
      },
    });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }

  private deleteFolder(uuid: string): void {
    if (this.readOnly()) {
      return;
    }
    const name = this.node().displayName ?? this.node().uid ?? 'this folder';
    if (!window.confirm(deleteQuestion(`Delete "${name}" and everything inside it? This cannot be undone.`, this.node().release))) {
      return;
    }
    this.api.deleteFolder(this.projectKey(), uuid, true).subscribe({
      next: () => {
        this.toast.show('Folder deleted', 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }

  private paste(targetUuid: string): void {
    if (this.readOnly()) {
      return;
    }
    const entry = this.clipboard.entry();
    if (!entry) {
      return;
    }
    const key = this.projectKey();
    if (entry.mode === 'cut') {
      this.api.moveAsset(key, entry.uuid, { folderUuid: targetUuid }).subscribe({
        next: () => {
          this.clipboard.clear();
          this.toast.show(`Moved "${entry.label}"`, 'success');
          this.changed.emit();
        },
        error: () => this.toast.show('Could not move — try again in a moment.', 'error'),
      });
      return;
    }
    if (entry.assetType !== 'PAGE') {
      this.toast.show('Only pages can be copied — try Cut instead.', 'error');
      return;
    }
    this.api.duplicatePage(key, entry.uuid).subscribe({
      next: (duplicated) => {
        const newUuid = duplicated.uuid;
        if (!newUuid) {
          this.changed.emit();
          return;
        }
        this.api.moveAsset(key, newUuid, { folderUuid: targetUuid }).subscribe({
          next: () => {
            this.toast.show('Page duplicated', 'success');
            this.changed.emit();
          },
          error: () => this.toast.show('Duplicated the page, but could not move it into this folder.', 'error'),
        });
      },
      error: () => this.toast.show('Could not duplicate page — try again in a moment.', 'error'),
    });
  }
}
