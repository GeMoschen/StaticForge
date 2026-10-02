import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { MediaDrawerStore } from './drawer/media-drawer.store';
import { MediaDrawerUsagesStore } from './drawer/media-drawer-usages.store';
import { MediaFolderActions } from './library/media-folder-actions';
import { MediaItemActions } from './library/media-item-actions';
import { MediaLibraryStore } from './library/media-library.store';

type FolderView = components['schemas']['FolderView'];
type MediaView = components['schemas']['MediaView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];

// The tree as the API sends it: the wrapper root, with "Archive" and "Press" (holding "Kits") below it.
const TREE: FolderView[] = [
  {
    uuid: 'root-uuid',
    path: '/media_root/',
    displayName: 'All media',
    protectedFolder: true,
    children: [
      { uuid: 'archive-uuid', path: '/media_root/archive/', displayName: 'Archive', revision: 3, children: [] },
      {
        uuid: 'press-uuid',
        path: '/media_root/press/',
        displayName: 'Press',
        revision: 2,
        children: [{ uuid: 'kits-uuid', path: '/media_root/press/kits/', displayName: 'Kits', children: [] }],
      },
    ],
  },
];
const ARCHIVE = TREE[0].children![0];
const PRESS = TREE[0].children![1];

const photo: MediaView = { uuid: 'm1', uid: 'photo', displayName: 'photo.jpg', revision: 7 };
const logo: MediaView = { uuid: 'm2', uid: 'logo', displayName: 'logo.png', revision: 4 };

const summary = (uuid: string, folderPath: string): MediaSummaryView => ({ uuid, folderPath, displayName: uuid });

describe('media undo', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let confirms: { confirm: ReturnType<typeof vi.fn> };
  let library: MediaLibraryStore;
  let toasts: ToastService;

  const lastToast = () => toasts.toasts().at(-1)!;

  beforeEach(() => {
    api = {
      deleteAsset: vi.fn().mockReturnValue(of(undefined)),
      restoreAsset: vi.fn().mockReturnValue(of({})),
      renameAsset: vi.fn().mockReturnValue(of({ revision: 8 })),
      moveAsset: vi.fn().mockReturnValue(of({})),
      deleteFolder: vi.fn().mockReturnValue(of(undefined)),
      restoreFolder: vi.fn().mockReturnValue(of({})),
      renameFolder: vi.fn().mockReturnValue(of({ revision: 5 })),
    };
    confirms = { confirm: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideRouter([]),
        MediaLibraryStore,
        MediaItemActions,
        MediaFolderActions,
        MediaDrawerStore,
        MediaDrawerUsagesStore,
        { provide: ApiClient, useValue: api },
        { provide: ConfirmService, useValue: confirms },
      ],
    });
    TestBed.inject(ProjectContextStore).mediaFolderTree.set(TREE);
    library = TestBed.inject(MediaLibraryStore);
    library.connect(signal('proj'));
    library.reloadFolders = vi.fn();
    library.reloadMedia = vi.fn();
    toasts = TestBed.inject(ToastService);
  });

  describe('deleting files', () => {
    it('asks with a danger confirmation, deletes, and Undo restores the last live revision', async () => {
      library.items.set([photo]);
      const actions = TestBed.inject(MediaItemActions);

      expect(await actions.deleteMedia({ uuid: 'm1', label: 'photo.jpg', revision: 7 })).toBe(true);

      const options = confirms.confirm.mock.calls[0][0];
      expect(options.tone).toBe('danger');
      expect(options.irreversible).toBeUndefined();
      expect(api['deleteAsset']).toHaveBeenCalledWith('proj', 'm1');
      expect(lastToast().message).toBe('Deleted “photo.jpg”.');

      lastToast().action!.run();
      await vi.waitFor(() => expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'm1', { fromRevision: 7 }));
      expect(library.reloadMedia).toHaveBeenCalled();
    });

    it('does not delete when the confirmation is declined', async () => {
      confirms.confirm.mockResolvedValue(false);

      const deleted = await TestBed.inject(MediaItemActions).deleteMedia({ uuid: 'm1', label: 'photo.jpg', revision: 7 });

      expect(deleted).toBe(false);
      expect(api['deleteAsset']).not.toHaveBeenCalled();
    });

    it('shows the error toast when the restore fails', async () => {
      api['restoreAsset'].mockReturnValue(throwError(() => new Error('409')));
      await TestBed.inject(MediaItemActions).deleteMedia({ uuid: 'm1', label: 'photo.jpg', revision: 7 });

      lastToast().action!.run();

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
      expect(lastToast().message).toMatch(/Could not undo/);
    });

    it('bulk delete lists the names, offers one Undo and restores the files last to first', async () => {
      library.items.set([photo, logo]);
      library.selected.set(['m1', 'm2']);

      await TestBed.inject(MediaItemActions).deleteSelection();

      const options = confirms.confirm.mock.calls[0][0];
      expect(options.details).toEqual(['photo.jpg', 'logo.png']);
      expect(options.typeToConfirm).toBeUndefined();
      expect(lastToast().message).toBe('Deleted 2 files.');
      expect(toasts.toasts().filter((t) => t.action)).toHaveLength(1);

      lastToast().action!.run();
      await vi.waitFor(() => expect(api['restoreAsset']).toHaveBeenCalledTimes(2));
      expect(api['restoreAsset'].mock.calls.map((c) => c[1])).toEqual(['m2', 'm1']);
      expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'm2', { fromRevision: 4 });
    });

    it('bulk delete of 25 files needs the word delete typed', async () => {
      const many = Array.from({ length: 25 }, (_, i): MediaView => ({ uuid: `f${i}`, displayName: `f${i}.png`, revision: 1 }));
      library.items.set(many);
      library.selected.set(many.map((m) => m.uuid!));

      await TestBed.inject(MediaItemActions).deleteSelection();

      expect(confirms.confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
      expect(lastToast().message).toBe('Deleted 25 files.');
    });

    it('bulk delete offers Undo only for the files that were deleted', async () => {
      library.items.set([photo, logo]);
      library.selected.set(['m1', 'm2']);
      api['deleteAsset'].mockReturnValueOnce(throwError(() => new Error('403'))).mockReturnValue(of(undefined));

      await TestBed.inject(MediaItemActions).deleteSelection();

      expect(toasts.toasts().some((t) => t.kind === 'error')).toBe(true);
      expect(lastToast().message).toBe('Deleted 1 file.');
      lastToast().action!.run();
      await vi.waitFor(() => expect(api['restoreAsset']).toHaveBeenCalledTimes(1));
      expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'm2', { fromRevision: 4 });
    });
  });

  describe('renaming', () => {
    it('a file renames back with the revision the rename produced', async () => {
      TestBed.inject(MediaItemActions).renameMedia('m1', 'photo.jpg', 'cover.jpg', 7).subscribe();

      expect(api['renameAsset']).toHaveBeenCalledWith('proj', 'm1', { displayName: 'cover.jpg' }, 7);
      expect(lastToast().message).toBe('Renamed “photo.jpg” to “cover.jpg”.');
      lastToast().action!.run();
      await vi.waitFor(() =>
        expect(api['renameAsset']).toHaveBeenLastCalledWith('proj', 'm1', { displayName: 'photo.jpg' }, 8),
      );
    });

    it('a folder renames back with the revision the rename produced', async () => {
      TestBed.inject(MediaFolderActions).renameFolderTo(PRESS, 'News').subscribe();

      expect(api['renameFolder']).toHaveBeenCalledWith('proj', 'press-uuid', { displayName: 'News' }, 2);
      expect(lastToast().message).toBe('Renamed “Press” to “News”.');
      lastToast().action!.run();
      await vi.waitFor(() =>
        expect(api['renameFolder']).toHaveBeenLastCalledWith('proj', 'press-uuid', { displayName: 'Press' }, 5),
      );
    });

    it('shows the error toast when renaming back fails', async () => {
      TestBed.inject(MediaItemActions).renameMedia('m1', 'photo.jpg', 'cover.jpg', 7).subscribe();
      api['renameAsset'].mockReturnValue(throwError(() => new Error('412')));

      lastToast().action!.run();

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
    });
  });

  describe('moving', () => {
    it('a file dropped on a folder moves back to the folder it came from', async () => {
      library.allMedia.set([summary('m1', '/media_root/archive/')]);

      TestBed.inject(MediaFolderActions).moveItemTo({ source: 'm1', target: 'press-uuid' });

      expect(api['moveAsset']).toHaveBeenCalledWith('proj', 'm1', { folderUuid: 'press-uuid' });
      expect(lastToast().message).toBe('Moved “m1” to Press.');
      lastToast().action!.run();
      await vi.waitFor(() =>
        expect(api['moveAsset']).toHaveBeenLastCalledWith('proj', 'm1', { folderUuid: 'archive-uuid' }),
      );
    });

    it('a file that came from the root moves back to the root (no folder)', async () => {
      library.allMedia.set([summary('m1', '/media_root/')]);

      TestBed.inject(MediaFolderActions).moveItemTo({ source: 'm1', target: 'press-uuid' });
      lastToast().action!.run();

      await vi.waitFor(() => expect(api['moveAsset']).toHaveBeenLastCalledWith('proj', 'm1', {}));
    });

    it('a folder moves back into its old parent', async () => {
      TestBed.inject(MediaFolderActions).moveItemTo({ source: 'kits-uuid', target: 'archive-uuid' });

      expect(lastToast().message).toBe('Moved “Kits” to Archive.');
      lastToast().action!.run();
      await vi.waitFor(() =>
        expect(api['moveAsset']).toHaveBeenLastCalledWith('proj', 'kits-uuid', { folderUuid: 'press-uuid' }),
      );
    });

    it('shows the error toast when moving back fails', async () => {
      library.allMedia.set([summary('m1', '/media_root/archive/')]);
      TestBed.inject(MediaFolderActions).moveItemTo({ source: 'm1', target: 'press-uuid' });
      api['moveAsset'].mockReturnValue(throwError(() => new Error('409')));

      lastToast().action!.run();

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
      expect(lastToast().message).toMatch(/Could not undo/);
    });
  });

  describe('deleting folders', () => {
    it('counts what is inside, and Undo restores the folder with its subtree in one call', async () => {
      library.allMedia.set([summary('m1', '/media_root/press/'), summary('m2', '/media_root/press/kits/')]);

      expect(await TestBed.inject(MediaFolderActions).deleteFolder(PRESS)).toBe(true);

      const options = confirms.confirm.mock.calls[0][0];
      expect(options.tone).toBe('danger');
      expect(options.irreversible).toBeUndefined();
      expect(options.message).toContain('2 media items and 1 sub-folder');
      expect(options.typeToConfirm).toBeUndefined();
      expect(api['deleteFolder']).toHaveBeenCalledWith('proj', 'press-uuid', true);
      expect(lastToast().message).toBe('Deleted “Press”.');

      lastToast().action!.run();
      await vi.waitFor(() => expect(api['restoreFolder']).toHaveBeenCalledWith('proj', 'press-uuid'));
      expect(api['restoreFolder']).toHaveBeenCalledTimes(1);
    });

    it('a folder holding 25 items in all needs the word delete typed', async () => {
      // 24 files + the sub-folder = 25 items inside, plus the folder itself.
      library.allMedia.set(Array.from({ length: 24 }, (_, i) => summary(`f${i}`, '/media_root/press/')));

      await TestBed.inject(MediaFolderActions).deleteFolder(PRESS);

      expect(confirms.confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
    });

    it('shows the error toast when the restore fails', async () => {
      api['restoreFolder'].mockReturnValue(throwError(() => new Error('409')));
      await TestBed.inject(MediaFolderActions).deleteFolder(ARCHIVE);

      lastToast().action!.run();

      await vi.waitFor(() => expect(lastToast().kind).toBe('error'));
    });
  });

  describe('deleting from the detail drawer', () => {
    it('is no longer irreversible, and Undo restores the revision the drawer showed', async () => {
      const core = TestBed.inject(MediaDrawerStore);
      const deleted = vi.fn();
      core.connect({ projectKey: signal('proj'), media: signal(photo), updated: vi.fn(), deleted });
      const usages = TestBed.inject(MediaDrawerUsagesStore);

      await usages.confirmDelete();

      const options = confirms.confirm.mock.calls[0][0];
      expect(options.tone).toBe('danger');
      expect(options.irreversible).toBeUndefined();
      expect(api['deleteAsset']).toHaveBeenCalledWith('proj', 'm1');
      expect(deleted).toHaveBeenCalledWith('m1');
      expect(lastToast().message).toBe('Deleted “photo.jpg”.');

      lastToast().action!.run();
      await vi.waitFor(() => expect(api['restoreAsset']).toHaveBeenCalledWith('proj', 'm1', { fromRevision: 7 }));
    });
  });
});
