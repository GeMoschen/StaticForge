import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GlobalsService, etagFor } from './globals.service';

describe('GlobalsService', () => {
  let service: GlobalsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GlobalsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GlobalsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists the project’s property sets', () => {
    service.list('proj1').subscribe();

    const req = httpMock.expectOne('/api/v1/projects/proj1/globals');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(true);
    req.flush([]);
  });

  it('scopes the list to one folder when asked', () => {
    service.list('proj1', 'folder-uuid').subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/globals');
    expect(req.request.params.get('folder')).toBe('folder-uuid');
    req.flush([]);
  });

  /** Time travel reads the version valid at a past revision rather than the current one. */
  it('passes the revision through when reading a set', () => {
    service.get('proj1', 'set-uuid', 7).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/globals/set-uuid');
    expect(req.request.params.get('revision')).toBe('7');
    req.flush({});
  });

  it('omits the revision parameter for a live read', () => {
    service.get('proj1', 'set-uuid').subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/globals/set-uuid');
    expect(req.request.params.has('revision')).toBe(false);
    req.flush({});
  });

  /**
   * Schema and values are separate endpoints because they carry separate permissions; a single
   * PUT would force the server to infer the role from which fields changed.
   */
  it('puts the schema to /schema with If-Match', () => {
    service.updateSchema('proj1', 'set-uuid', 'content { }', etagFor(4)).subscribe();

    const req = httpMock.expectOne('/api/v1/projects/proj1/globals/set-uuid/schema');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ contentDefinition: 'content { }' });
    expect(req.request.headers.get('If-Match')).toBe('"rev-4"');
    req.flush({});
  });

  it('puts the values to /content with If-Match', () => {
    service.updateContent('proj1', 'set-uuid', { title: 'Acme' }, etagFor(9)).subscribe();

    const req = httpMock.expectOne('/api/v1/projects/proj1/globals/set-uuid/content');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ content: { title: 'Acme' } });
    expect(req.request.headers.get('If-Match')).toBe('"rev-9"');
    req.flush({});
  });

  it('creates a set with its starting CDL', () => {
    service
      .create('proj1', { displayName: 'Site', contentDefinition: 'content { }', parentFolderUuid: 'f-1' })
      .subscribe();

    const req = httpMock.expectOne('/api/v1/projects/proj1/globals');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      displayName: 'Site',
      contentDefinition: 'content { }',
      parentFolderUuid: 'f-1',
    });
    req.flush({});
  });

  /** Without `kind=GLOBAL_SET` the editor would green-light CDL the save then rejects. */
  it('validates CDL with the property-set restrictions applied', () => {
    service.validateCdl('proj1', 'content { }').subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/cdl/validate');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('kind')).toBe('GLOBAL_SET');
    req.flush({ diagnostics: [] });
  });

  /** Folders reuse the generic endpoints, so the Globals store adds no folder API of its own. */
  it('reads and creates folders through the generic /folders endpoints with scope=GLOBALS', () => {
    service.folders('proj1').subscribe();
    const read = httpMock.expectOne((r) => r.url === '/api/v1/projects/proj1/folders');
    expect(read.request.params.get('scope')).toBe('GLOBALS');
    expect(read.request.params.get('depth')).toBe('10');
    read.flush([]);

    service.createFolder('proj1', 'Branding', 'parent-uuid').subscribe();
    const create = httpMock.expectOne('/api/v1/projects/proj1/folders');
    expect(create.request.body).toEqual({
      displayName: 'Branding',
      parentFolderUuid: 'parent-uuid',
      scope: 'GLOBALS',
    });
    create.flush({});
  });

  it('moves a set through the generic asset-move endpoint', () => {
    service.moveSet('proj1', 'set-uuid', 'folder-uuid').subscribe();

    const req = httpMock.expectOne('/api/v1/projects/proj1/assets/set-uuid/move');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ folderUuid: 'folder-uuid' });
    req.flush({});
  });

  it('formats the ETag exactly as the backend writes it', () => {
    expect(etagFor(12)).toBe('"rev-12"');
  });
});
