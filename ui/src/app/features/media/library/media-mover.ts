import { Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { type UndoStep, UndoService } from '../../../core/ui/undo.service';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { type MediaMoveDialogData, MediaMoveDialogComponent, type MediaMoveDialogResult } from './media-move-dialog.component';
import { MediaLibraryStore } from './media-library.store';

/** The drag payload type of cards dragged out of the grid: a JSON array of file uuids. */
export const MEDIA_DRAG_TYPE = 'application/x-sf-media-files';

/** What is moved: files or folders (the messages differ, and a folder's move reloads the tree). */
export type MediaMoveKind = 'file' | 'folder';

/**
 * Moving things in the library, in one place for every way to ask for it (decision 94): the bulk bar's *Move*, a file's
 * *Move…*, the page header's *Move folder…*, the tree's *Move to…* and a drag onto a tree folder. The dialog
 * ({@link MediaMoveDialogComponent}) asks for a target when there is none; the move itself calls the API once per item,
 * then offers **one Undo for the group** that moves everything back to the folder it came from.
 */
@Injectable()
export class MediaMover {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly dialogs = inject(DialogService);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);
  private readonly library = inject(MediaLibraryStore);

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`media.move.${key}`, params);
  }

  /** Asks where the files go (the open folder is "current"), then moves them. */
  async moveFiles(files: readonly { uuid?: string; displayName?: string }[]): Promise<void> {
    const uuids = files.flatMap((file) => (file.uuid ? [file.uuid] : []));
    if (uuids.length === 0 || !this.library.canEdit()) {
      return;
    }
    const target = await this.choose({
      title: this.t('title', { count: uuids.length, name: files[0].displayName ?? '' }),
      current: this.library.folderUuid() || null,
      excluded: [],
    });
    if (target) {
      await this.moveTo(uuids, target.target, 'file');
    }
  }

  /** Asks where the folders go (their parent is "current"; they and what is inside them are blocked), then moves them. */
  async moveFolders(uuids: readonly string[]): Promise<void> {
    if (uuids.length === 0 || !this.library.canEdit()) {
      return;
    }
    const target = await this.choose({
      title: this.t('folderTitle', { count: uuids.length, name: this.library.labelOf(uuids[0]) ?? '' }),
      current: this.library.parentFolderUuidOf(uuids[0]) ?? null,
      excluded: uuids,
    });
    if (target) {
      await this.moveTo(uuids, target.target, 'folder');
    }
  }

  /**
   * Asks once where a mixed selection of files and folders goes (the open folder is "current"; the folders and what is inside
   * them are blocked), then moves the folders and the files — each with its own Undo.
   */
  async moveSelection(files: readonly { uuid?: string; displayName?: string }[], folders: readonly string[]): Promise<void> {
    const fileUuids = files.flatMap((file) => (file.uuid ? [file.uuid] : []));
    if (fileUuids.length + folders.length === 0 || !this.library.canEdit()) {
      return;
    }
    const target = await this.choose({
      title: this.t('itemsTitle', { count: fileUuids.length + folders.length }),
      current: this.library.folderUuid() || null,
      excluded: folders,
    });
    if (target) {
      if (folders.length > 0) {
        await this.moveTo(folders, target.target, 'folder');
      }
      if (fileUuids.length > 0) {
        await this.moveTo(fileUuids, target.target, 'file');
      }
    }
  }

  private choose(data: Omit<MediaMoveDialogData, 'tree'>): Promise<MediaMoveDialogResult | undefined> {
    return this.dialogs.open<MediaMoveDialogResult, MediaMoveDialogData>(
      MediaMoveDialogComponent,
      { ...data, tree: this.library.tree() },
      { injector: this.injector },
    ).result;
  }

  /**
   * Moves files or folders into the folder `target` (`null`: the top level) and offers one Undo for all of them. What is
   * already in the target stays put; a refused item is counted in an error toast and the rest still moves.
   */
  async moveTo(uuids: readonly string[], target: string | null, kind: MediaMoveKind): Promise<void> {
    if (!this.library.canEdit() || uuids.length === 0) {
      return;
    }
    const key = this.library.projectKey();
    const to = target ?? undefined;
    const moved: { uuid: string; from: string | undefined; label: string }[] = [];
    let failed = 0;
    for (const uuid of uuids) {
      const from = this.library.parentFolderUuidOf(uuid);
      if (from === to) {
        continue;
      }
      const label = this.library.labelOf(uuid) ?? '';
      try {
        await firstValueFrom(this.api.moveAsset(key, uuid, target ? { folderUuid: target } : {}), { defaultValue: undefined });
        moved.push({ uuid, from, label });
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.toasts.show(
        kind === 'folder'
          ? this.t('folderFailed')
          : uuids.length === 1
            ? this.t('failedOne', { name: this.library.labelOf(uuids[0]) ?? '' })
            : this.t('failed', { count: failed, total: uuids.length }),
        'error',
      );
    }
    if (moved.length === 0) {
      return;
    }
    if (kind === 'file') {
      // The files leave the open folder (and the selection); an open drawer on one of them closes.
      moved.forEach(({ uuid }) => this.library.onDeleted(uuid));
    }
    const folder = target ? (this.library.labelOf(target) ?? '') : this.t('topLevel');
    const params = { count: moved.length, name: moved[0].label, folder };
    const reload = () => (kind === 'folder' ? this.library.reloadFolders() : this.library.reloadMedia());
    // Undone last to first; the first step (undone last) reads the library again.
    const steps: UndoStep[] = [
      () => Promise.resolve(reload()),
      ...moved.map(({ uuid, from }) => () => this.api.moveAsset(key, uuid, from ? { folderUuid: from } : {})),
    ];
    this.undo.offerGroup(this.t(kind === 'folder' ? 'folderDone' : 'done', params), steps);
    reload();
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  /** Puts the dragged files on the drag: the card's own file, or the whole selection when the card is part of it. */
  startDrag(event: DragEvent, uuid: string | undefined): void {
    if (!uuid || !this.library.canEdit() || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const selected = this.library.selected();
    const uuids = selected.length > 1 && selected.includes(uuid) ? selected : [uuid];
    event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(uuids));
    event.dataTransfer.effectAllowed = 'move';
  }

  /** Whether files dragged from the grid may land on the tree's `target` (`null`: the top level): not where they are. */
  acceptsDrag(event: DragEvent, target: { id: string } | null): boolean {
    return (
      this.library.canEdit() &&
      event.dataTransfer?.types.includes(MEDIA_DRAG_TYPE) === true &&
      (target?.id ?? '') !== this.library.folderUuid()
    );
  }

  /** The files of a drop onto the tree move into the folder dropped on. */
  drop(event: DragEvent, target: { id: string } | null): Promise<void> {
    const raw = event.dataTransfer?.getData(MEDIA_DRAG_TYPE);
    let uuids: string[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      uuids = Array.isArray(parsed) ? parsed.filter((uuid): uuid is string => typeof uuid === 'string') : [];
    } catch {
      uuids = [];
    }
    return this.moveTo(uuids, target?.id ?? null, 'file');
  }
}
