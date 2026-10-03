import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectContextStore } from '../project/project-context.store';
import { ToastService } from '../ui/toast.service';
import { ApiClient, type Transfer } from './api.client';
import { errorInterceptor } from './error.interceptor';
import type { components } from './generated/schema.d.ts';

type MediaView = components['schemas']['MediaView'];

describe('ApiClient uploads with progress', () => {
  let api: ApiClient;
  let httpMock: HttpTestingController;
  let toasts: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([errorInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    api = TestBed.inject(ApiClient);
    httpMock = TestBed.inject(HttpTestingController);
    toasts = TestBed.inject(ToastService);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
  });

  const file = new File(['abcdef'], 'logo.png', { type: 'image/png' });
  const created: MediaView = { uuid: 'new-uuid', uid: 'logo-png', displayName: 'logo.png', revision: 7, mimeType: 'image/png', sizeBytes: 6 };

  it('posts the file to the folder and reports progress before the created file', () => {
    const events: Transfer<MediaView>[] = [];
    api.uploadMediaWithProgress('proj', file, { folderUuid: 'folder-1' }).subscribe((e) => events.push(e));

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj/media');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('folderUuid')).toBe('folder-1');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    expect(req.request.reportProgress).toBe(true);

    req.event({ type: 1, loaded: 3, total: 6 }); // HttpEventType.UploadProgress
    req.flush(created, { status: 201, statusText: 'Created' });

    expect(events).toEqual([
      { kind: 'progress', loaded: 3, total: 6 },
      { kind: 'done', body: created },
    ]);
  });

  it('aborts the request when the subscriber unsubscribes', () => {
    const sub = api.uploadMediaWithProgress('proj', file).subscribe();
    const req = httpMock.expectOne('/api/v1/projects/proj/media');
    sub.unsubscribe();
    expect(req.cancelled).toBe(true);
  });

  it('does not toast a failed upload: the panel explains it', () => {
    const show = vi.spyOn(toasts, 'show');
    let error: unknown;
    api.uploadMediaWithProgress('proj', file).subscribe({ error: (e) => (error = e) });
    httpMock
      .expectOne('/api/v1/projects/proj/media')
      .flush({ title: 'Payload Too Large', status: 413, detail: 'Upload exceeds the configured media size limit.' }, { status: 413, statusText: 'Payload Too Large' });
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(413);
    expect(show).not.toHaveBeenCalled();
  });

  it('replaces a file with progress', () => {
    const events: Transfer<components['schemas']['MediaSaveResponse']>[] = [];
    api.replaceMediaWithProgress('proj', 'old-uuid', file).subscribe((e) => events.push(e));
    const req = httpMock.expectOne('/api/v1/projects/proj/media/old-uuid/replace');
    expect(req.request.method).toBe('POST');
    req.event({ type: 1, loaded: 6, total: 6 });
    req.flush({ media: created });
    expect(events.map((e) => e.kind)).toEqual(['progress', 'done']);
  });

  it('keeps the plain uploadMedia working', () => {
    let result: MediaView | undefined;
    api.uploadMedia('proj', file, { folderUuid: 'f' }).subscribe((m) => (result = m));
    httpMock.expectOne((r) => r.url === '/api/v1/projects/proj/media').flush(created);
    expect(result).toEqual(created);
  });
});
