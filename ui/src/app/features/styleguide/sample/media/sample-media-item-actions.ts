import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfMenuItem, toContextItems } from '../../../../shared/components/menu/sf-menu-item';
import type { SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { ContextMenuItem, ContextMenuService, ContextMenuTarget } from '../../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../../shared/services/tree-clipboard.service';
import { SampleMediaFile, SampleMediaFolder, copyName, mediaFolder, mediaFolderDescendants } from './sample-media-data';
import { SampleMediaState } from './sample-media-state';

/** The clipboard scope of the folder tree (`sf-tree` `clipboardScope`): folders cut in the tree or on a tile. */
export const MEDIA_TREE_SCOPE = 'sample:media';
/** Files are not nodes of the tree: they sit on the shared clipboard under their own scope, which the tree never pastes. */
const FILE_SCOPE = 'sample:media-files';

/** One thing the selection offers: an entry of the multi-selection menu and a button of the bulk bar. */
export interface SampleSelectionAction {
  readonly id: 'move' | 'cut' | 'copy' | 'duplicate' | 'download' | 'release' | 'delete';
  readonly label: string;
  readonly icon: string;
  readonly danger?: boolean;
  readonly action: () => void;
}

/**
 * What the media menus of the sample do (M35.22 follow-ups, mirroring the app's `MediaItemActions`, `MediaFolderActions`
 * and `MediaSelectionActions`): the menus of a file, a folder tile, a tree folder, the selection and the empty space of
 * the open folder — the same entries, order and enabled / disabled states as the app, hidden in a read-only project —
 * and the actions behind them. The sample only announces: Cut and Copy put the files on the shared clipboard so *Paste*
 * enables, a paste moves or copies the sample's in-memory files (with Undo), the rest says what it would do.
 */
@Injectable()
export class SampleMediaItemActions {
  private readonly state = inject(SampleMediaState);
  private readonly toasts = inject(ToastService);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);

  /** Ids of the files and folders starred in the sample. */
  readonly favorites = signal<ReadonlySet<string>>(new Set());
  private nextCopy = 0;

  private t(key: string, params?: Record<string, unknown>): string {
    return this.state.t(key, params);
  }

  // ── Menus ──────────────────────────────────────────────────────────────────

  /** A menu opened on this file or folder acts on the whole selection when it is part of a selection of two or more. */
  multiFor(kind: 'file' | 'folder', id: string): boolean {
    return this.state.selectionCount() > 1 && (kind === 'file' ? this.state.isSelected(id) : this.state.isFolderSelected(id));
  }

  /**
   * The selection's actions, worded for the context `menu` ("Move 3 files…") or the `bulk` bar ("Move"). A read-only project
   * only downloads. Cut is for files only; a selection with folders says "items".
   */
  selectionActions(wording: 'menu' | 'bulk'): SampleSelectionAction[] {
    const files = this.state.selectedFiles();
    const folders = this.state.selectedFolders();
    const count = files.length + folders.length;
    const writable = this.state.canEdit();
    const menu = wording === 'menu';
    const only = folders.length === 0;
    const label = (menuKey: string, bulkKey: string, params?: Record<string, unknown>) =>
      menu ? this.t(`menu.${menuKey}`, params) : this.t(`bulk.${bulkKey}`);
    return [
      ...(writable
        ? [
            {
              id: 'move' as const,
              label: label(only ? 'moveMany' : 'moveItems', 'move', { count }),
              icon: 'drive_file_move',
              action: () => (only ? void this.state.moveFiles(files) : void this.state.moveFolder(folders[0])),
            },
          ]
        : []),
      ...(writable && files.length > 0
        ? [
            ...(only ? [{ id: 'cut' as const, label: label('cutMany', 'cut', { count: files.length }), icon: 'content_cut', action: () => this.cutFiles(files) }] : []),
            { id: 'copy' as const, label: label('copyMany', 'copy', { count: files.length }), icon: 'content_copy', action: () => this.copyFiles(files) },
            { id: 'duplicate' as const, label: label('duplicateMany', 'duplicate', { count: files.length }), icon: 'file_copy', action: () => this.duplicate(files) },
          ]
        : []),
      ...(files.length > 0
        ? [
            {
              id: 'download' as const,
              label: label(files.length > 1 ? 'downloadMany' : 'download', 'download', { count: files.length }),
              icon: 'download',
              action: () => this.state.download(files),
            },
          ]
        : []),
      ...(this.canRelease() ? [{ id: 'release' as const, label: label('releaseItems', 'release', { count }), icon: 'publish', action: () => this.release(files, folders) }] : []),
      ...(writable
        ? [{ id: 'delete' as const, label: label(only ? 'deleteMany' : 'deleteItems', 'delete', { count }), icon: 'delete', danger: true, action: () => void this.deleteSelection() }]
        : []),
    ];
  }

  private selectionMenu(): SfMenuItem[] {
    return this.selectionActions('menu').map(({ id, label, icon, danger, action }) => ({
      id,
      label,
      icon,
      danger,
      separatorBefore: id === 'delete',
      shortcut: id === 'delete' ? 'Delete' : undefined,
      action,
    }));
  }

  /**
   * The entries of a file's menu (card, list row, ⋮ button): *Rename…, Move…, Cut, Copy, Duplicate, Download, Copy link,
   * favorite, Release…, Delete…*; inside a selection of several the selection's actions with the count. A read-only project
   * keeps what only reads.
   */
  fileMenu(file: SampleMediaFile): SfMenuItem[] {
    if (this.multiFor('file', file.id)) {
      return this.selectionMenu();
    }
    const writable = this.state.canEdit();
    return [
      ...(writable
        ? [
            { id: 'rename', label: this.t('menu.rename'), icon: 'edit', shortcut: 'F2', action: () => void this.state.renameFile(file) },
            { id: 'move', label: this.t('menu.move'), icon: 'drive_file_move', action: () => void this.state.moveFiles([file]) },
            { id: 'cut', label: this.t('menu.cut'), icon: 'content_cut', separatorBefore: true, shortcut: 'Mod+X', action: () => this.cutFiles([file]) },
            { id: 'copy', label: this.t('menu.copy'), icon: 'content_copy', shortcut: 'Mod+C', action: () => this.copyFiles([file]) },
            { id: 'duplicate', label: this.t('menu.duplicate'), icon: 'file_copy', action: () => this.duplicate([file]) },
          ]
        : []),
      { id: 'download', label: this.t('menu.download'), icon: 'download', action: () => this.state.download([file]) },
      { id: 'copyLink', label: this.t('menu.copyLink'), icon: 'link', action: () => this.state.copyLink(file) },
      this.favoriteItem(file.id, file.name),
      ...(this.canRelease() ? [{ id: 'release', label: this.t('menu.release'), icon: 'publish', action: () => this.release([file], []) }] : []),
      ...(writable
        ? [{ id: 'delete', label: this.t('menu.delete'), icon: 'delete', danger: true, separatorBefore: true, shortcut: 'Delete', action: () => void this.state.confirmDelete([file]) }]
        : []),
    ];
  }

  /**
   * The entries of a folder tile's menu (card, list row, ⋮ button) — the same as the folder tree's: *New folder, Rename folder…,
   * Cut, Paste, Move to…, Upload, favorite, Release…, Delete folder…* (Paste is disabled while nothing on the clipboard fits).
   * Inside a selection of several: the selection's actions.
   */
  folderMenu(folder: SampleMediaFolder): SfMenuItem[] {
    if (this.multiFor('folder', folder.id)) {
      return this.selectionMenu();
    }
    const writable = this.state.canEdit();
    const section = (items: SfMenuItem[]): SfMenuItem[] => items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item));
    const items: SfMenuItem[] = [
      ...(writable
        ? [
            { id: 'create', label: this.t('folders.new'), icon: 'create_new_folder', action: () => this.createFolderIn(folder.id) },
            { id: 'rename', label: this.t('library.rename'), icon: 'edit', shortcut: 'F2', action: () => void this.state.renameFolder(folder) },
            ...section([
              { id: 'cut', label: this.t('menu.cut'), icon: 'content_cut', shortcut: 'Mod+X', action: () => this.cutFolder(folder) },
              { id: 'paste', label: this.t('menu.paste'), icon: 'content_paste', shortcut: 'Mod+V', disabled: !this.canPaste(folder), action: () => this.paste(folder) },
              { id: 'move', label: this.t('menu.moveTo'), icon: 'drive_file_move', action: () => void this.state.moveFolder(folder) },
            ]),
          ]
        : []),
      ...section([
        ...(this.state.canEdit() ? [{ id: 'upload', label: this.t('toolbar.upload'), icon: 'upload', action: () => this.state.pickFiles(folder.id) }] : []),
        this.favoriteItem(folder.id, folder.name),
        ...(this.canRelease() ? [{ id: 'release', label: this.t('menu.release'), icon: 'publish', action: () => this.release([], [folder]) }] : []),
      ]),
      ...(writable
        ? [{ id: 'delete', label: this.t('library.delete'), icon: 'delete', danger: true, separatorBefore: true, shortcut: 'Delete', action: () => this.deleteFolder() }]
        : []),
    ];
    // Nothing above the first entry to separate it from.
    return items.map((item, index) => (index === 0 ? { ...item, separatorBefore: false } : item));
  }

  /**
   * The menu of a right click on empty space of the open folder: *Upload*, *New folder*, *Paste* (disabled while no file is
   * on the clipboard) — nothing that changes the folder itself. A read-only project has none.
   */
  emptyMenu(): ContextMenuItem[] {
    if (!this.state.canEdit()) {
      return [];
    }
    const open = this.state.folderId();
    return [
      { label: this.t('toolbar.upload'), icon: 'upload', action: () => this.state.pickFiles() },
      { label: this.t('folders.new'), icon: 'create_new_folder', action: () => this.createFolderIn(open) },
      { label: this.t('menu.paste'), icon: 'content_paste', disabled: !this.canPasteFiles(open), action: () => this.pasteFiles(open) },
    ];
  }

  /**
   * The host entries of the folder tree's menu (after its own *New folder, Rename, Cut, Paste, Move to…*): *Paste N files*
   * for files on the clipboard, *Upload*, the favorite and *Release…*.
   */
  treeMenu(nodes: readonly SfTreeNode<SampleMediaFolder>[]): ContextMenuItem[] {
    const node = nodes.length === 1 ? nodes[0] : null;
    if (!node?.data) {
      return [];
    }
    const folder = node.data;
    const on = this.favorites().has(folder.id);
    return [
      ...this.pasteFilesItems(folder.id),
      ...(this.state.canEdit() ? [{ label: this.t('toolbar.upload'), icon: 'upload', action: () => this.state.pickFiles(folder.id) }] : []),
      { label: this.t(on ? 'menu.favoriteRemove' : 'menu.favoriteAdd', { name: folder.name }), icon: 'star', action: () => this.toggleFavorite(folder.id, folder.name) },
      ...(this.canRelease() ? [{ label: this.t('menu.release'), icon: 'publish', action: () => this.release([], [folder]) }] : []),
    ];
  }

  /** A right click on empty space of the tree acts as one on the top level: *Paste N files*, *Upload* and *New folder*. */
  treeRootMenu(newFolder: () => void): ContextMenuItem[] {
    return [
      ...this.pasteFilesItems(null),
      ...(this.state.canEdit()
        ? [
            { label: this.t('toolbar.upload'), icon: 'upload', action: () => this.pickAtTopLevel() },
            { label: this.t('folders.new'), icon: 'create_new_folder', action: newFolder },
          ]
        : []),
    ];
  }

  private pasteFilesItems(target: string | null): ContextMenuItem[] {
    const clip = this.clipboardFiles();
    return clip && this.state.canEdit()
      ? [{ label: this.t('menu.pasteMany', { count: clip.nodes.length }), icon: 'content_paste', disabled: !this.canPasteFiles(target), action: () => this.pasteFiles(target) }]
      : [];
  }

  private favoriteItem(id: string, name: string): SfMenuItem {
    const on = this.favorites().has(id);
    return { id: 'favorite', label: this.t(on ? 'menu.favoriteRemove' : 'menu.favoriteAdd', { name }), icon: 'star', action: () => this.toggleFavorite(id, name) };
  }

  /** The file's context menu: at the pointer for a right click, below the element for Shift+F10 and the ⋮ button. */
  openFileMenu(target: ContextMenuTarget, file: SampleMediaFile): void {
    this.contextMenu.open(target, toContextItems(this.fileMenu(file)));
  }

  openFolderMenu(target: ContextMenuTarget, folder: SampleMediaFolder): void {
    this.contextMenu.open(target, toContextItems(this.folderMenu(folder)));
  }

  /** A right click on empty space opens the open folder's menu (the selection stays). */
  openEmptyMenu(event: MouseEvent): void {
    const items = this.emptyMenu();
    if (items.length) {
      event.preventDefault();
      this.contextMenu.open(event, items);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /** Delete on a card or row: the selection when the file is part of a selection of several, else the file itself. */
  async deleteFile(file: SampleMediaFile): Promise<void> {
    if (this.multiFor('file', file.id)) {
      await this.deleteSelection();
    } else {
      await this.state.confirmDelete([file]);
    }
  }

  /** Delete on a folder tile or row. The sample keeps its folders: it says so. */
  deleteFolder(): void {
    this.state.notice('media.library.deleteNotice');
  }

  async deleteFromTile(folder: SampleMediaFolder): Promise<void> {
    if (this.multiFor('folder', folder.id)) {
      await this.deleteSelection();
    } else {
      this.deleteFolder();
    }
  }

  /** Files alone are deleted (25 or more need the word typed); with folders in the selection the sample says it keeps them. */
  async deleteSelection(): Promise<void> {
    if (this.state.selectedFolders().length > 0) {
      this.deleteFolder();
      return;
    }
    await this.state.confirmDelete(this.state.selectedFiles());
  }

  // ── Release and favorites (announced) ──────────────────────────────────────

  /** Releasing is part of the app, not of the sample: *Release…* is shown and enabled, and says what it would release. */
  canRelease(): boolean {
    return this.state.canEdit();
  }

  /** The files (and, for a folder, everything below it) that are waiting to be released. */
  release(files: readonly SampleMediaFile[], folders: readonly SampleMediaFolder[]): void {
    const folderIds = new Set(folders.flatMap((f) => [f.id, ...mediaFolderDescendants(f.id)]));
    const pending = new Map<string, SampleMediaFile>();
    for (const file of this.state.files()) {
      if (file.status !== 'released' && (folderIds.has(file.folderId) || files.some((f) => f.id === file.id))) {
        pending.set(file.id, file);
      }
    }
    if (pending.size === 0) {
      this.toasts.show(this.t('release.nothing'), 'info');
    } else {
      this.toasts.show(this.t('release.announce', { count: pending.size }), 'info');
    }
  }

  toggleFavorite(id: string, name: string): void {
    const on = !this.favorites().has(id);
    this.favorites.update((set) => {
      const next = new Set(set);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    this.toasts.show(this.t(on ? 'favorite.added' : 'favorite.removed', { name }), 'info');
  }

  // ── Cut, copy, duplicate and paste (the shared clipboard) ──────────────────

  private fileNodes(files: readonly SampleMediaFile[]) {
    return files.map((file) => ({ id: file.id, label: file.name, icon: 'description', data: { folderId: file.folderId } }));
  }

  /** *Cut*: the files go on the clipboard to be moved by *Paste* onto a folder. */
  cutFiles(files: readonly SampleMediaFile[]): void {
    if (files.length > 0 && this.state.canEdit()) {
      this.clipboard.cutNodes(FILE_SCOPE, this.fileNodes(files));
    }
  }

  /** *Copy*: the files go on the clipboard to be duplicated into the folder *Paste* is used on. */
  copyFiles(files: readonly SampleMediaFile[]): void {
    if (files.length > 0 && this.state.canEdit()) {
      this.clipboard.copyNodes(FILE_SCOPE, this.fileNodes(files));
    }
  }

  /** *Cut* on a folder tile: the folder goes on the tree's clipboard, to be pasted onto a folder (here or in the tree). */
  cutFolder(folder: SampleMediaFolder): void {
    if (this.state.canEdit()) {
      this.clipboard.cutNodes(MEDIA_TREE_SCOPE, [{ id: folder.id, label: folder.name, icon: 'folder', droppable: true, data: folder }]);
    }
  }

  /** The files on the clipboard (`null`: none, or something else is there). */
  clipboardFiles() {
    const clip = this.clipboard.nodes();
    return clip && clip.scope === FILE_SCOPE && clip.nodes.length > 0 ? clip : null;
  }

  /** Whether *Paste* has files for the folder `target`: cut files are not pasted where they already are. */
  canPasteFiles(target: string | null): boolean {
    const clip = this.clipboardFiles();
    if (!clip || !this.state.canEdit()) {
      return false;
    }
    return clip.mode === 'copy' || clip.nodes.some((node) => (node.data as { folderId?: string } | undefined)?.folderId !== target);
  }

  /** The folders cut in the tree or on a tile that may go into `target`: not into themselves or what is inside them. */
  private pastableFolders(target: SampleMediaFolder): string[] {
    const clip = this.clipboard.nodes();
    if (!clip || clip.mode !== 'cut' || clip.scope !== MEDIA_TREE_SCOPE) {
      return [];
    }
    const ids = clip.nodes.map((node) => node.id);
    return ids.some((id) => id === target.id || mediaFolderDescendants(id).includes(target.id)) ? [] : ids;
  }

  canPaste(target: SampleMediaFolder): boolean {
    return this.state.canEdit() && (this.pastableFolders(target).length > 0 || this.canPasteFiles(target.id));
  }

  /** *Paste* onto a folder tile: cut or copied files move or are copied into it, cut folders move into it (announced). */
  paste(target: SampleMediaFolder): void {
    if (this.clipboardFiles()) {
      this.pasteFiles(target.id);
      return;
    }
    const ids = this.pastableFolders(target);
    if (ids.length > 0) {
      this.clipboard.clear();
      const first = mediaFolder(ids[0])?.name ?? '';
      this.toasts.undo(this.t('move.folderDone', { name: first, folder: target.name }), () => this.toasts.show(this.t('move.undone'), 'info'));
    }
  }

  /** *Paste* of files onto a folder (`null`: the top level): cut files move into it, copied files are duplicated into it. */
  pasteFiles(target: string | null): void {
    const clip = this.clipboardFiles();
    if (!clip || !this.canPasteFiles(target)) {
      return;
    }
    const ids = clip.nodes.map((node) => node.id);
    if (clip.mode === 'cut') {
      this.clipboard.clear();
      if (target === null) {
        const name = clip.nodes[0].label;
        this.toasts.undo(this.t('move.rootDone', { count: ids.length, name }), () => this.toasts.show(this.t('move.undone'), 'info'));
      } else {
        this.state.applyMove(ids, target);
      }
      return;
    }
    this.copyInto(
      this.state.files().filter((f) => ids.includes(f.id)),
      target ?? this.state.folderId(),
    );
  }

  /** *Duplicate*: a copy of each file next to it ("name-2", an unreleased draft), with Undo. */
  duplicate(files: readonly SampleMediaFile[]): void {
    if (this.state.canEdit()) {
      this.copyInto(files, undefined);
    }
  }

  /** Copies the files into the folder `target` (`undefined`: each stays in its folder) and offers one Undo that removes the copies. */
  private copyInto(files: readonly SampleMediaFile[], target: string | undefined): void {
    if (files.length === 0) {
      return;
    }
    const copies: SampleMediaFile[] = [];
    for (const file of files) {
      const folderId = target ?? file.folderId;
      const taken = new Set([...this.state.files(), ...copies].filter((f) => f.folderId === folderId).map((f) => f.name.toLowerCase()));
      const n = this.nextCopy++;
      copies.push({ ...file, id: `${file.id}-copy-${n}`, uid: `${file.uid}_copy_${n}`, name: copyName(file.name, taken), folderId, status: 'draft', usages: [] });
    }
    this.state.files.update((list) => [...list, ...copies]);
    const folder = mediaFolder(copies[0].folderId)?.name ?? '';
    const message = this.t(target === undefined ? 'copy.duplicated' : 'copy.pasted', { count: copies.length, name: files[0].name, folder });
    this.toasts.undo(message, () => {
      this.state.remove(copies.map((c) => c.id));
      this.toasts.show(this.t('copy.undone'), 'info');
    });
  }

  // ── Folders and the top level ──────────────────────────────────────────────

  /** Starts an inline *New folder* in the tree, inside `parent` (`null`: at the top level). */
  createFolderIn(parent: string | null): void {
    this.state.folderRequestParent.set(parent);
    this.state.folderRequest.set('create');
  }

  /** The sample has no files at the top level: *Upload* there goes into the open folder, and says so. */
  private pickAtTopLevel(): void {
    this.toasts.show(this.t('upload.topLevel', { folder: this.state.folderName() }), 'info');
    this.state.pickFiles();
  }
}
