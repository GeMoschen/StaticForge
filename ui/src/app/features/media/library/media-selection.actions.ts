import { Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { type UndoStep, UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../shared/components/dialog/delete-confirm';
import { isOnline } from '../../release/release-status.util';
import { MediaFolderActions } from './media-folder-actions';
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaReleaseActions } from './media-release.actions';
import { MediaLibraryStore } from './media-library.store';
import { folderContentCount } from './media-library.util';

/** One thing the selection offers: an entry of the multi-selection menu and a button of the bulk bar. */
export interface SelectionAction {
  readonly id: 'move' | 'cut' | 'copy' | 'duplicate' | 'download' | 'release' | 'delete';
  readonly label: string;
  readonly icon: string;
  readonly danger?: boolean;
  readonly action: () => void;
}

/**
 * What the library does to a selection of files and folders (grid and list): *Move, Download (the files), Release…,
 * Delete*, as the bulk bar's buttons and — on a right click inside the selection — as the context menu. A selection of files
 * only keeps the file wording and flows ("Move 3 files…"); folders in it use "items" and, for delete and move, one dialog
 * for the whole selection.
 */
@Injectable()
export class MediaSelectionActions {
  private readonly library = inject(MediaLibraryStore);
  private readonly mover = inject(MediaMover);
  private readonly releases = inject(MediaReleaseActions);
  private readonly api = inject(ApiClient);
  private readonly confirms = inject(ConfirmService);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  // Both depend on this service for their multi-selection menus: resolved when needed.
  private get items(): MediaItemActions {
    return this.injector.get(MediaItemActions);
  }
  private get folders(): MediaFolderActions {
    return this.injector.get(MediaFolderActions);
  }

  /** A menu opened on this file or folder acts on the whole selection when it is part of a selection of two or more. */
  multiFor(uuid: string | undefined): boolean {
    return this.library.selectionCount() > 1 && (this.library.isSelected(uuid) || this.library.isFolderSelected(uuid));
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  /**
   * The actions of the current selection, worded for the context `menu` ("Move 3 files…") or the `bulk` bar ("Move"). A
   * read-only project only downloads; releasing needs the right to release.
   */
  actions(wording: 'menu' | 'bulk'): SelectionAction[] {
    const files = this.library.selectedItems();
    const folders = this.library.selectedFolders();
    const count = files.length + folders.length;
    const writable = this.library.canEdit();
    const menu = wording === 'menu';
    const only = folders.length === 0;
    return [
      ...(writable
        ? [
            {
              id: 'move' as const,
              label: menu ? this.t(only ? 'media.menu.moveMany' : 'media.menu.moveItems', { count }) : this.t('media.bulk.move'),
              icon: 'drive_file_move',
              action: () => this.move(),
            },
          ]
        : []),
      ...(writable && files.length > 0
        ? [
            ...(only
              ? [
                  {
                    id: 'cut' as const,
                    label: menu ? this.t('media.menu.cutMany', { count: files.length }) : this.t('media.bulk.cut'),
                    icon: 'content_cut',
                    action: () => this.items.cutFiles(files),
                  },
                ]
              : []),
            {
              id: 'copy' as const,
              label: menu ? this.t('media.menu.copyMany', { count: files.length }) : this.t('media.bulk.copy'),
              icon: 'content_copy',
              action: () => this.items.copyFiles(files),
            },
            {
              id: 'duplicate' as const,
              label: menu ? this.t('media.menu.duplicateMany', { count: files.length }) : this.t('media.bulk.duplicate'),
              icon: 'file_copy',
              action: () => void this.items.duplicate(files),
            },
          ]
        : []),
      ...(files.length > 0
        ? [
            {
              id: 'download' as const,
              label: menu ? this.t(files.length > 1 ? 'media.menu.downloadMany' : 'media.menu.download', { count: files.length }) : this.t('media.bulk.download'),
              icon: 'download',
              action: () => void this.items.download(files),
            },
          ]
        : []),
      ...(this.releases.canRelease()
        ? [
            {
              id: 'release' as const,
              label: menu ? this.t('media.menu.releaseItems', { count }) : this.t('media.bulk.release'),
              icon: 'publish',
              action: () => this.releases.release(files, folders),
            },
          ]
        : []),
      ...(writable
        ? [
            {
              id: 'delete' as const,
              label: menu ? this.t(only ? 'media.menu.deleteMany' : 'media.menu.deleteItems', { count }) : this.t('media.bulk.delete'),
              icon: 'delete',
              danger: true,
              action: () => void this.delete(),
            },
          ]
        : []),
    ];
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  /** One move dialog for the selection (folders blocked from moving into themselves). */
  move(): Promise<void> {
    const files = this.library.selectedItems();
    const folders = this.library.selectedFolders().flatMap((folder) => (folder.uuid ? [folder.uuid] : []));
    if (folders.length === 0) {
      return this.mover.moveFiles(files);
    }
    return files.length === 0 ? this.mover.moveFolders(folders) : this.mover.moveSelection(files, folders);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /**
   * Deletes the selection. Files alone keep the file flow (25 files or more need the word typed); one folder alone is a
   * folder delete; a mix asks once, names everything, counts what lies inside the folders, and offers one Undo.
   */
  async delete(): Promise<void> {
    const files = this.library.selectedItems();
    const folders = this.library.selectedFolders();
    if (folders.length === 0) {
      return this.items.deleteSelection();
    }
    if (files.length === 0 && folders.length === 1) {
      await this.folders.deleteFolder(folders[0]);
      this.library.clearSelection();
      return;
    }
    if (!this.library.canEdit()) {
      return;
    }
    const inside = folders.reduce((sum, folder) => {
      const content = folderContentCount(folder, this.library.mediaByFolder());
      return sum + content.folders + content.media;
    }, 0);
    const count = files.length + folders.length;
    const online = files.some((file) => isOnline(file.release)) || folders.some((folder) => isOnline(folder.release));
    const confirmed = await this.confirms.confirm({
      title: this.t('media.bulk.deleteTitle', { count }),
      message: [this.t('media.bulk.deleteMessage'), online ? this.t('media.folders.delete.online') : ''].filter(Boolean).join(' '),
      details: [...folders, ...files].map((item) => item.displayName ?? item.uid ?? ''),
      confirmLabel: this.t('media.bulk.deleteConfirm', { count }),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(count + inside),
      injector: this.injector,
    });
    if (!confirmed) {
      return;
    }
    const key = this.library.projectKey();
    const steps: UndoStep[] = [];
    let failed = 0;
    let deleted = 0;
    let first = '';
    for (const folder of folders) {
      const uuid = folder.uuid;
      try {
        await firstValueFrom(this.api.deleteFolder(key, uuid ?? '', true), { defaultValue: undefined });
      } catch {
        failed += 1;
        continue;
      }
      deleted += 1;
      first ||= folder.displayName ?? folder.uid ?? '';
      steps.push(() => this.api.restoreFolder(key, uuid ?? ''));
    }
    for (const file of files) {
      const uuid = file.uuid ?? '';
      try {
        await firstValueFrom(this.api.deleteAsset(key, uuid), { defaultValue: undefined });
      } catch {
        failed += 1;
        continue;
      }
      deleted += 1;
      first ||= file.displayName ?? file.uid ?? '';
      const revision = file.revision;
      if (revision != null) {
        steps.push(() => this.api.restoreAsset(key, uuid, { fromRevision: revision }));
      }
      this.library.onDeleted(uuid);
    }
    this.library.clearSelection();
    this.library.reloadFolders();
    if (failed > 0) {
      this.toasts.show(this.t('media.bulk.deleteFailedSome', { failed, total: count }), 'error');
    }
    if (deleted > 0) {
      // Undone last to first: the first step (undone last) reads the library again.
      this.undo.offerGroup(this.t('media.bulk.deleteDone', { count: deleted, name: first }), [
        () => Promise.resolve(this.library.reloadFolders()),
        ...steps,
      ]);
    }
  }
}
