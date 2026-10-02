import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { NO_HISTORY_FILTER } from './history-model';
import { HistoryService } from './history.service';

function setup() {
  TestBed.configureTestingModule({ providers: [provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()] });
  return { service: TestBed.inject(HistoryService), http: TestBed.inject(HttpTestingController) };
}

const revision = { revisionId: 90, createdAt: '2026-10-02T10:00:00Z', createdBy: 4, createdByName: 'Anna Berger', changeType: 'UPDATE', summary: { assets: [] } };

describe('HistoryService.list', () => {
  it('asks for a page, with the filter in the database query — one changeType per type of the kind', () => {
    const { service, http } = setup();
    service
      .list('acme', { filter: { by: 4, kind: 'release', date: { range: 'custom', from: '2026-09-01', to: null }, q: 'harvest' }, assetUuid: 'u-1', page: 2, size: 25 })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/projects/acme/revisions');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe('25');
    expect(req.request.params.get('userId')).toBe('4');
    expect(req.request.params.get('q')).toBe('harvest');
    expect(req.request.params.get('assetUuid')).toBe('u-1');
    expect(req.request.params.getAll('changeType')).toEqual(['RELEASE', 'UNPUBLISH']);
    expect(req.request.params.get('from')).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(req.request.params.has('to')).toBe(false);
    req.flush([]);
  });

  it('sends nothing for an empty filter', () => {
    const { service, http } = setup();
    service.list('acme', { filter: NO_HISTORY_FILTER, page: 0, size: 50 }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/projects/acme/revisions');
    expect(req.request.params.keys().sort()).toEqual(['page', 'size']);
    req.flush([]);
  });

  it('maps the revisions to rows and reads the total from X-Total-Count', () => {
    const { service, http } = setup();
    let page: unknown;
    service.list('acme', { filter: NO_HISTORY_FILTER, page: 0, size: 1 }).subscribe((p) => (page = p));
    http.expectOne((r) => r.url === '/api/v1/projects/acme/revisions').flush([revision], { headers: { 'X-Total-Count': '137' } });
    expect(page).toMatchObject({ total: 137, rows: [{ id: 90, byName: 'Anna Berger', kind: 'edit' }] });
  });

  it('falls back to the rows it got when the header is missing, and names a removed author', () => {
    const { service, http } = setup();
    let page: unknown;
    service.list('acme', { filter: NO_HISTORY_FILTER, page: 0, size: 50 }).subscribe((p) => (page = p));
    http.expectOne((r) => r.url === '/api/v1/projects/acme/revisions').flush([{ ...revision, createdByName: null }]);
    expect(page).toMatchObject({ total: 1, rows: [{ byName: 'Unknown user' }] });
  });
});

describe('HistoryService other calls', () => {
  it('diffs an item from a revision against now, or against another revision', () => {
    const { service, http } = setup();
    service.assetDiff('acme', 'u-1', 88).subscribe();
    const now = http.expectOne((r) => r.url === '/api/v1/projects/acme/assets/u-1/diff');
    expect(now.request.params.get('from')).toBe('88');
    expect(now.request.params.has('to')).toBe(false);
    now.flush({});

    service.assetDiff('acme', 'u-1', 88, 90).subscribe();
    expect(http.expectOne((r) => r.url === '/api/v1/projects/acme/assets/u-1/diff').request.params.get('to')).toBe('90');
  });

  it('rolls back with the target revision', () => {
    const { service, http } = setup();
    service.rollBack('acme', 71).subscribe();
    const req = http.expectOne('/api/v1/projects/acme/restore');
    expect(req.request.body).toMatchObject({ toRevision: 71 });
    req.flush(revision);
  });

  it('restores an item from a revision', () => {
    const { service, http } = setup();
    service.restoreAsset('acme', 'u-1', 71).subscribe();
    const req = http.expectOne('/api/v1/projects/acme/assets/u-1/restore');
    expect(req.request.body).toEqual({ fromRevision: 71 });
    req.flush({});
  });
});
