import { Injectable, Injector, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, firstValueFrom, tap } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../shared/components/dialog/delete-confirm';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { isOnline } from '../../release/release-status.util';
import { type FolderView, MediaLibraryStore } from './media-library.store';
import { findParentFolder, folderContentCount } from './media-library.util';
import { type MediaRenameDialogData, MediaRenameDialogComponent } from './media-rename-dialog.component';

/** A request to the folder tree from outside it (the page header's folder menu, the empty library's *New folder*). */
export interface MediaTreeRequest {
  readonly kind: 'rename' | 'create';
  /** The folder to rename, or the parent of the new folder (`null`: the top level). */
  readonly uuid: string | null;
}

/**
 * Everything you can do to a folder of the library: create, rename, delete. Create and the quick rename (F2) happen inline
 * in the folder tree (`sf-tree`), which asks for them through {@link treeRequest} when the request comes from elsewhere;
 * *Rename…* opens the Rename dialog, which also changes the UID in developer mode (decision 107); moving is
 * {@link MediaMover}'s. Each change that can be undone offers Undo.
 */
@Injectable()
export class MediaFolderActions {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly dialogs = inject(DialogService);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);
  private readonly library = inject(MediaLibraryStore);

  /** The tree is asked to start an inline rename or create; the tree performs it and clears the request. */
  readonly treeRequest = signal<MediaTreeRequest | null>(null);

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`media.folders.${key}`, params);
  }

  // ── Create ──────────────────────────────────────────────────────────────

  /** Starts an inline *New folder* in the tree, under the open folder (`parentUuid` undefined) or the given one. */
  startCreate(parentUuid: string | null = this.library.folderUuid() || null): void {
    if (this.library.canEdit()) {
      this.treeRequest.set({ kind: 'create', uuid: parentUuid });
    }
  }

  /** Creates a folder named `name` under `parentUuid` (`undefined`: at the top level). Errors are toasted. */
  createFolder(parentUuid: string | undefined, name: string): Observable<FolderView> {
    return this.api.createFolder(this.library.projectKey(), { displayName: name, parentFolderUuid: parentUuid, scope: 'MEDIA' }).pipe(
      tap({
        next: () => {
          this.toasts.show(this.t('created', { name }), 'success');
          this.library.reloadFolders();
        },
        error: () => this.toasts.show(this.t('createFailed'), 'error'),
      }),
    );
  }

  // ── Rename ──────────────────────────────────────────────────────────────

  /** Starts an inline rename of the open folder in the tree (the page header's *Rename folder*, F2). */
  startRename(): void {
    const uuid = this.library.folderUuid();
    if (uuid && this.library.canEdit()) {
      this.treeRequest.set({ kind: 'rename', uuid });
    }
  }

  /**
   * *Rename…*: the Rename dialog of a folder (name checked against its siblings, Apply; in developer mode also its UID),
   * then the rename with its Undo toast. The tree re-reads after a rename and after each UID change.
   */
  async rename(folder: FolderView): Promise<void> {
    const uuid = folder.uuid;
    const current = folder.displayName ?? folder.uid ?? '';
    if (!uuid || !this.library.canEdit()) {
      return;
    }
    const parent = findParentFolder(this.library.tree(), uuid);
    const siblings = parent?.children ?? this.library.topLevelFolders();
    const reloaded = () => this.library.reloadFolders();
    const data: MediaRenameDialogData = {
      kind: 'folder',
      name: current,
      folder: parent?.displayName ?? this.transloco.translate('media.library.title'),
      taken: siblings.filter((sibling) => sibling.uuid !== uuid).map((sibling) => (sibling.displayName ?? sibling.uid ?? '').toLowerCase()),
      uid: { projectKey: this.library.projectKey(), uuid, uid: folder.uid ?? '', changed: reloaded, undone: reloaded },
    };
    const name = await this.dialogs.open<string, MediaRenameDialogData>(MediaRenameDialogComponent, data, { injector: this.injector }).result;
    if (!name || name === current) {
      return;
    }
    this.renameFolderTo(folder, name).subscribe({
      next: reloaded,
      error: () => {
        this.toasts.show(this.t('renameFailed', { name: current }), 'error');
        reloaded();
      },
    });
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
          this.undo.offer(this.t('renamed', { from: oldName, to: displayName }), () =>
            this.api
              .renameFolder(key, uuid, { displayName: oldName }, renamed.revision)
              .pipe(tap(() => this.library.reloadFolders())),
          );
        } else {
          this.toasts.show(this.t('renamedOne'), 'success');
        }
      }),
    );
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  /** Asks, deletes the folder with everything in it and offers Undo (one restore brings the whole subtree back). */
  async deleteFolder(folder: FolderView): Promise<boolean> {
    const uuid = folder.uuid;
    if (!uuid || !this.library.canEdit()) {
      return false;
    }
    const name = folder.displayName ?? folder.uid ?? '';
    const inside = folderContentCount(folder, this.library.mediaByFolder());
    const total = inside.folders + inside.media;
    const contents = [
      inside.media > 0 ? this.t('delete.items', { count: inside.media }) : '',
      inside.folders > 0 ? this.t('delete.subfolders', { count: inside.folders }) : '',
    ].filter(Boolean);
    const listed = contents.length === 2 ? this.t('delete.and', { first: contents[0], second: contents[1] }) : contents[0];
    const confirmed = await this.confirms.confirm({
      title: this.t('delete.title', { name }),
      message:
        [total > 0 ? this.t('delete.contents', { contents: listed }) : '', isOnline(folder.release) ? this.t('delete.online') : '']
          .filter(Boolean)
          .join(' ') || undefined,
      confirmLabel: this.t('delete.confirm'),
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
      this.toasts.show(this.t('delete.failed'), 'error');
      return false;
    }
    this.undo.offer(this.t('delete.done', { name }), () =>
      this.api.restoreFolder(key, uuid).pipe(tap(() => this.library.reloadFolders())),
    );
    // What is open lies inside the deleted folder: the library goes back to its root.
    if (this.library.folderTrail().some((open) => open.uuid === uuid)) {
      this.library.openFolder(null);
    }
    this.library.reloadFolders();
    return true;
  }
}
