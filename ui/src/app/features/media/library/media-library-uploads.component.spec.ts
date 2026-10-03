import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, type Transfer } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { projectDetail } from '../../../core/project/testing/project-detail.fixture';
import { ToastService } from '../../../core/ui/toast.service';
import { MediaLibraryUploadsComponent } from './media-library-uploads.component';
import { MediaLibraryStore } from './media-library.store';
import { MEDIA_TREE, productFiles } from './media-library.testing';
import { MediaUploadStore, UPLOAD_CONCURRENCY } from './media-upload.store';

type MediaView = components['schemas']['MediaView'];
type MediaSaveResponse = components['schemas']['MediaSaveResponse'];
type ProjectDetail = components['schemas']['ProjectDetail'];

const MB = 1024 * 1024;

/** What `POST /media` answers for a picture (the API's real shape: no `altText` yet, the center focal point). */
function created(name: string, overrides: Partial<MediaView> = {}): MediaView {
  const id = name.replace(/\W+/g, '-');
  return {
    uuid: `new-${id}`,
    uid: id.toLowerCase(),
    displayName: name,
    fileName: name,
    revision: 5,
    mimeType: name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.pdf') ? 'application/pdf' : 'text/css',
    sizeBytes: 1000,
    focalPoint: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

function file(name: string, type = 'image/jpeg', size = 1000): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

interface Call {
  file: File;
  opts: { folderUuid?: string };
  subject: Subject<Transfer<MediaView>>;
}

interface SetupOptions {
  /** `ProjectDetail.effectiveAllowedMimeTypes`. */
  types?: string[];
  maxBytes?: number | null;
  canUpload?: boolean;
  readOnly?: boolean;
  locale?: string | null;
}

async function setup(options: SetupOptions = {}) {
  const calls: Call[] = [];
  const replaces: { uuid: string; file: File; subject: Subject<Transfer<MediaSaveResponse>> }[] = [];
  const api = {
    uploadMediaWithProgress: vi.fn((_key: string, f: File, opts: { folderUuid?: string }) => {
      const subject = new Subject<Transfer<MediaView>>();
      calls.push({ file: f, opts, subject });
      return subject;
    }),
    replaceMediaWithProgress: vi.fn((_key: string, uuid: string, f: File) => {
      const subject = new Subject<Transfer<MediaSaveResponse>>();
      replaces.push({ uuid, file: f, subject });
      return subject;
    }),
    updateMediaMetadata: vi.fn((_key: string, uuid: string, body: { altText?: string }, revision?: number, _locale?: string) =>
      of({ ...created('x.jpg'), uuid, altText: body.altText, revision: (revision ?? 0) + 1 } as MediaView),
    ),
  };
  const library = {
    projectKey: signal('proj'),
    folderUuid: signal('products-uuid'),
    tree: signal(MEDIA_TREE),
    mediaRoot: signal(MEDIA_TREE[0]),
    allLoaded: signal(true),
    allMedia: signal(productFiles()),
    items: signal(productFiles()),
    readOnly: signal(options.readOnly ?? false),
    readOnlyLabel: signal('Archived project — read-only'),
    selectedMedia: signal<MediaView | null>(null),
    prepend: vi.fn(),
    onUpdated: vi.fn(),
    openAsset: vi.fn().mockReturnValue(true),
  };
  const detail: ProjectDetail = {
    ...projectDetail(['RELEASE']),
    effectiveAllowedMimeTypes: options.types ?? ['*'],
    mediaMaxUploadBytes: options.maxBytes === undefined ? 10 * MB : (options.maxBytes ?? undefined),
  };
  const view = await render(MediaLibraryUploadsComponent, {
    providers: [
      MediaUploadStore,
      { provide: ApiClient, useValue: api },
      { provide: MediaLibraryStore, useValue: library },
      { provide: ProjectContextStore, useValue: { project: signal(detail) } },
      { provide: ProjectPermissionsStore, useValue: { canEditContent: signal(options.canUpload ?? true) } },
      { provide: EditingLocaleStore, useValue: { locale: signal(options.locale ?? null) } },
    ],
  });
  const store = TestBed.inject(MediaUploadStore);
  const toasts = TestBed.inject(ToastService);
  /** Lets the screen render what the store changed (the app is zoneless). */
  const settle = async () => {
    view.fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    view.fixture.detectChanges();
  };
  const upload = async (...files: File[]) => {
    store.upload(files);
    await settle();
  };
  return { view, store, api, library, calls, replaces, toasts, settle, upload };
}

afterEach(() => {
  document.querySelectorAll('sf-drawer').forEach((el) => el.remove());
});

describe('the upload panel', () => {
  it('shows nothing until files are uploaded', async () => {
    await setup();
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.querySelector('.uploads')).toBeNull();
  });

  describe('progress', () => {
    it('sends each file into the open folder and shows a progress bar with the percentage', async () => {
      const { calls, upload, settle } = await setup();

      await upload(file('a.jpg', 'image/jpeg', 4096));

      expect(calls[0].opts).toEqual({ folderUuid: 'products-uuid' });
      expect(screen.getByRole('heading', { name: 'Uploads to Products' })).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Uploading a.jpg' })).toHaveAttribute('aria-valuenow', '0');

      calls[0].subject.next({ kind: 'progress', loaded: 1024, total: 4096 });
      await settle();

      expect(screen.getByRole('progressbar', { name: 'Uploading a.jpg' })).toHaveAttribute('aria-valuenow', '25');
      expect(screen.getByText('25 %')).toBeInTheDocument();
      expect(screen.getByText('4 KB')).toBeInTheDocument();
    });

    it('never shows 100 % before the server has answered', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('a.jpg'));

      calls[0].subject.next({ kind: 'progress', loaded: 1000, total: 1000 });
      await settle();

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
    });

    it('says how many are uploading, then that all finished, and offers Close only then', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('a.jpg'), file('b.jpg'));

      expect(screen.getByRole('status')).toHaveTextContent('2 of 2 uploading');
      expect(screen.queryByRole('button', { name: 'Close uploads' })).toBeNull();

      calls[0].subject.next({ kind: 'done', body: created('a.jpg') });
      await settle();
      expect(screen.getByRole('status')).toHaveTextContent('1 of 2 uploading');

      calls[1].subject.next({ kind: 'done', body: created('b.jpg') });
      await settle();
      expect(screen.getByRole('status')).toHaveTextContent('All uploads finished');
      fireEvent.click(screen.getByRole('button', { name: 'Close uploads' }));
      await settle();
      expect(document.querySelector('.uploads')).toBeNull();
    });

    it('runs at most three uploads at once and starts the next when one finishes', async () => {
      const { calls, upload, settle } = await setup();
      const names = ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'];

      await upload(...names.map((n) => file(n)));

      expect(UPLOAD_CONCURRENCY).toBe(3);
      expect(calls.map((c) => c.file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg']);
      expect(screen.getAllByText('Waiting…')).toHaveLength(2);

      calls[1].subject.next({ kind: 'done', body: created('2.jpg') });
      await settle();

      expect(calls.map((c) => c.file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
      expect(screen.getAllByText('Waiting…')).toHaveLength(1);
    });

    it('collapses the list and says so', async () => {
      const { upload, settle } = await setup();
      await upload(file('a.jpg'));
      const toggle = screen.getByRole('button', { name: 'Hide the upload list' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(toggle);
      await settle();

      const shown = screen.getByRole('button', { name: 'Show the upload list' });
      expect(shown).toHaveAttribute('aria-expanded', 'false');
      expect(document.getElementById(shown.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
    });
  });

  describe('where the files go', () => {
    it('puts a finished file into its folder at once and says it is uploaded', async () => {
      const { calls, library, upload, settle } = await setup();
      await upload(file('a.jpg'));
      const media = created('a.jpg');

      calls[0].subject.next({ kind: 'done', body: media });
      await settle();

      expect(library.prepend).toHaveBeenCalledWith(media, 'products-uuid');
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    it('keeps the folder that was open when the files were dropped, and names several folders', async () => {
      const { calls, library, upload, settle } = await setup();
      await upload(file('a.jpg'));

      library.folderUuid.set('team-uuid');
      await upload(file('b.jpg'));
      expect(screen.getByRole('heading', { name: 'Uploads to 2 folders' })).toBeInTheDocument();
      expect(calls.map((c) => c.opts.folderUuid)).toEqual(['products-uuid', 'team-uuid']);

      const media = created('a.jpg');
      calls[0].subject.next({ kind: 'done', body: media });
      await settle();
      expect(library.prepend).toHaveBeenCalledWith(media, 'products-uuid');
    });

    it('uploads into the library root without a folder', async () => {
      const { calls, library, upload } = await setup();
      library.folderUuid.set('');

      await upload(file('a.jpg'));

      expect(calls[0].opts).toEqual({ folderUuid: undefined });
      expect(screen.getByRole('heading', { name: 'Uploads to All media' })).toBeInTheDocument();
    });
  });

  describe('cancel', () => {
    it('aborts the request of a running upload and takes the row off', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('big.jpg', 'image/jpeg', 50 * 1024));
      expect(calls[0].subject.observed).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel the upload of big.jpg' }));
      await settle();

      expect(calls[0].subject.observed).toBe(false);
      expect(screen.queryByText('big.jpg')).toBeNull();
    });

    it('starts a waiting file when a running one is cancelled', async () => {
      const { calls, upload, settle } = await setup();
      await upload(...['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map((n) => file(n)));
      expect(calls).toHaveLength(3);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel the upload of 1.jpg' }));
      await settle();

      expect(calls.map((c) => c.file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
    });

    it('cancels a waiting file without ever sending it', async () => {
      const { calls, upload, settle } = await setup();
      await upload(...['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map((n) => file(n)));

      fireEvent.click(screen.getByRole('button', { name: 'Cancel the upload of 4.jpg' }));
      calls[0].subject.next({ kind: 'done', body: created('1.jpg') });
      await settle();

      expect(calls.map((c) => c.file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg']);
    });
  });

  describe('files that are refused before anything is sent', () => {
    it('refuses a type the project does not accept, naming the accepted ones, with Remove only', async () => {
      const { api, upload, settle } = await setup({ types: ['image/*', 'application/pdf'] });

      await upload(file('setup.exe', 'application/x-msdownload'));

      expect(api.uploadMediaWithProgress).not.toHaveBeenCalled();
      expect(screen.getByText('This file type isn’t accepted. Allowed: image/*, application/pdf.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('1 upload failed');

      fireEvent.click(screen.getByRole('button', { name: 'Remove setup.exe from the list' }));
      await settle();
      expect(screen.queryByText('setup.exe')).toBeNull();
    });

    it('accepts anything when the allow-list is `*`', async () => {
      const { api, upload } = await setup({ types: ['*'] });
      await upload(file('setup.exe', 'application/x-msdownload'));
      expect(api.uploadMediaWithProgress).toHaveBeenCalledTimes(1);
    });

    it('lets the server judge a file the browser could not type', async () => {
      const { api, upload } = await setup({ types: ['image/*'] });
      await upload(file('mystery', ''));
      expect(api.uploadMediaWithProgress).toHaveBeenCalledTimes(1);
    });

    it('refuses a file over the server’s limit and says by how much it is over', async () => {
      const { api, upload } = await setup({ maxBytes: 10 * MB });

      await upload(file('panorama.jpg', 'image/jpeg', 24.6 * MB));

      expect(api.uploadMediaWithProgress).not.toHaveBeenCalled();
      expect(screen.getByText('24.6 MB is over the limit of 10 MB per file.')).toBeInTheDocument();
    });

    it('sends a big file when the project detail does not tell a limit: the server decides', async () => {
      const { api, upload } = await setup({ maxBytes: null });
      await upload(file('panorama.jpg', 'image/jpeg', 24.6 * MB));
      expect(api.uploadMediaWithProgress).toHaveBeenCalledTimes(1);
    });

    it('refuses a name that is taken in the folder, whatever its case, and offers Replace and Keep both', async () => {
      const { api, upload } = await setup();

      await upload(file('YIRGACHEFFE.jpg'));

      expect(api.uploadMediaWithProgress).not.toHaveBeenCalled();
      expect(screen.getByText('A file with this name already exists in Products.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep both' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('does not mind the same name in another folder', async () => {
      const { api, library, upload } = await setup();
      library.folderUuid.set('team-uuid');
      await upload(file('yirgacheffe.jpg'));
      expect(api.uploadMediaWithProgress).toHaveBeenCalledTimes(1);
    });

    it('treats the same name twice in one drop as a clash, without Replace (nothing to replace yet)', async () => {
      const { calls, upload } = await setup();

      await upload(file('new.jpg'), file('new.jpg'));

      expect(calls).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Keep both' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    });
  });

  describe('a name that is taken', () => {
    it('Keep both uploads under the next free name', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('yirgacheffe.jpg'));

      fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
      await settle();

      expect(calls).toHaveLength(1);
      expect(calls[0].file.name).toBe('yirgacheffe-2.jpg');
      expect(calls[0].file.type).toBe('image/jpeg');
      calls[0].subject.next({ kind: 'done', body: created('yirgacheffe-2.jpg') });
      await settle();
      expect(screen.getByText('Uploaded as “yirgacheffe-2.jpg”')).toBeInTheDocument();
    });

    it('Keep both skips names that are taken as well', async () => {
      const { library, calls, upload, settle } = await setup();
      library.allMedia.update((all) => [...all, { ...all[0], uuid: 'two', displayName: 'yirgacheffe-2.jpg' }]);
      await upload(file('yirgacheffe.jpg'));

      fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
      await settle();

      expect(calls[0].file.name).toBe('yirgacheffe-3.jpg');
    });

    it('Replace swaps the existing file through its own endpoint, so links and usages stay', async () => {
      const { api, library, replaces, upload, settle } = await setup();
      await upload(file('yirgacheffe.jpg'));

      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
      await settle();

      expect(api.uploadMediaWithProgress).not.toHaveBeenCalled();
      expect(replaces[0].uuid).toBe('uuid-yirgacheffe-jpg');
      const media = created('yirgacheffe.jpg', { uuid: 'uuid-yirgacheffe-jpg', revision: 6 });
      replaces[0].subject.next({ kind: 'progress', loaded: 500, total: 1000 });
      await settle();
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
      replaces[0].subject.next({ kind: 'done', body: { media } });
      await settle();

      expect(library.onUpdated).toHaveBeenCalledWith(media);
      expect(library.prepend).not.toHaveBeenCalled();
      expect(screen.getByText('Uploaded — replaced the existing file')).toBeInTheDocument();
      // The replaced file keeps its own alt text: the panel does not ask for one.
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  describe('files the server refuses or loses', () => {
    const failWith = (call: Call, status: number, body: unknown = null) =>
      call.subject.error(new HttpErrorResponse({ status, statusText: 'x', error: body }));

    it('offers Retry for a lost connection and sends the file again', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('a.jpg'));

      failWith(calls[0], 0);
      await settle();
      expect(screen.getByText('Interrupted — the connection was lost.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await settle();

      expect(calls).toHaveLength(2);
      expect(calls[1].file.name).toBe('a.jpg');
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
      calls[1].subject.next({ kind: 'done', body: created('a.jpg') });
      await settle();
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    it('turns a 413 into the size message and a 415 into the type message, without Retry', async () => {
      const { calls, upload, settle } = await setup({ maxBytes: 100 * MB });
      await upload(file('a.jpg', 'image/jpeg', 2 * MB), file('b.bin', 'application/octet-stream'));

      failWith(calls[0], 413, { detail: 'Upload exceeds the configured media size limit.' });
      failWith(calls[1], 415, { detail: "MIME type 'x' is not allowed." });
      await settle();

      expect(screen.getByText('2 MB is over the limit of 100 MB per file.')).toBeInTheDocument();
      expect(screen.getByText('This file type isn’t accepted here.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('shows what the server said for any other problem, without Retry', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('a.jpg'));

      failWith(calls[0], 422, { title: 'Unprocessable Entity', detail: 'Image exceeds the maximum dimension of 12000px.' });
      await settle();

      expect(screen.getByText('Image exceeds the maximum dimension of 12000px.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Remove a.jpg from the list' })).toBeInTheDocument();
    });

    it('starts the next waiting file when one fails', async () => {
      const { calls, upload, settle } = await setup();
      await upload(...['1.jpg', '2.jpg', '3.jpg', '4.jpg'].map((n) => file(n)));

      failWith(calls[0], 500);
      await settle();

      expect(calls).toHaveLength(4);
    });
  });

  describe('alt text', () => {
    async function uploaded(options: SetupOptions = {}) {
      const ctx = await setup(options);
      await ctx.upload(file('latte.jpg'));
      ctx.calls[0].subject.next({ kind: 'done', body: created('latte.jpg') });
      await ctx.settle();
      return ctx;
    }

    it('asks for it inline after a picture and saves it on the file with its revision', async () => {
      const { api, library, settle } = await uploaded();
      const field = screen.getByRole('textbox', { name: 'Alt text for latte.jpg' });
      const save = screen.getByRole('button', { name: 'Save' });
      expect(save).toBeDisabled();

      fireEvent.input(field, { target: { value: 'Latte art on a wooden table' } });
      await settle();
      expect(save).toBeEnabled();
      fireEvent.click(save);
      await settle();

      expect(api.updateMediaMetadata).toHaveBeenCalledWith(
        'proj',
        'new-latte-jpg',
        { altText: 'Latte art on a wooden table', focalPoint: { x: 0.5, y: 0.5 } },
        5,
        undefined,
      );
      expect(library.onUpdated).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'new-latte-jpg', revision: 6 }));
      expect(screen.getByText('Uploaded · Alt text saved')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('saves for the language being edited', async () => {
      const { api, settle } = await uploaded({ locale: 'de' });
      fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Latte Art' } });
      await settle();

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await settle();

      expect(api.updateMediaMetadata.mock.calls[0][4]).toBe('de');
    });

    it('submits with Enter', async () => {
      const { api, settle } = await uploaded();
      const field = screen.getByRole('textbox');
      fireEvent.input(field, { target: { value: 'Latte' } });
      await settle();

      fireEvent.submit(field.closest('form')!);
      await settle();

      expect(api.updateMediaMetadata).toHaveBeenCalledTimes(1);
    });

    it('does not ask for a document', async () => {
      const { calls, upload, settle } = await setup();
      await upload(file('terms.pdf', 'application/pdf'));
      calls[0].subject.next({ kind: 'done', body: created('terms.pdf') });
      await settle();

      expect(screen.getByText('Uploaded')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('disables Save while the alt text is being saved', async () => {
      const { api, settle } = await uploaded();
      api.updateMediaMetadata.mockReturnValueOnce(new Subject() as never);
      fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Latte' } });
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await settle();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('opens the file’s details', async () => {
      const { library } = await uploaded();

      fireEvent.click(screen.getByRole('button', { name: 'Open the details of latte.jpg' }));

      expect(library.openAsset).toHaveBeenCalledWith('new-latte-jpg');
    });
  });

  describe('beside the drawer', () => {
    it('sits at the corner while no file is open and moves left of the drawer’s width plus 16px while one is', async () => {
      const { library, upload, settle, view } = await setup();
      await upload(file('a.jpg'));
      const host = view.fixture.nativeElement as HTMLElement;
      expect(host.style.insetInlineEnd).toBe('');

      const drawer = document.createElement('sf-drawer');
      const panel = document.createElement('section');
      panel.className = 'sf-drawer';
      panel.getBoundingClientRect = () => ({ width: 480 }) as DOMRect;
      drawer.appendChild(panel);
      document.body.appendChild(drawer);
      library.selectedMedia.set(created('a.jpg'));
      view.fixture.detectChanges();

      await waitFor(() => expect(host.style.insetInlineEnd).toBe('496px'));

      library.selectedMedia.set(null);
      view.fixture.detectChanges();
      await settle();
      await waitFor(() => expect(host.style.insetInlineEnd).toBe(''));
    });
  });

  describe('who may upload', () => {
    it('does nothing for a viewer and says why', async () => {
      const { api, store, toasts, settle } = await setup({ canUpload: false });
      const show = vi.spyOn(toasts, 'show');

      store.upload([file('a.jpg')]);
      await settle();

      expect(api.uploadMediaWithProgress).not.toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith('Viewers can’t upload files.', 'warning');
      expect(store.canUpload()).toBe(false);
    });

    it('gives the read-only reason in a read-only project', async () => {
      const { store } = await setup({ canUpload: false, readOnly: true });
      expect(store.blockedReason()).toBe('Archived project — read-only');
    });

    it('is open for an editor', async () => {
      const { store } = await setup();
      expect(store.blockedReason()).toBe('');
      expect(store.canUpload()).toBe(true);
    });
  });
});
