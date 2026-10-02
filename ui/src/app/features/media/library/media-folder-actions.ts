import { Injectable, Injector, inject, signal } from '@angular/core';
import { type Observable, firstValueFrom, tap } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../shared/components/dialog/delete-confirm';
import type { CreateAssetFormValue } from '../../../shared/components/sf-create-asset-dialog.component';
import { ContextMenuService } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { STAYS_ONLINE_NOTE, isOnline } from '../../release/release-status.util';
import type { FolderMoveEvent } from '../media-folder-node.component';
import { folderContentCount } from './media-library.util';
import { type FolderView, MediaLibraryStore } from './media-library.store';

/** Everything you can do to a folder of the library: create, rename, delete, cut and paste, drag and drop. */
@Injectable()
export class MediaFolderActions {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
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
    this.move(event.source, event.target, 'Could not move — that may create a cycle.');
  }

  /**
   * Moves a folder or media item (`target` undefined: to the root) and offers Undo, which moves it back to the folder
   * it was in. The parent is read before the move; the messages name what moved and where.
   */
  private move(source: string, target: string | undefined, failure: string, onMoved?: () => void): void {
    const key = this.library.projectKey();
    const from = this.library.parentFolderUuidOf(source);
    const label = this.library.labelOf(source) ?? 'item';
    const to = target ? (this.library.labelOf(target) ?? 'the folder') : 'All media';
    this.api.moveAsset(key, source, target ? { folderUuid: target } : {}).subscribe({
      next: () => {
        onMoved?.();
        this.undo.offer(`Moved “${label}” to ${to}.`, () =>
          this.api
            .moveAsset(key, source, from ? { folderUuid: from } : {})
            .pipe(tap(() => this.library.reloadFolders())),
        );
        this.library.reloadFolders();
      },
      error: () => this.toasts.show(failure, 'error'),
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
    this.move(source, undefined, 'Could not move — try again in a moment.');
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
      { label: 'Delete', icon: 'delete', danger: true, action: () => void this.deleteFolder(folder) },
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

  /** Asks, deletes the folder with everything in it and offers Undo (one restore brings the whole subtree back). */
  async deleteFolder(folder: FolderView): Promise<boolean> {
    const uuid = folder.uuid;
    if (!uuid || this.library.readOnly()) {
      return false;
    }
    const name = folder.displayName ?? folder.uid ?? 'this folder';
    const inside = folderContentCount(folder, this.library.mediaByFolder());
    const total = inside.folders + inside.media;
    const contents = [
      inside.media > 0 ? `${inside.media} media ${inside.media === 1 ? 'item' : 'items'}` : '',
      inside.folders > 0 ? `${inside.folders} ${inside.folders === 1 ? 'sub-folder' : 'sub-folders'}` : '',
    ].filter(Boolean);
    const confirmed = await this.confirms.confirm({
      title: `Delete “${name}”?`,
      message: [total > 0 ? `This also deletes ${contents.join(' and ')} inside it.` : '', isOnline(folder.release) ? STAYS_ONLINE_NOTE : '']
        .filter(Boolean)
        .join(' ') || undefined,
      confirmLabel: 'Delete',
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(1 + total),
      injector: this.injector,
    });
    if (!confirmed) {
      return false;
    }
    const key = this.library.projectKey();
    try {
      await firstValueFrom(this.api.deleteFolder(key, uuid, true), { defaultValue: undefined });
    } catch {
      this.toasts.show('Could not delete folder — try again in a moment.', 'error');
      return false;
    }
    this.undo.offer(`Deleted “${name}”.`, () =>
      this.api.restoreFolder(key, uuid).pipe(tap(() => this.library.reloadFolders())),
    );
    if (this.library.folderUuid() === uuid) {
      this.library.selectFolder(null);
    } else {
      this.library.reloadFolders();
    }
    return true;
  }

  /**
   * Renames a folder and offers Undo (rename back; the revision the rename produced guards against edits made in
   * between). The caller handles errors.
   */
  renameFolderTo(folder: FolderView, displayName: string): Observable<FolderView> {
    const key = this.library.projectKey();
    const uuid = folder.uuid ?? '';
    const oldName = folder.displayName;
    return this.api.renameFolder(key, uuid, { displayName }, folder.revision).pipe(
      tap((renamed) => {
        if (oldName) {
          this.undo.offer(`Renamed “${oldName}” to “${displayName}”.`, () =>
            this.api
              .renameFolder(key, uuid, { displayName: oldName }, renamed.revision)
              .pipe(tap(() => this.library.reloadFolders())),
          );
        } else {
          this.toasts.show('Folder renamed', 'success');
        }
      }),
    );
  }

  /** Pastes the cut folder or media item into `targetUuid`, with Undo. */
  pasteInto(targetUuid: string): void {
    if (this.library.readOnly()) {
      return;
    }
    const entry = this.clipboard.entry();
    if (!entry || entry.mode !== 'cut') {
      return;
    }
    this.move(entry.uuid, targetUuid, 'Could not move — try again in a moment.', () => this.clipboard.clear());
  }
}
