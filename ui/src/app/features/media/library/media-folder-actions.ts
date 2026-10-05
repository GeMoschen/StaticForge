import { Injectable, Injector, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, firstValueFrom, tap } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { FavoritesService } from '../../../core/assets/favorites.service';
import { ToastService } from '../../../core/ui/toast.service';
import { UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../shared/components/dialog/delete-confirm';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { type SfMenuItem, toContextItems } from '../../../shared/components/menu/sf-menu-item';
import { type ContextMenuItem, ContextMenuService, type ContextMenuTarget } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { isOnline } from '../../release/release-status.util';
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaReleaseActions } from './media-release.actions';
import { MediaSelectionActions } from './media-selection.actions';
import { MediaUploadStore } from './media-upload.store';
import { type FolderView, MediaLibraryStore } from './media-library.store';
import { findFolder, findParentFolder, folderContentCount } from './media-library.util';
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
  private readonly contextMenu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly favorites = inject(FavoritesService);
  private readonly releases = inject(MediaReleaseActions);
  // Resolved when needed: the selection's actions use this service too.
  private get selection(): MediaSelectionActions {
    return this.injector.get(MediaSelectionActions);
  }
  private get items(): MediaItemActions {
    return this.injector.get(MediaItemActions);
  }

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

  // ── Menu ────────────────────────────────────────────────────────────────

  /**
   * The entries of a folder tile's menu (card, list row, ⋮ button) — the same as the folder tree's: *New folder, Rename…,
   * Cut, Paste, Move to…, Upload, favorite, Release…, Delete…* (a read-only project keeps *Upload*, the favorite and
   * *Release…* as far as it may). Inside a selection of several files and folders: the selection's actions.
   */
  menuItems(folder: FolderView): SfMenuItem[] {
    if (this.selection.multiFor(folder.uuid)) {
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
    const t = (id: string) => this.transloco.translate(`media.library.${id}`);
    const tree = (id: string) => this.transloco.translate(`shared.tree.${id}`);
    const writable = this.library.canEdit();
    const uploads = this.injector.get(MediaUploadStore);
    const name = folder.displayName ?? folder.uid ?? '';
    const on = this.favorites.isFavorite(folder.uuid);
    const section = (items: SfMenuItem[]): SfMenuItem[] => items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item));
    const items: SfMenuItem[] = [
      ...(writable
        ? [
            { id: 'create', label: tree('newFolder'), icon: 'create_new_folder', action: () => this.startCreate(folder.uuid ?? null) },
            { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', action: () => void this.rename(folder) },
            ...section([
              { id: 'cut', label: tree('cut'), icon: 'content_cut', shortcut: 'Mod+X', action: () => this.cut(folder) },
              { id: 'paste', label: tree('paste'), icon: 'content_paste', shortcut: 'Mod+V', disabled: !this.canPaste(folder), action: () => void this.paste(folder) },
              { id: 'move', label: tree('moveTo'), icon: 'drive_file_move', action: () => void this.injector.get(MediaMover).moveFolders(folder.uuid ? [folder.uuid] : []) },
            ]),
          ]
        : []),
      ...section([
        ...(uploads.canUpload()
          ? [{ id: 'upload', label: this.transloco.translate('media.toolbar.upload'), icon: 'upload', action: () => uploads.pickFiles(folder.uuid ?? '') }]
          : []),
        { id: 'favorite', label: this.transloco.translate(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name }), icon: 'star', action: () => this.toggleFavorite(folder) },
        ...(this.releases.canRelease()
          ? [{ id: 'release', label: this.transloco.translate('media.menu.release'), icon: 'publish', action: () => this.releases.release([], [folder]) }]
          : []),
      ]),
      ...(writable
        ? [{ id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, shortcut: 'Delete', action: () => void this.deleteFolder(folder) }]
        : []),
    ];
    // Nothing above the first entry to separate it from.
    return items.map((item, index) => (index === 0 ? { ...item, separatorBefore: false } : item));
  }

  /** Delete on a tile or row: the selection when the folder is part of a selection of several, else the folder. */
  async deleteFromTile(folder: FolderView): Promise<void> {
    if (this.selection.multiFor(folder.uuid)) {
      await this.selection.delete();
    } else {
      await this.deleteFolder(folder);
    }
  }

  /** Stars the folder or takes the star off, and says so (decision 57). */
  toggleFavorite(folder: FolderView): void {
    if (!folder.uuid) {
      return;
    }
    const name = folder.displayName ?? folder.uid ?? '';
    const on = this.favorites.toggle({ type: 'FOLDER', uuid: folder.uuid, displayName: name, folderPath: folder.path });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name }), 'info');
  }

  // ── Cut and paste (the tree's clipboard) ────────────────────────────────

  /** The clipboard scope of the media tree of this project (`sf-tree` keeps `projectKey:treeId`). */
  private clipboardScope(): string {
    return `${this.library.projectKey()}:media`;
  }

  /** *Cut*: the folder goes on the tree's clipboard, to be pasted onto a folder (here or in the tree). */
  cut(folder: FolderView): void {
    if (folder.uuid && this.library.canEdit()) {
      this.clipboard.cutNodes(this.clipboardScope(), [
        { id: folder.uuid, label: folder.displayName ?? folder.uid ?? '', icon: 'folder', droppable: true, data: folder },
      ]);
    }
  }

  /** The folders cut in the tree or on a tile that may go into `target`: not into themselves or what is inside them. */
  private pastable(target: FolderView): string[] {
    const clip = this.clipboard.nodes();
    if (!clip || clip.mode !== 'cut' || clip.scope !== this.clipboardScope() || !target.uuid) {
      return [];
    }
    const ids = clip.nodes.map((node) => node.id);
    const inside = (id: string) => {
      const cut = findFolder(this.library.tree(), id);
      return id === target.uuid || (cut !== null && findFolder(cut.children ?? [], target.uuid ?? '') !== null);
    };
    return ids.some(inside) ? [] : ids;
  }

  canPaste(target: FolderView): boolean {
    return this.library.canEdit() && (this.pastable(target).length > 0 || this.items.canPasteFiles(target.uuid ?? null));
  }

  /** *Paste* onto a folder: cut folders move into it, as a paste in the tree does; cut or copied files move or are copied into it. */
  async paste(target: FolderView): Promise<void> {
    if (this.items.clipboardFiles()) {
      await this.items.pasteFiles(target.uuid ?? null);
      return;
    }
    const ids = this.canPaste(target) ? this.pastable(target) : [];
    if (ids.length === 0 || !target.uuid) {
      return;
    }
    this.clipboard.clear();
    await this.injector.get(MediaMover).moveTo(ids, target.uuid, 'folder');
  }

  /**
   * The menu of a right click on empty space of the open folder: *Upload*, *New folder* inside it — nothing that
   * changes the folder itself. A read-only project has none.
   */
  openFolderContextMenu(event: MouseEvent): void {
    const items = this.openFolderMenuItems();
    if (items.length) {
      event.preventDefault();
      this.contextMenu.open(event, items);
    }
  }

  /** The entries of that menu (*Upload*, *New folder*), for a table's `emptyMenu`. */
  openFolderMenuItems(): ContextMenuItem[] {
    const uploads = this.injector.get(MediaUploadStore);
    const open = this.library.folderUuid() || null;
    return [
      ...(uploads.canUpload() ? [{ label: this.transloco.translate('media.toolbar.upload'), icon: 'upload', action: () => uploads.pickFiles() }] : []),
      ...(this.library.canEdit()
        ? [
            { label: this.transloco.translate('shared.tree.newFolder'), icon: 'create_new_folder', action: () => this.startCreate() },
            {
              label: this.transloco.translate('shared.tree.paste'),
              icon: 'content_paste',
              disabled: !this.items.canPasteFiles(open),
              action: () => void this.items.pasteFiles(open),
            },
          ]
        : []),
    ];
  }

  /** The folder tile's context menu: at the pointer for a right click, below the element for Shift+F10 and the ⋮ button. */
  onFolderContextMenu(folder: FolderView, target: ContextMenuTarget): void {
    this.contextMenu.open(target, toContextItems(this.menuItems(folder)));
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
