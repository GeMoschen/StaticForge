import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, firstValueFrom, tap } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { FavoritesService } from '../../../core/assets/favorites.service';
import { ToastService } from '../../../core/ui/toast.service';
import { type UndoStep, UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../shared/components/dialog/delete-confirm';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import type { SfMenuItem } from '../../../shared/components/menu/sf-menu-item';
import { toContextItems } from '../../../shared/components/menu/sf-menu-item';
import { ContextMenuItem, ContextMenuService, type ContextMenuTarget } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { isOnline } from '../../release/release-status.util';
import { saveBlob, zipSlug } from './media-download.util';
import { type MediaRenameDialogData, MediaRenameDialogComponent } from './media-rename-dialog.component';
import { MediaMover } from './media-mover';
import { MediaReleaseActions } from './media-release.actions';
import { MediaSelectionActions } from './media-selection.actions';
import { type MediaSummaryView, type MediaView, MediaLibraryStore } from './media-library.store';

/** A file as the actions need it: what the library's list reports (a drawer's full view carries all of it). */
type FileRef = Pick<MediaSummaryView, 'uuid' | 'displayName' | 'uid' | 'revision' | 'release' | 'usageCount' | 'folderPath' | 'mimeType'>;

/**
 * Everything you can do to a media file of the grid and the list (decision 92): the one menu — *Rename…, Move…,
 * Download, Copy link, Add to favorites, Release…, Delete…* — on a card or row (right click, Shift+F10, the ⋮ button), which acts on
 * the whole selection when the file is part of a multi-file selection (*Move N files…, Download N files as ZIP, Release N
 * items…, Delete N files…*; see {@link MediaSelectionActions}, which also covers folders in the selection), plus rename (dialog), download (one file as itself, several as one ZIP named after the folder), copy link,
 * delete (typed word from 25 files) and favorites. Every rename, move and delete offers Undo; a bulk operation undoes as a
 * group. Moving lives in {@link MediaMover}.
 */
@Injectable()
export class MediaItemActions {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly dialogs = inject(DialogService);
  private readonly injector = inject(Injector);
  private readonly menu = inject(ContextMenuService);
  private readonly transloco = inject(TranslocoService);
  private readonly favorites = inject(FavoritesService);
  private readonly mover = inject(MediaMover);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly library = inject(MediaLibraryStore);
  private readonly releases = inject(MediaReleaseActions);
  // Resolved when needed: the selection's actions use this service too.
  private get selection(): MediaSelectionActions {
    return this.injector.get(MediaSelectionActions);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`media.${key}`, params);
  }

  // ── The menu ───────────────────────────────────────────────────────────────

  /** What a menu of `file` acts on: the whole selection when the file is part of a multi-file selection, else the file. */
  menuTargets(file: FileRef): readonly MediaSummaryView[] {
    const selected = this.library.selectedItems();
    return selected.length > 1 && this.library.isSelected(file.uuid) ? selected : [file as MediaSummaryView];
  }

  /**
   * The entries of a file's menu (card, list row, ⋮ button): *Rename…, Move…, Download, Copy link, favorite, Release…,
   * Delete…*; inside a selection of several files and folders the selection's actions with the count. A read-only project
   * keeps what only reads.
   */
  menuItems(file: FileRef): SfMenuItem[] {
    const writable = this.library.canEdit();
    if (this.selection.multiFor(file.uuid)) {
      return this.selection.actions('menu').map(({ id, label, icon, danger, action }) => ({
        id,
        label,
        icon,
        danger,
        separatorBefore: id === 'delete',
        shortcut: id === 'delete' ? 'Delete' : undefined,
        action,
      }));
    }
    const name = file.displayName ?? file.uid ?? '';
    const favorite = this.isFavorite(file);
    return [
      ...(writable
        ? [
            { id: 'rename', label: this.t('menu.rename'), icon: 'edit', shortcut: 'F2', action: () => void this.rename(file) },
            { id: 'move', label: this.t('menu.move'), icon: 'drive_file_move', action: () => void this.mover.moveFiles([file]) },
            { id: 'cut', label: this.t('menu.cut'), icon: 'content_cut', separatorBefore: true, shortcut: 'Mod+X', action: () => this.cutFiles([file]) },
            { id: 'copy', label: this.t('menu.copy'), icon: 'content_copy', shortcut: 'Mod+C', action: () => this.copyFiles([file]) },
            { id: 'duplicate', label: this.t('menu.duplicate'), icon: 'file_copy', action: () => void this.duplicate([file]) },
          ]
        : []),
      { id: 'download', label: this.t('menu.download'), icon: 'download', action: () => void this.download([file]) },
      { id: 'copyLink', label: this.t('menu.copyLink'), icon: 'link', action: () => void this.copyLink(file) },
      {
        id: 'favorite',
        label: this.transloco.translate(favorite ? 'shared.favorite.remove' : 'shared.favorite.add', { name }),
        icon: 'star',
        action: () => this.toggleFavorite(file),
      },
      ...(this.releases.canRelease()
        ? [{ id: 'release', label: this.t('menu.release'), icon: 'publish', action: () => this.releases.release([file as MediaSummaryView]) }]
        : []),
      ...(writable
        ? [
            {
              id: 'delete',
              label: this.t('menu.delete'),
              icon: 'delete',
              danger: true,
              separatorBefore: true,
              shortcut: 'Delete',
              action: () => void this.deleteFile(file),
            },
          ]
        : []),
    ];
  }

  /** The file's context menu: at the pointer for a right click, below the element for Shift+F10 and the ⋮ button. */
  onItemContextMenu(file: FileRef, target: ContextMenuTarget): void {
    if (!file.uuid) {
      return;
    }
    this.menu.open(target, toContextItems(this.menuItems(file)));
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  /** F2 / *Rename…*: the Rename dialog (name field, validation, Apply), then the rename with its Undo toast. */
  async rename(file: FileRef): Promise<void> {
    const uuid = file.uuid;
    const current = file.displayName ?? '';
    if (!uuid || !this.library.canEdit()) {
      return;
    }
    const taken = this.library
      .items()
      .filter((other) => other.uuid !== uuid)
      .map((other) => (other.displayName ?? '').toLowerCase());
    const data: MediaRenameDialogData = {
      name: current,
      folder: this.library.folderNode()?.displayName ?? this.t('library.title'),
      taken,
      uid: this.uidData(file),
    };
    const name = await this.dialogs.open<string, MediaRenameDialogData>(MediaRenameDialogComponent, data, { injector: this.injector }).result;
    if (!name || name === current) {
      return;
    }
    this.renameMedia(uuid, current, name, file.revision).subscribe({
      error: () => this.toasts.show(this.t('rename.failed', { name: current }), 'error'),
    });
  }

  /** What the Rename dialog needs to change the file's UID (developer mode); the library shows a new UID at once. */
  private uidData(file: FileRef): MediaRenameDialogData['uid'] {
    const uuid = file.uuid;
    if (!uuid) {
      return undefined;
    }
    const shown = (uid: string) => this.library.onUidChanged(uuid, uid);
    return { projectKey: this.library.projectKey(), uuid, uid: file.uid ?? '', changed: shown, undone: shown };
  }

  /**
   * Renames a media item and offers Undo (rename back; the revision the rename produced guards against edits made in
   * between). Without an old name — nothing to rename back to — it is a plain success toast. The library shows the new name at
   * once. The caller handles errors.
   */
  renameMedia(
    uuid: string,
    oldName: string | undefined | null,
    displayName: string,
    revision: number | undefined | null,
  ): Observable<unknown> {
    const key = this.library.projectKey();
    return this.api.renameAsset(key, uuid, { displayName }, revision ?? undefined).pipe(
      tap((renamed) => {
        this.library.onRenamed(uuid, displayName, renamed.revision);
        if (oldName) {
          this.undo.offer(this.t('rename.done', { from: oldName, to: displayName }), () =>
            this.api
              .renameAsset(key, uuid, { displayName: oldName }, renamed.revision ?? undefined)
              .pipe(tap((back) => this.library.onRenamed(uuid, oldName, back.revision))),
          );
        } else {
          this.toasts.show(this.t('rename.renamedOne'), 'success');
        }
      }),
    );
  }

  // ── Copy, duplicate and paste (the shared clipboard) ───────────────────────

  /** Files are not nodes of the folder tree: they sit on the shared clipboard under their own scope, which the tree never pastes. */
  private fileScope(): string {
    return `${this.library.projectKey()}:media-files`;
  }

  private clipNodes(files: readonly FileRef[]) {
    return files.flatMap((file) =>
      file.uuid
        ? [{ id: file.uuid, label: file.displayName ?? file.uid ?? '', icon: 'description', data: { folderUuid: this.library.parentFolderUuidOf(file.uuid) ?? null } }]
        : [],
    );
  }

  /** *Cut*: the files go on the clipboard to be moved by *Paste* onto a folder. */
  cutFiles(files: readonly FileRef[]): void {
    const nodes = this.clipNodes(files);
    if (nodes.length > 0 && this.library.canEdit()) {
      this.clipboard.cutNodes(this.fileScope(), nodes);
    }
  }

  /** *Copy*: the files go on the clipboard to be duplicated into the folder *Paste* is used on. */
  copyFiles(files: readonly FileRef[]): void {
    const nodes = this.clipNodes(files);
    if (nodes.length > 0 && this.library.canEdit()) {
      this.clipboard.copyNodes(this.fileScope(), nodes);
    }
  }

  /** The files on the clipboard (`null`: none, or something else is there). */
  clipboardFiles(): { mode: 'cut' | 'copy'; nodes: readonly { id: string; label: string; data?: unknown }[] } | null {
    const clip = this.clipboard.nodes();
    return clip && clip.scope === this.fileScope() && clip.nodes.length > 0 ? clip : null;
  }

  /** Whether *Paste* has files for the folder `target` (`null`: the top level): cut files are not pasted where they already are. */
  canPasteFiles(target: string | null): boolean {
    const clip = this.clipboardFiles();
    if (!clip || !this.library.canEdit()) {
      return false;
    }
    return clip.mode === 'copy' || clip.nodes.some((node) => ((node.data as { folderUuid?: string | null } | undefined)?.folderUuid ?? null) !== target);
  }

  /** *Paste* onto a folder: cut files move into it, copied files are duplicated into it (one Undo either way). */
  async pasteFiles(target: string | null): Promise<void> {
    const clip = this.clipboardFiles();
    if (!clip || !this.canPasteFiles(target)) {
      return;
    }
    if (clip.mode === 'cut') {
      this.clipboard.clear();
      await this.mover.moveTo(clip.nodes.map((node) => node.id), target, 'file');
      return;
    }
    await this.copyInto(clip.nodes.map((node) => ({ uuid: node.id, name: node.label })), target);
  }

  /** *Duplicate*: a copy of each file next to it ("name copy", an unreleased draft), with Undo. */
  async duplicate(files: readonly FileRef[]): Promise<void> {
    if (!this.library.canEdit()) {
      return;
    }
    await this.copyInto(
      files.flatMap((file) => (file.uuid ? [{ uuid: file.uuid, name: file.displayName ?? file.uid ?? '' }] : [])),
      undefined,
    );
  }

  /**
   * Copies the files into the folder `target` (`undefined`: each stays in its folder; `null`: the top level) — one request
   * per file, each one transaction on the server — then reloads and offers one Undo that deletes the copies.
   */
  private async copyInto(files: readonly { uuid: string; name: string }[], target: string | null | undefined): Promise<void> {
    if (files.length === 0 || !this.library.canEdit()) {
      return;
    }
    const key = this.library.projectKey();
    const copies: string[] = [];
    const names: string[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        const copy = await firstValueFrom(this.api.duplicateAsset(key, file.uuid, target));
        if (copy.uuid) {
          copies.push(copy.uuid);
          names.push(file.name);
        }
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.toasts.show(this.t('copy.failed', { failed, total: files.length }), 'error');
    }
    if (copies.length === 0) {
      return;
    }
    const folder = target ? (this.library.labelOf(target) ?? '') : this.t('library.title');
    const message = this.t(target === undefined ? 'copy.duplicated' : 'copy.pasted', { count: copies.length, name: names[0], folder });
    // Undone last to first; the first step (undone last) reads the library again.
    this.undo.offerGroup(message, [
      () => Promise.resolve(this.library.reloadMedia()),
      ...copies.map((uuid) => () => this.api.deleteAsset(key, uuid)),
    ]);
    this.library.reloadMedia();
  }

  // ── Download and link ──────────────────────────────────────────────────────

  /**
   * One file downloads as itself; several as **one ZIP named after the folder** (decision 95). Errors are toasted (the
   * server refuses a download of more than 500 files or 100 MB).
   */
  async download(files: readonly FileRef[]): Promise<void> {
    const uuids = files.flatMap((file) => (file.uuid ? [file.uuid] : []));
    if (uuids.length === 0) {
      return;
    }
    const key = this.library.projectKey();
    if (uuids.length === 1) {
      const name = files[0].displayName ?? files[0].uid ?? 'file';
      try {
        saveBlob(await firstValueFrom(this.api.mediaBinaryBlob(key, uuids[0])), name);
      } catch {
        this.toasts.show(this.t('download.failed', { name }), 'error');
      }
      return;
    }
    const folder = this.library.folderNode()?.displayName ?? this.t('library.title');
    const slug = zipSlug(folder, this.t('download.zipName'));
    try {
      saveBlob(await firstValueFrom(this.api.downloadMediaZip(key, uuids, slug)), `${slug}.zip`);
    } catch (error) {
      this.toasts.show(this.t(error instanceof HttpErrorResponse && error.status === 413 ? 'download.tooLarge' : 'download.zipFailed'), 'error');
    }
  }

  /** Copies the link that opens the file in the library (`?asset=`), as the Pages screens copy theirs. */
  async copyLink(file: FileRef): Promise<void> {
    const url = `${window.location.origin}/p/${this.library.projectKey()}/media?asset=${file.uuid}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toasts.show(this.t('menu.linkCopied'), 'success');
    } catch {
      this.toasts.show(this.t('menu.linkFailed'), 'error');
    }
  }

  // ── Favorites ──────────────────────────────────────────────────────────────

  isFavorite(file: FileRef): boolean {
    return this.favorites.isFavorite(file.uuid);
  }

  /** Stars the file or takes the star off, and says so (decisions 57–58). */
  toggleFavorite(file: FileRef): void {
    if (!file.uuid) {
      return;
    }
    const name = file.displayName ?? file.uid ?? file.uuid;
    const on = this.favorites.toggle({ type: 'MEDIA', uuid: file.uuid, displayName: name, folderPath: file.folderPath });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name }), 'info');
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /** What a delete confirmation adds: the places that use the files, and that published files stay online. */
  private deleteMessage(files: readonly { usageCount?: number | null; release?: MediaView['release'] }[]): string | undefined {
    const used = files.reduce((sum, file) => sum + (file.usageCount ?? 0), 0);
    const online = files.some((file) => isOnline(file.release));
    const parts = [
      used > 0 ? this.t('delete.messageUsed', { count: used }) : this.t('delete.message'),
      online ? this.t(files.length === 1 ? 'delete.onlineOne' : 'delete.online') : '',
    ];
    return parts.filter(Boolean).join(' ');
  }

  /** Asks, deletes one media item and offers Undo. `true` when it was deleted. */
  async deleteMedia(target: {
    uuid: string;
    label: string;
    revision?: number | null;
    release?: MediaView['release'];
    usageCount?: number | null;
  }): Promise<boolean> {
    if (!this.library.canEdit()) {
      return false;
    }
    const { uuid, label } = target;
    const confirmed = await this.confirms.confirm({
      title: this.t('delete.title', { count: 1, name: label }),
      message: this.deleteMessage([target]),
      confirmLabel: this.t('delete.confirm', { count: 1 }),
      tone: 'danger',
      injector: this.injector,
    });
    if (!confirmed) {
      return false;
    }
    const key = this.library.projectKey();
    try {
      await firstValueFrom(this.api.deleteAsset(key, uuid), { defaultValue: undefined });
    } catch {
      this.toasts.show(this.t('delete.failed', { name: label }), 'error');
      return false;
    }
    // The grid and the tree drop the item; a drawer open on another file stays open.
    this.library.onDeleted(uuid);
    const restore = this.restoreStep(key, uuid, target.revision);
    if (restore) {
      this.undo.offer(this.t('delete.done', { count: 1, name: label }), restore);
    } else {
      this.toasts.show(this.t('delete.done', { count: 1, name: label }), 'success');
    }
    return true;
  }

  /** Undo of a delete: the asset comes back as it was at its last live revision, and the library re-reads. */
  private restoreStep(key: string, uuid: string, revision: number | undefined | null): UndoStep | null {
    return revision == null
      ? null
      : () => this.api.restoreAsset(key, uuid, { fromRevision: revision }).pipe(tap(() => this.library.reloadMedia()));
  }

  /** Delete on a card or row: the selection when the file is part of a multi-file selection, else the file itself. */
  async deleteFile(file: FileRef): Promise<void> {
    if (this.selection.multiFor(file.uuid)) {
      await this.selection.delete();
    } else if (file.uuid) {
      await this.deleteMedia({
        uuid: file.uuid,
        label: file.displayName ?? file.uid ?? '',
        revision: file.revision,
        release: file.release,
        usageCount: file.usageCount,
      });
    }
  }

  /** Deletes the selection: 25 files or more need the word *delete* typed (decision 99); one Undo restores the group. */
  async deleteSelection(): Promise<void> {
    const uuids = this.library.selected();
    if (uuids.length === 0 || !this.library.canEdit()) {
      return;
    }
    const picked = this.library.items().filter((i) => i.uuid != null && uuids.includes(i.uuid));
    const confirmed = await this.confirms.confirm({
      title: this.t('delete.title', { count: uuids.length, name: picked[0]?.displayName ?? '' }),
      message: this.deleteMessage(picked),
      details: uuids.length > 1 ? picked.map((i) => i.displayName ?? i.uid ?? i.uuid ?? '') : undefined,
      confirmLabel: this.t('delete.confirm', { count: uuids.length }),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(uuids.length),
      injector: this.injector,
    });
    if (!confirmed) {
      return;
    }
    const key = this.library.projectKey();
    const steps: UndoStep[] = [];
    const deletedNames: string[] = [];
    let failed = 0;
    for (const uuid of uuids) {
      try {
        await firstValueFrom(this.api.deleteAsset(key, uuid), { defaultValue: undefined });
      } catch {
        failed += 1;
        continue;
      }
      const file = picked.find((i) => i.uuid === uuid);
      deletedNames.push(file?.displayName ?? file?.uid ?? '');
      const restore = this.restoreStep(key, uuid, file?.revision);
      if (restore) {
        steps.push(restore);
      }
      this.library.onDeleted(uuid);
    }
    this.library.clearSelection();
    if (failed > 0) {
      this.toasts.show(this.t('delete.failedSome', { failed, total: uuids.length }), 'error');
    }
    const deleted = uuids.length - failed;
    if (deleted > 0) {
      this.undo.offerGroup(this.t('delete.done', { count: deleted, name: deletedNames[0] }), steps);
    }
  }
}
