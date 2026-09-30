import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import type { CreateAssetFormValue } from '../../../shared/components/sf-create-asset-dialog.component';
import { ContextMenuService } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { deleteQuestion } from '../../release/release-status.util';
import type { FolderMoveEvent } from '../media-folder-node.component';
import { type FolderView, MediaLibraryStore } from './media-library.store';

/** Everything you can do to a folder of the library: create, rename, delete, cut and paste, drag and drop. */
@Injectable()
export class MediaFolderActions {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly library = inject(MediaLibraryStore);

  readonly newFolderOpen = signal(false);
  readonly creatingFolder = signal(false);
  /** Parent folder targeted by the currently open "New folder" dialog — captured at open time since the root context menu always targets the root regardless of the current selection. */
  private newFolderParentUuid: string | undefined = undefined;

  readonly renamingFolder = signal<FolderView | null>(null);
  readonly renamingFolderMediaCount = signal(0);

  newFolder(): void {
    this.createFolderUnder(this.library.folderUuid() || undefined);
  }

  private createFolderUnder(parentUuid: string | undefined): void {
    if (this.library.readOnly()) {
      return;
    }
    this.newFolderParentUuid = parentUuid;
    this.newFolderOpen.set(true);
  }

  closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  submitNewFolder(value: CreateAssetFormValue): void {
    this.creatingFolder.set(true);
    this.api
      .createFolder(this.library.projectKey(), {
        displayName: value.displayName,
        parentFolderUuid: this.newFolderParentUuid,
        scope: 'MEDIA',
      })
      .subscribe({
        next: () => {
          this.creatingFolder.set(false);
          this.newFolderOpen.set(false);
          this.toasts.show('Folder created', 'success');
          this.library.reloadFolders();
        },
        error: () => {
          this.creatingFolder.set(false);
          this.toasts.show('Could not create folder — a folder with that name may already exist here.', 'error');
        },
      });
  }

  moveItemTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target || this.library.readOnly()) {
      return;
    }
    this.api.moveAsset(this.library.projectKey(), event.source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.toasts.show('Moved', 'success');
        this.library.reloadFolders();
      },
      error: () => this.toasts.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  // ── "All media" (the root) ──────────────────────────────────────────────

  onRootDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  onRootDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    if (!source || this.library.readOnly()) {
      return;
    }
    this.api.moveAsset(this.library.projectKey(), source, {}).subscribe({
      next: () => {
        this.toasts.show('Moved to root', 'success');
        this.library.reloadFolders();
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  /** "All media" is the project's media root — its only folder action is creating a subfolder there (it can't be renamed, deleted, cut, or pasted into). */
  onRootContextMenu(event: MouseEvent): void {
    if (this.library.readOnly()) {
      return;
    }
    this.menu.open(event, [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.createFolderUnder(undefined) },
    ]);
  }

  // ── Folder cards in the grid ────────────────────────────────────────────

  onFolderCardClick(folder: FolderView): void {
    this.library.selectFolder(folder);
  }

  onFolderCardDragStart(folder: FolderView, event: DragEvent): void {
    if (!folder.uuid) {
      return;
    }
    event.dataTransfer?.setData('text/plain', folder.uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  onFolderCardDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  onFolderCardDrop(folder: FolderView, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer?.getData('text/plain');
    if (source && folder.uuid && source !== folder.uuid) {
      this.moveItemTo({ source, target: folder.uuid });
    }
  }

  onFolderCardContextMenu(folder: FolderView, event: MouseEvent): void {
    const uuid = folder.uuid;
    if (!uuid || this.library.readOnly()) {
      return;
    }
    const clip = this.clipboard.entry();
    this.menu.open(event, [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.createFolderUnder(uuid) },
      { label: 'Rename', icon: 'edit', action: () => this.renameFolder(folder) },
      { label: '', separator: true },
      {
        label: 'Cut',
        icon: 'content_cut',
        action: () => this.clipboard.cut('FOLDER', uuid, folder.displayName ?? folder.uid ?? 'folder'),
      },
      { label: 'Paste', icon: 'content_paste', disabled: !clip, action: () => this.pasteInto(uuid) },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteFolder(folder) },
    ]);
  }

  // Opens the `sf-media-folder-detail` overlay drawer instead of a `window.prompt` — folders
  // here are otherwise only "navigate into" targets (see `onFolderCardClick`/`selectFolder`),
  // so reusing the "Rename" context-menu action as the entry point is the smaller, more
  // consistent change versus adding a whole new folder-selection interaction.
  private renameFolder(folder: FolderView): void {
    if (!folder.uuid || this.library.readOnly()) {
      return;
    }
    this.renamingFolder.set(folder);
    this.renamingFolderMediaCount.set(0);
    const folderPath = folder.path?.trim() || '/';
    this.api.listMedia(this.library.projectKey(), { folder: folderPath, page: 0, size: 1 }).subscribe({
      next: (res) => this.renamingFolderMediaCount.set(res.totalElements ?? 0),
      error: () => this.renamingFolderMediaCount.set(0),
    });
  }

  closeFolderDetail(): void {
    this.renamingFolder.set(null);
  }

  onFolderDetailChanged(): void {
    this.renamingFolder.set(null);
    this.library.reloadFolders();
  }

  private deleteFolder(folder: FolderView): void {
    const uuid = folder.uuid;
    if (!uuid || this.library.readOnly()) {
      return;
    }
    const name = folder.displayName ?? folder.uid ?? 'this folder';
    if (!window.confirm(deleteQuestion(`Delete "${name}" and everything inside it? This cannot be undone.`, folder.release))) {
      return;
    }
    this.api.deleteFolder(this.library.projectKey(), uuid, true).subscribe({
      next: () => {
        this.toasts.show('Folder deleted', 'success');
        if (this.library.folderUuid() === uuid) {
          this.library.selectFolder(null);
        } else {
          this.library.reloadFolders();
        }
      },
      error: () => this.toasts.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }

  private pasteInto(targetUuid: string): void {
    if (this.library.readOnly()) {
      return;
    }
    const entry = this.clipboard.entry();
    if (!entry || entry.mode !== 'cut') {
      return;
    }
    this.api.moveAsset(this.library.projectKey(), entry.uuid, { folderUuid: targetUuid }).subscribe({
      next: () => {
        this.clipboard.clear();
        this.toasts.show(`Moved "${entry.label}"`, 'success');
        this.library.reloadFolders();
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }
}
