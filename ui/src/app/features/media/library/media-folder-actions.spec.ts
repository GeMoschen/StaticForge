import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { MediaFolderActions } from './media-folder-actions';
import { MediaReleaseActions } from './media-release.actions';
import { MediaSelectionActions } from './media-selection.actions';
import { FavoritesService } from '../../../core/assets/favorites.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { MediaItemActions } from './media-item-actions';
import { MediaMover } from './media-mover';
import { MediaUploadStore } from './media-upload.store';
import { MediaLibraryStore } from './media-library.store';
import { MEDIA_TREE, productFiles, projectStub } from './media-library.testing';

const PRODUCTS = MEDIA_TREE[0].children![1];
const TEAM = MEDIA_TREE[0].children![2];

function setup(options: { readOnly?: boolean; renamed?: string } = {}) {
  const api = {
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'new-folder' })),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    restoreFolder: vi.fn().mockReturnValue(of({})),
    renameFolder: vi.fn().mockReturnValue(of({ revision: 8 })),
    duplicateAsset: vi.fn().mockReturnValue(of({ uuid: 'copy-uuid' })),
  };
  const confirm = { confirm: vi.fn().mockResolvedValue(true) };
  const mover = { moveTo: vi.fn().mockResolvedValue(undefined), moveFolders: vi.fn(), moveSelection: vi.fn() };
  const dialogs = { open: vi.fn().mockReturnValue({ result: Promise.resolve(options.renamed) }) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      MediaLibraryStore,
      MediaFolderActions,
      MediaItemActions,
      MediaReleaseActions,
      MediaSelectionActions,
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: projectStub() },
      { provide: ConfirmService, useValue: confirm },
      { provide: MediaMover, useValue: mover },
      { provide: MediaUploadStore, useValue: { canUpload: () => true, pickFiles: vi.fn() } },
      { provide: FavoritesService, useValue: { isFavorite: () => false, toggle: vi.fn() } },
      { provide: DialogService, useValue: dialogs },
      { provide: ProjectPermissionsStore, useValue: { canEditContent: signal(true), canRelease: signal(true) } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
    ],
  });
  const library = TestBed.inject(MediaLibraryStore);
  library.connect(signal('proj'));
  Object.defineProperty(library, 'readOnly', { value: signal(options.readOnly ?? false) });
  library.reloadFolders = vi.fn();
  library.openFolder = vi.fn();
  return { actions: TestBed.inject(MediaFolderActions), library, api, confirm, mover, dialogs, toasts: TestBed.inject(ToastService) };
}

