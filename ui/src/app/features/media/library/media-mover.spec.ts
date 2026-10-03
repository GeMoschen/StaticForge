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
import { DialogService } from '../../../shared/components/dialog/dialog.service';
import { MEDIA_DRAG_TYPE, MediaMover } from './media-mover';
import { MediaLibraryStore } from './media-library.store';
import { MEDIA_TREE, productFiles, projectStub } from './media-library.testing';

const [YIRGACHEFFE, LATTE, LOGO] = productFiles();

function setup(options: { readOnly?: boolean; viewer?: boolean; chosen?: { target: string | null } | undefined } = {}) {
  const api = { moveAsset: vi.fn().mockReturnValue(of({})) };
  const dialog = { result: Promise.resolve(options.chosen) };
  const dialogs = { open: vi.fn().mockReturnValue(dialog) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      MediaLibraryStore,
      MediaMover,
      { provide: ApiClient, useValue: api },
      { provide: DialogService, useValue: dialogs },
      { provide: ProjectPermissionsStore, useValue: { canEditContent: signal(!options.viewer) } },
      { provide: ProjectContextStore, useValue: projectStub() },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
    ],
  });
  const library = TestBed.inject(MediaLibraryStore);
  library.connect(signal('proj'));
  Object.defineProperty(library, 'readOnly', { value: signal(options.readOnly ?? false) });
  library.reloadFolders = vi.fn();
  library.reloadMedia = vi.fn();
  library.applyRoute({ folder: 'products-uuid' });
  library.items.set(productFiles());
  library.allMedia.set(productFiles());
  const toasts = TestBed.inject(ToastService);
  return { mover: TestBed.inject(MediaMover), library, api, dialogs, toasts, last: () => toasts.toasts().at(-1)! };
}

