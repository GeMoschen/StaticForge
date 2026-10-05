import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { FavoritesService } from '../../../core/assets/favorites.service';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { ContextMenuService } from '../../../shared/services/context-menu.service';
import { MediaItemActions } from './media-item-actions';
import { MediaReleaseActions } from './media-release.actions';
import { MediaSelectionActions } from './media-selection.actions';
import { MediaLibraryStore } from './media-library.store';
import { productFiles, projectStub } from './media-library.testing';
import { MediaMover } from './media-mover';

const [YIRGACHEFFE, LATTE, LOGO] = productFiles();

function setup(options: { readOnly?: boolean; viewer?: boolean; renamed?: string; favorite?: boolean } = {}) {
  const api = {
    renameAsset: vi.fn().mockReturnValue(of({ revision: 8 })),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    duplicateAsset: vi.fn().mockImplementation((_key: string, uuid: string) => of({ uuid: `copy-of-${uuid}` })),
    mediaBinaryBlob: vi.fn().mockReturnValue(of(new Blob(['x']))),
    downloadMediaZip: vi.fn().mockReturnValue(of(new Blob(['zip']))),
  };
  const dialogs = { open: vi.fn().mockReturnValue({ result: Promise.resolve(options.renamed) }) };
  const confirm = { confirm: vi.fn().mockResolvedValue(true) };
  const favorites = { isFavorite: vi.fn().mockReturnValue(options.favorite ?? false), toggle: vi.fn().mockReturnValue(true), list: signal([]) };
  const mover = { moveFiles: vi.fn().mockResolvedValue(undefined), moveTo: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      MediaLibraryStore,
      MediaItemActions,
      MediaReleaseActions,
      MediaSelectionActions,
      { provide: ApiClient, useValue: api },
      { provide: DialogService, useValue: dialogs },
      { provide: ConfirmService, useValue: confirm },
      { provide: FavoritesService, useValue: favorites },
      { provide: MediaMover, useValue: mover },
      { provide: ProjectPermissionsStore, useValue: { canEditContent: signal(!options.viewer), canRelease: signal(!options.viewer) } },
      { provide: ProjectContextStore, useValue: projectStub() },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
    ],
  });
  const library = TestBed.inject(MediaLibraryStore);
  library.connect(signal('proj'));
  Object.defineProperty(library, 'readOnly', { value: signal(options.readOnly ?? false) });
  library.reloadMedia = vi.fn();
  library.applyRoute({ folder: 'products-uuid' });
  library.items.set(productFiles());
  library.allMedia.set(productFiles());
  const toasts = TestBed.inject(ToastService);
  return { actions: TestBed.inject(MediaItemActions), library, api, dialogs, confirm, favorites, mover, toasts, last: () => toasts.toasts().at(-1)! };
}

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe('MediaItemActions', () => {
  let saved: { blob: Blob; name: string }[];

  beforeEach(() => {
    saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ blob: new Blob(), name: this.download });
    });
  });

  describe('the file menu (decision 92)', () => {
    it('is Rename…, Move…, Download, Copy link, the favorite entry and Delete… after a separator', () => {
      const { actions } = setup();

      const items = actions.menuItems(YIRGACHEFFE);

      expect(items.map((item) => item.id)).toEqual(['rename', 'move', 'cut', 'copy', 'duplicate', 'download', 'copyLink', 'favorite', 'release', 'delete']);
      expect(labels(items)).toEqual([
        'Rename…',
        'Move…',
        'Cut',
        'Copy',
        'Duplicate',
        'Download',
        'Copy link',
        'Add “yirgacheffe.jpg” to favorites',
        'Release…',
        'Delete…',
      ]);
      const remove = items.at(-1)!;
      expect(remove).toMatchObject({ danger: true, separatorBefore: true, shortcut: 'Delete' });
      expect(items.find((item) => item.id === 'rename')?.shortcut).toBe('F2');
      expect(items.find((item) => item.id === 'open')).toBeUndefined();
    });

    it('offers Remove from favorites for a favorite', () => {
      const { actions } = setup({ favorite: true });

      expect(labels(actions.menuItems(YIRGACHEFFE))).toContain('Remove “yirgacheffe.jpg” from favorites');
    });

    it('acts on the selection when the file is part of a multi-file selection', () => {
      const { actions, library } = setup();
      library.setSelection([YIRGACHEFFE.uuid!, LATTE.uuid!]);

      expect(labels(actions.menuItems(LATTE))).toEqual([
        'Move 2 files…',
        'Cut 2 files',
        'Copy 2 files',
        'Duplicate 2 files',
        'Download 2 files as ZIP',
        'Release 2 items…',
        'Delete 2 files…',
      ]);
      // In the order the library shows them (by name).
      expect(actions.menuTargets(LATTE).map((file) => file.uuid)).toEqual([LATTE.uuid, YIRGACHEFFE.uuid]);
    });

    it('acts on the file alone when it is not in the selection, or the selection is one file', () => {
      const { actions, library } = setup();
      library.setSelection([YIRGACHEFFE.uuid!, LATTE.uuid!]);
      expect(actions.menuTargets(LOGO).map((file) => file.uuid)).toEqual([LOGO.uuid]);

      library.setSelection([LATTE.uuid!]);
      expect(actions.menuItems(LATTE).map((item) => item.id)).toContain('release');
    });

    it.each([
      ['a read-only project', { readOnly: true }],
      ['a viewer', { viewer: true }],
    ])('keeps only what reads for %s', (_who, options) => {
      const { actions, library } = setup(options);

      expect(actions.menuItems(YIRGACHEFFE).map((item) => item.id)).toEqual(['download', 'copyLink', 'favorite']);

      library.setSelection([YIRGACHEFFE.uuid!, LATTE.uuid!]);
      expect(labels(actions.menuItems(LATTE))).toEqual(['Download 2 files as ZIP']);
    });

    it('opens as a context menu with the same entries and a separator before Delete…', () => {
      const { actions } = setup();
      const element = document.createElement('div');
      document.body.append(element);

      actions.onItemContextMenu(YIRGACHEFFE, element);

      const state = TestBed.inject(ContextMenuService).state();
      expect(state?.items.map((item) => item.label)).toContain('Delete…');
      expect(state?.items.at(-1)).toMatchObject({ label: 'Delete…', danger: true, separatorBefore: true });
      element.remove();
    });

    it('runs the entries: Release… opens the dialog, Move… asks the mover, Copy link copies the library link', async () => {
      const { actions, library, mover, last } = setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const items = actions.menuItems(LATTE);

      items.find((item) => item.id === 'release')!.action!();
      items.find((item) => item.id === 'move')!.action!();
      items.find((item) => item.id === 'copyLink')!.action!();

      expect(TestBed.inject(MediaReleaseActions).choices()?.map((choice) => choice.assetUuid)).toEqual([LATTE.uuid]);
      expect(mover.moveFiles).toHaveBeenCalledWith([LATTE]);
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/proj/media?asset=${LATTE.uuid}`));
      await vi.waitFor(() => expect(last().message).toBe('Link copied.'));
    });
  });

  describe('duplicate, copy and paste', () => {
    it('duplicates the files in place, reloads and offers one Undo that deletes the copies', async () => {
      const { actions, api, library, last } = setup();

      await actions.duplicate([YIRGACHEFFE, LATTE]);

      expect(api.duplicateAsset).toHaveBeenCalledWith('proj', YIRGACHEFFE.uuid, undefined);
      expect(api.duplicateAsset).toHaveBeenCalledWith('proj', LATTE.uuid, undefined);
      expect(library.reloadMedia).toHaveBeenCalledTimes(1);
      expect(last().message).toBe('Duplicated 2 files');
      last().action!.run();
      await vi.waitFor(() => expect(api.deleteAsset).toHaveBeenCalledTimes(2));
      expect(api.deleteAsset).toHaveBeenCalledWith('proj', `copy-of-${YIRGACHEFFE.uuid}`);
    });

    it('copies onto the clipboard and pastes a copy into a folder, keeping the clipboard', async () => {
      const { actions, api, last } = setup();

      actions.copyFiles([YIRGACHEFFE]);
      expect(actions.canPasteFiles('team-uuid')).toBe(true);
      expect(actions.canPasteFiles('products-uuid')).toBe(true);
      await actions.pasteFiles('team-uuid');

      expect(api.duplicateAsset).toHaveBeenCalledWith('proj', YIRGACHEFFE.uuid, 'team-uuid');
      expect(last().message).toContain('Copied “yirgacheffe.jpg” to Team');
      expect(actions.clipboardFiles()).not.toBeNull();
    });

    it('cuts files and moves them on paste, but not into the folder they are in', async () => {
      const { actions, mover } = setup();

      actions.cutFiles([YIRGACHEFFE, LATTE]);
      expect(actions.canPasteFiles('products-uuid')).toBe(false);
      expect(actions.canPasteFiles('team-uuid')).toBe(true);
      await actions.pasteFiles('team-uuid');

      expect(mover.moveTo).toHaveBeenCalledWith([YIRGACHEFFE.uuid, LATTE.uuid], 'team-uuid', 'file');
      expect(actions.clipboardFiles()).toBeNull();
    });

    it('cannot paste an empty clipboard', async () => {
      const { actions, api } = setup();

      expect(actions.canPasteFiles(null)).toBe(false);
      await actions.pasteFiles(null);
      expect(api.duplicateAsset).not.toHaveBeenCalled();
    });

    it('puts nothing on the clipboard in a read-only project', () => {
      const { actions } = setup({ readOnly: true });

      actions.copyFiles([YIRGACHEFFE]);

      expect(actions.clipboardFiles()).toBeNull();
    });

    it('counts a refused copy and still offers Undo for the others', async () => {
      const { actions, api, toasts } = setup();
      api.duplicateAsset.mockReturnValueOnce(throwError(() => new Error('422')));

      await actions.duplicate([YIRGACHEFFE, LATTE]);

      expect(toasts.toasts().map((toast) => toast.message)).toContain('Could not copy 1 of 2 files.');
      expect(toasts.toasts().at(-1)?.message).toBe('Duplicated “latte-art.jpg”');
    });
  });

  describe('rename (decision 93)', () => {
    it('asks with the other names of the folder, renames and offers Undo', async () => {
      const { actions, api, dialogs, last, library } = setup({ renamed: 'cover.jpg' });

      await actions.rename(YIRGACHEFFE);

      const data = dialogs.open.mock.calls[0][1];
      expect(data).toMatchObject({ name: 'yirgacheffe.jpg', folder: 'Products' });
      expect(data.taken).not.toContain('yirgacheffe.jpg');
      expect(data.taken).toContain('latte-art.jpg');
      expect(api.renameAsset).toHaveBeenCalledWith('proj', YIRGACHEFFE.uuid, { displayName: 'cover.jpg' }, 3);
      expect(last().message).toBe('Renamed “yirgacheffe.jpg” to “cover.jpg”.');
      // The grid shows the new name at once, with the revision the rename produced.
      expect(library.items().find((file) => file.uuid === YIRGACHEFFE.uuid)).toMatchObject({ displayName: 'cover.jpg', revision: 8 });

      last().action!.run();
      await vi.waitFor(() =>
        expect(api.renameAsset).toHaveBeenLastCalledWith('proj', YIRGACHEFFE.uuid, { displayName: 'yirgacheffe.jpg' }, 8),
      );
    });

    it('passes what the dialog needs to change the UID; a changed UID (and Undo after the dialog) reaches the library', async () => {
      const { actions, dialogs, library } = setup({ renamed: undefined });

      await actions.rename(YIRGACHEFFE);

      const { uid } = dialogs.open.mock.calls[0][1];
      expect(uid).toMatchObject({ projectKey: 'proj', uuid: YIRGACHEFFE.uuid, uid: YIRGACHEFFE.uid });
      uid.changed('cover_photo');
      expect(library.items().find((file) => file.uuid === YIRGACHEFFE.uuid)?.uid).toBe('cover_photo');
      uid.undone(YIRGACHEFFE.uid);
      expect(library.items().find((file) => file.uuid === YIRGACHEFFE.uuid)?.uid).toBe(YIRGACHEFFE.uid);
    });

    it('does nothing when the dialog is dismissed', async () => {
      const { actions, api } = setup({ renamed: undefined });

      await actions.rename(YIRGACHEFFE);

      expect(api.renameAsset).not.toHaveBeenCalled();
    });

    it('does not even ask in a read-only project or for a viewer', async () => {
      const { actions, dialogs } = setup({ viewer: true, renamed: 'x.jpg' });

      await actions.rename(YIRGACHEFFE);

      expect(dialogs.open).not.toHaveBeenCalled();
    });

    it('says so when the server refuses', async () => {
      const { actions, api, last } = setup({ renamed: 'cover.jpg' });
      api.renameAsset.mockReturnValue(throwError(() => new Error('409')));

      await actions.rename(YIRGACHEFFE);

      expect(last()).toMatchObject({ kind: 'error', message: 'Could not rename “yirgacheffe.jpg” — try again in a moment.' });
    });
  });

  describe('download (decision 95)', () => {
    it('downloads one file as itself, under the name the library shows', async () => {
      const { actions, api } = setup();

      await actions.download([LATTE]);

      expect(api.mediaBinaryBlob).toHaveBeenCalledWith('proj', LATTE.uuid);
      expect(api.downloadMediaZip).not.toHaveBeenCalled();
      expect(saved.map((s) => s.name)).toEqual(['latte-art.jpg']);
    });

    it('downloads several files as one ZIP named after the folder', async () => {
      const { actions, api } = setup();

      await actions.download([YIRGACHEFFE, LATTE, LOGO]);

      expect(api.downloadMediaZip).toHaveBeenCalledWith('proj', [YIRGACHEFFE.uuid, LATTE.uuid, LOGO.uuid], 'products');
      expect(api.mediaBinaryBlob).not.toHaveBeenCalled();
      expect(saved.map((s) => s.name)).toEqual(['products.zip']);
    });

    it('names the ZIP of the library root after All media', async () => {
      const { actions, api, library } = setup();
      library.applyRoute({ folder: '' });

      await actions.download([YIRGACHEFFE, LATTE]);

      expect(api.downloadMediaZip).toHaveBeenCalledWith('proj', expect.any(Array), 'all-media');
    });

    it('says so when a download fails, and when the files are too many for one ZIP', async () => {
      const { actions, api, last } = setup();
      api.mediaBinaryBlob.mockReturnValue(throwError(() => new Error('500')));
      await actions.download([LATTE]);
      expect(last()).toMatchObject({ kind: 'error', message: 'Could not download “latte-art.jpg” — try again in a moment.' });

      api.downloadMediaZip.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await actions.download([LATTE, LOGO]);
      expect(last().message).toBe('Could not download the files — try again in a moment.');

      api.downloadMediaZip.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 413 })));
      await actions.download([LATTE, LOGO]);
      expect(last().message).toBe('These files add up to too much for one download. Select fewer files.');
      expect(saved).toEqual([]);
    });
  });

  describe('favorites (decisions 57–58)', () => {
    it('stars a file as a media asset with its folder and says so', () => {
      const { actions, favorites, last } = setup();

      actions.toggleFavorite(YIRGACHEFFE);

      expect(favorites.toggle).toHaveBeenCalledWith({
        type: 'MEDIA',
        uuid: YIRGACHEFFE.uuid,
        displayName: 'yirgacheffe.jpg',
        folderPath: '/media_root/products/',
      });
      expect(last().message).toBe('“yirgacheffe.jpg” added to your favorites.');
    });

    it('says when the star is taken off', () => {
      const { actions, favorites, last } = setup();
      favorites.toggle.mockReturnValue(false);

      actions.toggleFavorite(YIRGACHEFFE);

      expect(last().message).toBe('“yirgacheffe.jpg” removed from your favorites.');
    });
  });

  describe('delete (decision 99)', () => {
    it('confirms a single file plainly with what uses it, and offers Undo', async () => {
      const { actions, confirm, api, last } = setup();

      await actions.deleteFile(YIRGACHEFFE); // used in 2 places

      const options = confirm.confirm.mock.calls[0][0];
      expect(options).toMatchObject({ title: 'Delete “yirgacheffe.jpg”?', confirmLabel: 'Delete', tone: 'danger' });
      expect(options.message).toBe('They are used in 2 places; those links will break. It stays online until you release the deletion.');
      expect(options.typeToConfirm).toBeUndefined();
      expect(api.deleteAsset).toHaveBeenCalledWith('proj', YIRGACHEFFE.uuid);
      expect(last().message).toBe('Deleted “yirgacheffe.jpg”.');
      expect(last().action).toBeDefined();
    });

    it('says that published files stay online, and that deleted files can be restored', async () => {
      const { actions, confirm } = setup();

      await actions.deleteFile(LOGO);

      expect(confirm.confirm.mock.calls[0][0].message).toBe(
        'Deleted files can be restored from the history. It stays online until you release the deletion.',
      );
    });

    it('lists the names of a selection, offers one Undo, and asks for the word delete from 25 files', async () => {
      const { actions, confirm, library, api, last } = setup();
      library.setSelection([YIRGACHEFFE.uuid!, LATTE.uuid!]);

      await actions.deleteFile(LATTE);

      const options = confirm.confirm.mock.calls[0][0];
      expect(options).toMatchObject({ title: 'Delete 2 files?', confirmLabel: 'Delete 2 files', details: ['yirgacheffe.jpg', 'latte-art.jpg'] });
      expect(options.typeToConfirm).toBeUndefined();
      expect(last().message).toBe('Deleted 2 files.');
      last().action!.run();
      await vi.waitFor(() => expect(api.restoreAsset).toHaveBeenCalledTimes(2));
    });

    it('requires the word delete from 25 files', async () => {
      const { actions, confirm, library } = setup();
      const many = Array.from({ length: 25 }, (_, i) => ({ ...YIRGACHEFFE, uuid: `many-${i}`, displayName: `many-${i}.jpg` }));
      library.items.set(many);
      library.setSelection(many.map((file) => file.uuid));

      await actions.deleteSelection();

      expect(confirm.confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
    });

    it('does nothing in a read-only project or for a viewer', async () => {
      const { actions, confirm } = setup({ viewer: true });

      await actions.deleteFile(YIRGACHEFFE);

      expect(confirm.confirm).not.toHaveBeenCalled();
    });
  });
});