describe('MediaFolderActions', () => {
  beforeEach(() => vi.useRealTimers());

  describe('creating a folder', () => {
    it('creates a folder in the media store under the given parent and re-reads the folders', () => {
      const { actions, api, library, toasts } = setup();

      actions.createFolder('team-uuid', 'Interns').subscribe();

      expect(api.createFolder).toHaveBeenCalledWith('proj', { displayName: 'Interns', parentFolderUuid: 'team-uuid', scope: 'MEDIA' });
      expect(library.reloadFolders).toHaveBeenCalled();
      expect(toasts.toasts().at(-1)).toMatchObject({ message: 'Folder “Interns” created.', kind: 'success' });
    });

    it('says why when it fails', () => {
      const { actions, api, toasts } = setup();
      api.createFolder.mockReturnValue(throwError(() => new Error('409')));

      actions.createFolder(undefined, 'Archive').subscribe({ error: () => undefined });

      expect(toasts.toasts().at(-1)).toMatchObject({ kind: 'error' });
      expect(toasts.toasts().at(-1)?.message).toMatch(/already exist/);
    });

    it('asks the tree for an inline create under the open folder, or at the top level', () => {
      const { actions, library } = setup();
      library.applyRoute({ folder: 'team-uuid' });

      actions.startCreate();
      expect(actions.treeRequest()).toEqual({ kind: 'create', uuid: 'team-uuid' });

      actions.startCreate(null);
      expect(actions.treeRequest()).toEqual({ kind: 'create', uuid: null });
    });

    it('does nothing in a read-only project', () => {
      const { actions } = setup({ readOnly: true });

      actions.startCreate();
      actions.startRename();

      expect(actions.treeRequest()).toBeNull();
    });
  });

  describe('renaming', () => {
    it('asks the tree for an inline rename of the open folder', () => {
      const { actions, library } = setup();
      library.applyRoute({ folder: 'team-uuid' });

      actions.startRename();

      expect(actions.treeRequest()).toEqual({ kind: 'rename', uuid: 'team-uuid' });
    });

    it('has no folder to rename at the library root', () => {
      const { actions } = setup();

      actions.startRename();

      expect(actions.treeRequest()).toBeNull();
    });
  });

  describe('the Rename dialog', () => {
    it('asks with the sibling folders names and the folders UID, renames with Undo and re-reads the folders', async () => {
      const { actions, api, dialogs, library, toasts } = setup({ renamed: 'Goods' });

      await actions.rename(PRODUCTS);

      const data = dialogs.open.mock.calls[0][1];
      expect(data).toMatchObject({ kind: 'folder', name: 'Products', uid: { projectKey: 'proj', uuid: 'products-uuid', uid: 'products' } });
      expect(data.taken).toEqual(['archive', 'team']);
      expect(api.renameFolder).toHaveBeenCalledWith('proj', 'products-uuid', { displayName: 'Goods' }, 2);
      expect(library.reloadFolders).toHaveBeenCalled();
      expect(toasts.toasts().at(-1)?.message).toBe('Renamed “Products” to “Goods”.');
      expect(toasts.toasts().at(-1)?.action).toBeDefined();
    });

    it('re-reads the folders when the UID changed and when Undo changed it back', async () => {
      const { actions, dialogs, library } = setup({ renamed: undefined });

      await actions.rename(TEAM);
      const { uid } = dialogs.open.mock.calls[0][1];
      uid.changed('crew');
      uid.undone('team');

      expect(library.reloadFolders).toHaveBeenCalledTimes(2);
    });

    it('changes nothing when the dialog is dismissed', async () => {
      const { actions, api } = setup({ renamed: undefined });

      await actions.rename(TEAM);

      expect(api.renameFolder).not.toHaveBeenCalled();
    });

    it('does not even ask in a read-only project', async () => {
      const { actions, dialogs } = setup({ readOnly: true, renamed: 'x' });

      await actions.rename(TEAM);

      expect(dialogs.open).not.toHaveBeenCalled();
    });

    it('says so and re-reads when the server refuses the name', async () => {
      const { actions, api, library, toasts } = setup({ renamed: 'Goods' });
      api.renameFolder.mockReturnValue(throwError(() => new Error('409')));

      await actions.rename(PRODUCTS);

      expect(toasts.toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Could not rename “Products” — try again in a moment.' });
      expect(library.reloadFolders).toHaveBeenCalled();
    });
  });

  describe('the folder menu of a tile or row', () => {
    it('has the tree\'s entries, Release… and no Open', () => {
      const { actions } = setup();

      const items = actions.menuItems(PRODUCTS);

      expect(items.map((item) => item.id)).toEqual(['create', 'rename', 'cut', 'paste', 'move', 'upload', 'favorite', 'release', 'delete']);
      expect(items.find((item) => item.id === 'paste')?.disabled).toBe(true);
      expect(items.at(-1)).toMatchObject({ danger: true, separatorBefore: true });
    });

    it('keeps Upload, the favorite and Release… for a read-only project that may release', () => {
      const { actions } = setup({ readOnly: true });

      expect(actions.menuItems(PRODUCTS).map((item) => item.id)).toEqual(['upload', 'favorite']);
    });

    it('cuts a folder and pastes it onto another, but not into itself or what lies inside it', () => {
      const { actions, mover } = setup();
      const clipboard = TestBed.inject(TreeClipboardService);

      actions.cut(PRODUCTS);
      expect(actions.canPaste(PRODUCTS)).toBe(false);
      expect(actions.canPaste(PRODUCTS.children![0])).toBe(false);
      expect(actions.canPaste(TEAM)).toBe(true);

      void actions.paste(TEAM);

      expect(mover.moveTo).toHaveBeenCalledWith(['products-uuid'], 'team-uuid', 'folder');
      expect(clipboard.nodes()).toBeNull();
    });
    it('pastes cut and copied files onto a folder (tile menu) and into the open folder (empty-space menu)', async () => {
      const { actions, mover, api, library } = setup();
      library.items.set(productFiles());
      library.allMedia.set(productFiles());
      library.reloadMedia = vi.fn();
      const items = TestBed.inject(MediaItemActions);

      items.cutFiles([productFiles()[0]]);
      expect(actions.canPaste(TEAM)).toBe(true);
      await actions.paste(TEAM);
      expect(mover.moveTo).toHaveBeenCalledWith([productFiles()[0].uuid], 'team-uuid', 'file');

      items.copyFiles([productFiles()[1]]);
      const paste = actions.openFolderMenuItems().find((item) => item.label === 'Paste');
      expect(paste?.disabled).toBe(false);
      await actions.paste(TEAM);
      expect(api.duplicateAsset).toHaveBeenCalledWith('proj', productFiles()[1].uuid, 'team-uuid');
    });
  });

  describe('a selection of folders and files', () => {
    it('offers Move, Release… and Delete for the items, and a menu on a selected folder acts on all of them', () => {
      const { actions, library, mover } = setup();
      library.items.set(productFiles());
      library.setSelection(['uuid-latte-art-jpg']);
      library.setFolderSelection(['team-uuid', 'archive-uuid']);

      const labels = actions.menuItems(TEAM).map((item) => item.label);

      expect(labels).toEqual([
        'Move 3 items…',
        'Copy 1 file',
        'Duplicate 1 file',
        'Download',
        'Release 3 items…',
        'Delete 3 items…',
      ]);
      void actions.menuItems(TEAM)[0].action!();
      expect(mover.moveSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe('releasing', () => {
    it('releases a folder with everything inside it, all ticked', () => {
      const { library } = setup();
      const releases = TestBed.inject(MediaReleaseActions);
      library.allMedia.set([
        ...productFiles(),
        { ...productFiles()[1], uuid: 'deep', displayName: 'deep.jpg', folderPath: '/media_root/products/roastery/' },
      ]);

      releases.release([], [PRODUCTS]);

      const choices = releases.choices();
      expect(choices?.map((choice) => choice.assetUuid).sort()).toEqual(['deep', 'uuid-latte-art-jpg']);
      expect(choices?.every((choice) => choice.checked)).toBe(true);
    });

    it('says so when nothing is waiting to be released', () => {
      const { toasts } = setup();
      const releases = TestBed.inject(MediaReleaseActions);

      releases.release([productFiles()[0]], []);

      expect(releases.choices()).toBeNull();
      expect(toasts.toasts().at(-1)?.message).toBe('Nothing here is waiting to be released.');
    });
  });

  describe('deleting a folder', () => {
    it('goes back to the library root when the open folder is inside the deleted one', async () => {
      const { actions, library } = setup();
      library.applyRoute({ folder: 'roastery-uuid' });

      await actions.deleteFolder(PRODUCTS);

      expect(library.openFolder).toHaveBeenCalledWith(null);
    });

    it('stays where it is when the open folder is elsewhere', async () => {
      const { actions, library } = setup();
      library.applyRoute({ folder: 'archive-uuid' });

      await actions.deleteFolder(TEAM);

      expect(library.openFolder).not.toHaveBeenCalled();
    });

    it('notes that published folders stay online until the deletion is released', async () => {
      const { actions, confirm } = setup();

      await actions.deleteFolder({ ...TEAM, release: { '': { status: 'PUBLISHED', releasedRevision: 1 } } });

      expect(confirm.confirm.mock.calls[0][0].message).toBe('It stays online until you release the deletion.');
    });

    it('asks for the word delete when the folder holds 25 items or more', async () => {
      const { actions, library, confirm } = setup();
      library.allMedia.set(Array.from({ length: 24 }, (_, i) => ({ ...productFiles()[0], uuid: `f${i}` })));

      await actions.deleteFolder(PRODUCTS);

      expect(confirm.confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
    });

    it('says so when the server refuses, and does not offer Undo', async () => {
      const { actions, api, toasts } = setup();
      api.deleteFolder.mockReturnValue(throwError(() => new Error('403')));

      expect(await actions.deleteFolder(TEAM)).toBe(false);

      expect(toasts.toasts().at(-1)).toMatchObject({ kind: 'error', message: 'Could not delete the folder — try again in a moment.' });
      expect(toasts.toasts().at(-1)?.action).toBeUndefined();
    });
  });
});
