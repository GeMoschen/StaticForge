import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentService, etagFor, recordQueryParams, recordSetGridParams } from './content.service';

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

describe('record set grid params (M25)', () => {
  it('asks for the set query only in "Show as rendered"', () => {
    expect(recordSetGridParams({ page: 0, size: 50, sort: [], applySetQuery: true })).toEqual({
      page: '0',
      size: '50',
      applySetQuery: 'true',
    });
    expect(recordSetGridParams({ page: 0, size: 50, sort: [], applySetQuery: false })).toEqual({ page: '0', size: '50' });
    expect(recordSetGridParams({ page: 0, size: 50, sort: [], applySetQuery: false, revision: 12 })).toEqual({
      page: '0',
      size: '50',
      revision: '12',
    });
    expect(recordSetGridParams({ page: 0, size: 50, sort: [], applySetQuery: false, revision: null })).toEqual({
      page: '0',
      size: '50',
    });
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

  /** M25: a record is created in a set — the pre-M25 `folderUuid` body is a 400 now. */
  it('creates a record in its record set', () => {
    service.createRecord('p1', 'ds1', { recordSetUuid: 'set1', displayName: 'Ada', content: {} }).subscribe();

    const req = httpMock.expectOne('/api/v1/projects/p1/datasets/ds1/records');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ recordSetUuid: 'set1', displayName: 'Ada', content: {} });
    expect(req.request.body).not.toHaveProperty('folderUuid');
    req.flush({});
  });

  it('creates, updates with If-Match, previews and deletes record sets', () => {
    service.createRecordSet('p1', { folderUuid: 'f1', datasetUuid: 'ds1', displayName: 'Leads' }).subscribe();
    const create = httpMock.expectOne('/api/v1/projects/p1/record-sets');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ folderUuid: 'f1', datasetUuid: 'ds1', displayName: 'Leads' });
    create.flush({});

    service.updateRecordSet('p1', 's1', { query: { where: "role == 'lead'" } }, etagFor(4)).subscribe();
    const update = httpMock.expectOne('/api/v1/projects/p1/record-sets/s1');
    expect(update.request.method).toBe('PUT');
    expect(update.request.headers.get('If-Match')).toBe('"rev-4"');
    update.flush({});

    service.previewSetQuery('p1', 's1', { sort: '-joined', limit: 3 }).subscribe();
    const preview = httpMock.expectOne('/api/v1/projects/p1/record-sets/s1/preview-query');
    expect(preview.request.method).toBe('POST');
    expect(preview.request.body).toEqual({ sort: '-joined', limit: 3 });
    preview.flush({ valid: true, diagnostics: [], matchCount: 3, selectedCount: 3 });

    service.deleteRecordSet('p1', 's1', true).subscribe();
    const remove = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/record-sets/s1');
    expect(remove.request.method).toBe('DELETE');
    expect(remove.request.params.get('cascade')).toBe('true');
    remove.flush(null);
  });

  it("lists a set's records, with the set query applied on request", () => {
    service.listSetRecords('p1', 's1', { page: 1, size: 50, sort: [], applySetQuery: true }).subscribe();

    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/record-sets/s1/records');
    expect(req.request.params.get('applySetQuery')).toBe('true');
    expect(req.request.params.get('page')).toBe('1');
    req.flush({ content: [], page: {} });
  });

  it('lists the record sets of one dataset and reads a set at a revision', () => {
    service.listRecordSets('p1', 'ds1').subscribe();
    const list = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/record-sets');
    expect(list.request.params.get('dataset')).toBe('ds1');
    list.flush([]);

    service.getRecordSet('p1', 's1', 9).subscribe();
    const get = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/record-sets/s1');
    expect(get.request.params.get('revision')).toBe('9');
    get.flush({});
  });

  it('scopes folders to the Content store', () => {
    service.folders('p1').subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/projects/p1/folders');
    expect(req.request.params.get('scope')).toBe('CONTENT');
    req.flush([]);
  });
});
