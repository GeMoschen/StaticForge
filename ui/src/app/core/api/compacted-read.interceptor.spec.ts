import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { compactedReadInterceptor } from './compacted-read.interceptor';

const BASE = '/api/v1/projects/proj';

describe('compactedReadInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let timeTravel: TimeTravelStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([compactedReadInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    timeTravel = TestBed.inject(TimeTravelStore);
    timeTravel.enter(12);
  });

  it('notes a typed read at the revision that carries X-SF-Compacted: true', () => {
    http.get(`${BASE}/media/m-1`, { params: { revision: 12 } }).subscribe();
    backend.expectOne(`${BASE}/media/m-1?revision=12`).flush({ uuid: 'm-1' }, { headers: { 'X-SF-Compacted': 'true' } });

    expect(timeTravel.readCompacted()).toBe(true);
  });

  it('notes an asset version read whose AssetDetailView says compacted', () => {
    http.get(`${BASE}/assets/a-1/versions/12`).subscribe();
    backend.expectOne(`${BASE}/assets/a-1/versions/12`).flush({ uuid: 'a-1', revision: 9, compacted: true });

    expect(timeTravel.readCompacted()).toBe(true);
  });

  it('ignores exact reads, reads at another revision and reads without a revision', () => {
    http.get(`${BASE}/media/m-1`, { params: { revision: 12 } }).subscribe();
    backend.expectOne(`${BASE}/media/m-1?revision=12`).flush({ uuid: 'm-1' });
    http.get(`${BASE}/assets/a-1/versions/12`).subscribe();
    backend.expectOne(`${BASE}/assets/a-1/versions/12`).flush({ uuid: 'a-1', compacted: false });
    http.get(`${BASE}/datasets/d-1`, { params: { revision: 11 } }).subscribe();
    backend.expectOne(`${BASE}/datasets/d-1?revision=11`).flush({}, { headers: { 'X-SF-Compacted': 'true' } });
    // The current state never says compacted; a revision body's own flag is not a read at a revision.
    http.get(`${BASE}/revisions/12`).subscribe();
    backend.expectOne(`${BASE}/revisions/12`).flush({ revisionId: 12, compacted: true });

    expect(timeTravel.readCompacted()).toBe(false);
    backend.verify();
  });
});
