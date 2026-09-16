import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentService, etagFor, recordQueryParams } from './content.service';

describe('recordQueryParams', () => {
  it('repeats sort once per key as field,direction', () => {
    expect(
      recordQueryParams({
        page: 2,
        size: 50,
        sort: [
          { field: 'role', direction: 'desc' },
          { field: '_displayName', direction: 'asc' },
        ],
      }),
    ).toEqual({ page: '2', size: '50', sort: ['role,desc', '_displayName,asc'] });
  });

  it('leaves blank filters and the store root folder out', () => {
    expect(recordQueryParams({ page: 0, size: 25, sort: [], q: '  ', where: '', folder: '/' })).toEqual({
      page: '0',
      size: '25',
    });
  });

  it('trims filters it sends', () => {
    expect(
      recordQueryParams({ page: 0, size: 25, sort: [], q: ' ada ', where: " role == 'lead' ", folder: '/team/' }),
    ).toEqual({ page: '0', size: '25', q: 'ada', where: "role == 'lead'", folder: '/team/' });
  });
});

describe('ContentService', () => {
  let service: ContentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ContentService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists records with repeated sort params', () => {
    service
      .listRecords('p1', 'ds1', { page: 0, size: 50, sort: [{ field: 'role', direction: 'desc' }, { field: 'name', direction: 'asc' }] })
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/datasets/ds1/records');
    expect(req.request.params.getAll('sort')).toEqual(['role,desc', 'name,asc']);
    expect(req.request.params.get('size')).toBe('50');
    req.flush({ content: [], page: {} });
  });

  it('sends If-Match on record and dataset updates', () => {
    service.updateRecord('p1', 'r1', { content: { name: 'Ada' } }, etagFor(7)).subscribe();
    const record = httpMock.expectOne('/api/v1/projects/p1/records/r1');
    expect(record.request.method).toBe('PUT');
    expect(record.request.headers.get('If-Match')).toBe('"rev-7"');
    record.flush({});

    service
      .updateDataset('p1', 'd1', { displayName: 'Team', contentDefinition: '' }, etagFor(3))
      .subscribe();
    const dataset = httpMock.expectOne('/api/v1/projects/p1/datasets/d1');
    expect(dataset.request.headers.get('If-Match')).toBe('"rev-3"');
    dataset.flush({});
  });

  it('validates schema CDL with the dataset restrictions', () => {
    service.validateCdl('p1', 'content {}').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/cdl/validate');
    expect(req.request.params.get('kind')).toBe('DATASET');
    req.flush({ diagnostics: [] });
  });

  it('reads a record at a revision for time travel', () => {
    service.getRecord('p1', 'r1', 12).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/records/r1');
    expect(req.request.params.get('revision')).toBe('12');
    req.flush({});
  });

  it('scopes folders to the Content store', () => {
    service.folders('p1').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/folders');
    expect(req.request.params.get('scope')).toBe('CONTENT');
    req.flush([]);
  });
});