/** A drag event as far as the mover reads it. */
function dragEvent(types: string[], data: Record<string, string> = {}) {
  const store = { ...data };
  return {
    dataTransfer: {
      types,
      effectAllowed: 'all',
      setData: (type: string, value: string) => (store[type] = value),
      getData: (type: string) => store[type] ?? '',
    },
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
}

describe('MediaMover', () => {
  beforeEach(() => vi.useRealTimers());

  describe('moving files', () => {
    it('moves each file into the folder and says where, with one Undo that moves them all back', async () => {
      const { mover, api, library, last } = setup();
      library.setSelection([YIRGACHEFFE.uuid!, LATTE.uuid!]);

      await mover.moveTo([YIRGACHEFFE.uuid!, LATTE.uuid!], 'archive-uuid', 'file');

      expect(api.moveAsset).toHaveBeenCalledWith('proj', YIRGACHEFFE.uuid, { folderUuid: 'archive-uuid' });
      expect(api.moveAsset).toHaveBeenCalledWith('proj', LATTE.uuid, { folderUuid: 'archive-uuid' });
      expect(last().message).toBe('Moved 2 files to Archive.');
      // The files leave the open folder and the selection at once; the library reads again.
      expect(library.items().map((file) => file.uuid)).not.toContain(YIRGACHEFFE.uuid);
      expect(library.selected()).toEqual([]);
      expect(library.reloadMedia).toHaveBeenCalled();

      api.moveAsset.mockClear();
      last().action!.run();
      await vi.waitFor(() => expect(api.moveAsset).toHaveBeenCalledTimes(2));
      // Undone last to first, back into the folder each file came from.
      expect(api.moveAsset.mock.calls.map((call) => call[1])).toEqual([LATTE.uuid, YIRGACHEFFE.uuid]);
      expect(api.moveAsset).toHaveBeenLastCalledWith('proj', YIRGACHEFFE.uuid, { folderUuid: 'products-uuid' });
      await vi.waitFor(() => expect((library.reloadMedia as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1));
    });

    it('names the file when one moves, and the top level by its name', async () => {
      const { mover, api, last } = setup();

      await mover.moveTo([LOGO.uuid!], null, 'file');

      expect(api.moveAsset).toHaveBeenCalledWith('proj', LOGO.uuid, {});
      expect(last().message).toBe('Moved “logo-mark.png” to All media.');
    });

    it('leaves files that are in the target alone', async () => {
      const { mover, api } = setup();

      await mover.moveTo([YIRGACHEFFE.uuid!], 'products-uuid', 'file');

      expect(api.moveAsset).not.toHaveBeenCalled();
    });

    it('moves what it can, counts what the server refused and offers Undo for the rest', async () => {
      const { mover, api, toasts, last } = setup();
      api.moveAsset.mockReturnValueOnce(throwError(() => new Error('409'))).mockReturnValue(of({}));

      await mover.moveTo([YIRGACHEFFE.uuid!, LATTE.uuid!], 'archive-uuid', 'file');

      expect(toasts.toasts().some((toast) => toast.kind === 'error' && /Could not move 1 of 2 files/.test(toast.message))).toBe(true);
      expect(last().message).toBe('Moved “latte-art.jpg” to Archive.');
      expect(last().action).toBeDefined();
    });

    it('offers no Undo when nothing moved', async () => {
      const { mover, api, toasts } = setup();
      api.moveAsset.mockReturnValue(throwError(() => new Error('403')));

      await mover.moveTo([YIRGACHEFFE.uuid!], 'archive-uuid', 'file');

      expect(toasts.toasts().every((toast) => !toast.action)).toBe(true);
      expect(toasts.toasts().at(-1)?.kind).toBe('error');
    });

    it('closes the drawer of a file that moved away', async () => {
      const { mover, library } = setup();
      library.applyRoute({ folder: 'products-uuid', asset: YIRGACHEFFE.uuid });
      library.selectedMedia.set(YIRGACHEFFE as never);

      await mover.moveTo([YIRGACHEFFE.uuid!], 'archive-uuid', 'file');

      expect(library.selectedMedia()).toBeNull();
    });

    it.each([
      ['a read-only project', { readOnly: true }],
      ['a viewer', { viewer: true }],
    ])('does nothing for %s', async (_who, options) => {
      const { mover, api, dialogs } = setup(options);

      await mover.moveTo([YIRGACHEFFE.uuid!], 'archive-uuid', 'file');
      await mover.moveFiles([YIRGACHEFFE]);

      expect(api.moveAsset).not.toHaveBeenCalled();
      expect(dialogs.open).not.toHaveBeenCalled();
    });
  });

  describe('moving folders', () => {
    it('moves a folder and offers Undo into its old parent, reading the tree again', async () => {
      const { mover, api, library, last } = setup();

      await mover.moveTo(['roastery-uuid'], 'archive-uuid', 'folder');

      expect(api.moveAsset).toHaveBeenCalledWith('proj', 'roastery-uuid', { folderUuid: 'archive-uuid' });
      expect(last().message).toBe('Moved the folder “Roastery” into Archive.');
      expect(library.reloadFolders).toHaveBeenCalled();

      last().action!.run();
      await vi.waitFor(() => expect(api.moveAsset).toHaveBeenLastCalledWith('proj', 'roastery-uuid', { folderUuid: 'products-uuid' }));
    });

    it('moves a folder to the top level, and Undo moves it back into the folder it was in', async () => {
      const { mover, api, last } = setup();

      await mover.moveTo(['roastery-uuid'], null, 'folder');

      expect(api.moveAsset).toHaveBeenCalledWith('proj', 'roastery-uuid', {});
      expect(last().message).toBe('Moved the folder “Roastery” into All media.');
    });

    it('says why the server refused', async () => {
      const { mover, api, last } = setup();
      api.moveAsset.mockReturnValue(throwError(() => new Error('409')));

      await mover.moveTo(['products-uuid'], 'roastery-uuid', 'folder');

      expect(last()).toMatchObject({ kind: 'error' });
      expect(last().message).toMatch(/may create a cycle/);
    });
  });

  describe('the move dialog', () => {
    it('asks for a target for the files (the open folder is current) and moves them there', async () => {
      const { mover, api, dialogs } = setup({ chosen: { target: 'archive-uuid' } });

      await mover.moveFiles([YIRGACHEFFE, LATTE]);

      const [, data] = dialogs.open.mock.calls[0];
      expect(data).toMatchObject({ title: 'Move 2 files', current: 'products-uuid', excluded: [], tree: MEDIA_TREE });
      expect(api.moveAsset).toHaveBeenCalledWith('proj', YIRGACHEFFE.uuid, { folderUuid: 'archive-uuid' });
    });

    it('names the file in the title of a single file’s move', async () => {
      const { mover, dialogs } = setup({ chosen: undefined });

      await mover.moveFiles([YIRGACHEFFE]);

      expect(dialogs.open.mock.calls[0][1].title).toBe('Move “yirgacheffe.jpg”');
    });

    it('moves nothing when the dialog is dismissed', async () => {
      const { mover, api } = setup({ chosen: undefined });

      await mover.moveFiles([YIRGACHEFFE]);

      expect(api.moveAsset).not.toHaveBeenCalled();
    });

    it('offers the top level for files too, and moves them there', async () => {
      const { mover, api } = setup({ chosen: { target: null } });

      await mover.moveFiles([LOGO]);

      expect(api.moveAsset).toHaveBeenCalledWith('proj', LOGO.uuid, {});
    });

    it('blocks the folder itself and what is inside it, and shows its parent as the current folder', async () => {
      const { mover, api, dialogs } = setup({ chosen: { target: null } });

      await mover.moveFolders(['roastery-uuid']);

      const [, data] = dialogs.open.mock.calls[0];
      expect(data).toMatchObject({ title: 'Move folder “Roastery”', current: 'products-uuid', excluded: ['roastery-uuid'] });
      expect(api.moveAsset).toHaveBeenCalledWith('proj', 'roastery-uuid', {});
    });

    it('shows the top level as current for a top-level folder', async () => {
      const { mover, dialogs } = setup({ chosen: undefined });

      await mover.moveFolders(['team-uuid']);

      expect(dialogs.open.mock.calls[0][1].current).toBeNull();
    });
  });

  describe('dragging cards onto the tree', () => {
    it('drags the card’s file, or the whole selection when the card is part of it', () => {
      const { mover, library } = setup();
      const alone = dragEvent([]);
      mover.startDrag(alone, LOGO.uuid);
      expect(JSON.parse(alone.dataTransfer!.getData(MEDIA_DRAG_TYPE))).toEqual([LOGO.uuid]);
      expect(alone.dataTransfer!.effectAllowed).toBe('move');

      library.setSelection([YIRGACHEFFE.uuid!, LATTE.uuid!]);
      const group = dragEvent([]);
      mover.startDrag(group, LATTE.uuid);
      expect(JSON.parse(group.dataTransfer!.getData(MEDIA_DRAG_TYPE))).toEqual([YIRGACHEFFE.uuid, LATTE.uuid]);

      const other = dragEvent([]);
      mover.startDrag(other, LOGO.uuid);
      expect(JSON.parse(other.dataTransfer!.getData(MEDIA_DRAG_TYPE))).toEqual([LOGO.uuid]);
    });

    it('does not start a drag for a viewer, nor in a read-only project', () => {
      const { mover } = setup({ viewer: true });
      const event = dragEvent([]);

      mover.startDrag(event, LOGO.uuid);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.dataTransfer!.getData(MEDIA_DRAG_TYPE)).toBe('');
    });

    it('accepts a folder and the top level, but not the folder the files are in, nor other drags', () => {
      const { mover } = setup();
      const files = dragEvent([MEDIA_DRAG_TYPE]);

      expect(mover.acceptsDrag(files, { id: 'archive-uuid' })).toBe(true);
      expect(mover.acceptsDrag(files, null)).toBe(true);
      expect(mover.acceptsDrag(files, { id: 'products-uuid' })).toBe(false); // the folder they are in
      expect(mover.acceptsDrag(dragEvent(['Files']), { id: 'archive-uuid' })).toBe(false);
    });

    it('does not accept the top level while the library root is open (the files are in it)', () => {
      const { mover, library } = setup();
      library.applyRoute({ folder: '' });

      expect(mover.acceptsDrag(dragEvent([MEDIA_DRAG_TYPE]), null)).toBe(false);
    });

    it('moves the dropped files into the folder, with Undo', async () => {
      const { mover, api, last } = setup();
      const drop = dragEvent([MEDIA_DRAG_TYPE], { [MEDIA_DRAG_TYPE]: JSON.stringify([YIRGACHEFFE.uuid, LATTE.uuid]) });

      await mover.drop(drop, { id: 'archive-uuid' });

      expect(api.moveAsset).toHaveBeenCalledTimes(2);
      expect(last().message).toBe('Moved 2 files to Archive.');
      expect(last().action).toBeDefined();
    });

    it('ignores a drop without readable files', async () => {
      const { mover, api } = setup();

      await mover.drop(dragEvent([MEDIA_DRAG_TYPE], { [MEDIA_DRAG_TYPE]: 'not json' }), { id: 'archive-uuid' });

      expect(api.moveAsset).not.toHaveBeenCalled();
    });
  });
});
