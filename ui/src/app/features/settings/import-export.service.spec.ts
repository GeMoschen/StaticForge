import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictReportView,
  extractConflicts,
  ImportExportService,
  ImportResultView,
} from './import-export.service';

describe('ImportExportService', () => {
  let service: ImportExportService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ImportExportService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ImportExportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('exportSelection posts JSON and expects a blob response', () => {
    const selection = { assetUuids: ['a-1', 'a-2'], includeChannels: true };
    let result: Blob | undefined;

    service.exportSelection('proj1', selection).subscribe((blob) => (result = blob));

    const req = httpMock.expectOne('/api/v1/projects/proj1/export/selection');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(selection);
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.responseType).toBe('blob');

    const blob = new Blob(['zip-bytes']);
    req.flush(blob);

    expect(result).toBe(blob);
  });

  it('analyzeImport posts multipart form data and returns the conflict report', () => {
    const file = new File(['content'], 'export.zip', { type: 'application/zip' });
    let result: ConflictReportView | undefined;

    service.analyzeImport('proj1', file).subscribe((report) => (result = report));

    const req = httpMock.expectOne('/api/v1/projects/proj1/import/analyze');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('file')).toBe(file);
    expect((req.request.body as FormData).get('skipExistingImplicit')).toBe('false');

    const report: ConflictReportView = {
      hasBlocking: true,
      conflicts: [{ severity: 'BLOCKING', type: 'UUID_COLLISION', elementUuid: 'u-1' }],
    };
    req.flush(report);

    expect(result).toEqual(report);
  });

  it('analyzeImport appends skipExistingImplicit=true when passed', () => {
    const file = new File(['content'], 'export.zip', { type: 'application/zip' });

    service.analyzeImport('proj1', file, true).subscribe();

    const req = httpMock.expectOne('/api/v1/projects/proj1/import/analyze');
    expect((req.request.body as FormData).get('skipExistingImplicit')).toBe('true');
    req.flush({ conflicts: [], hasBlocking: false });
  });

  it('sends releaseMode (M27.5.2): KEEP by default, DRAFT when asked, on analyze and on import', () => {
    const file = new File(['content'], 'export.zip', { type: 'application/zip' });

    service.analyzeImport('proj1', file).subscribe();
    const keep = httpMock.expectOne('/api/v1/projects/proj1/import/analyze');
    expect((keep.request.body as FormData).get('releaseMode')).toBe('KEEP');
    keep.flush({ conflicts: [], hasBlocking: false, blocksImport: false, releaseState: true, releaseMode: 'KEEP' });

    service.commitImport('proj1', file, false, 'DRAFT').subscribe();
    const draft = httpMock.expectOne('/api/v1/projects/proj1/import');
    expect((draft.request.body as FormData).get('releaseMode')).toBe('DRAFT');
    draft.flush({ sourceProjectKey: 'src1', importedAssetCount: 1, updatedAssetCount: 0, importedBlobCount: 0, releasedCount: 0 });
  });

  it('commitImport posts multipart form data and returns the import result', () => {
    const file = new File(['content'], 'export.zip', { type: 'application/zip' });
    let result: ImportResultView | undefined;

    service.commitImport('proj1', file).subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/v1/projects/proj1/import');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('file')).toBe(file);
    expect((req.request.body as FormData).get('skipExistingImplicit')).toBe('false');

    const importResult: ImportResultView = {
      sourceProjectKey: 'src1',
      importedAssetCount: 3,
      importedBlobCount: 5,
    };
    req.flush(importResult);

    expect(result).toEqual(importResult);
  });

  it('commitImport surfaces a 409 conflict body so extractConflicts can read it', () => {
    const file = new File(['content'], 'export.zip', { type: 'application/zip' });
    let caught: unknown;

    service.commitImport('proj1', file).subscribe({
      next: () => {
        throw new Error('expected an error');
      },
      error: (err) => (caught = err),
    });

    const req = httpMock.expectOne('/api/v1/projects/proj1/import');
    const conflicts = [{ severity: 'BLOCKING', type: 'UUID_COLLISION', elementUuid: 'u-1' }];
    req.flush({ conflicts }, { status: 409, statusText: 'Conflict' });

    expect(extractConflicts(caught)).toEqual(conflicts);
  });
});

describe('extractConflicts', () => {
  it('returns the conflicts array from a 409 error response', () => {
    const conflicts = [{ severity: 'WARNING', type: 'LABEL_COLLISION', elementUuid: 'u-2' }];
    const error = new HttpErrorResponse({
      status: 409,
      statusText: 'Conflict',
      error: { conflicts },
    });

    expect(extractConflicts(error)).toEqual(conflicts);
  });

  it('returns null for a non-409 error', () => {
    const error = new HttpErrorResponse({
      status: 500,
      statusText: 'Internal Server Error',
      error: { conflicts: [{ severity: 'BLOCKING', type: 'X' }] },
    });

    expect(extractConflicts(error)).toBeNull();
  });

  it('returns null for a 409 error with no conflicts field', () => {
    const error = new HttpErrorResponse({
      status: 409,
      statusText: 'Conflict',
      error: { detail: 'generic conflict' },
    });

    expect(extractConflicts(error)).toBeNull();
  });

  it('returns null for a non-HttpErrorResponse error', () => {
    expect(extractConflicts(new Error('boom'))).toBeNull();
  });
});
