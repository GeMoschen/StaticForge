import '@angular/compiler';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { readonlyInterceptor } from './readonly.interceptor';

describe('readonlyInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let timeTravel: TimeTravelStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([readonlyInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    timeTravel = TestBed.inject(TimeTravelStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('rejects mutating project-scoped requests while time travel is active, without reaching the backend', () => {
    timeTravel.enter(5);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      let errored = false;
      http
        .request(method, '/api/v1/projects/proj1/pages/abc')
        .subscribe({ error: () => (errored = true) });
      expect(errored).toBe(true);
    }

    httpMock.expectNone('/api/v1/projects/proj1/pages/abc');
  });

  it('lets GET requests through unaffected while time travel is active', () => {
    timeTravel.enter(5);

    let result: unknown;
    http.get('/api/v1/projects/proj1/pages/abc').subscribe((r) => (result = r));

    const req = httpMock.expectOne('/api/v1/projects/proj1/pages/abc');
    expect(req.request.method).toBe('GET');
    req.flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('exempts restore endpoints so viewing-a-revision restore/rollback keeps working', () => {
    timeTravel.enter(5);

    let result: unknown;
    http
      .post('/api/v1/projects/proj1/assets/abc/restore', { fromRevision: 5 })
      .subscribe((r) => (result = r));
    const assetReq = httpMock.expectOne('/api/v1/projects/proj1/assets/abc/restore');
    assetReq.flush({ ok: true });
    expect(result).toEqual({ ok: true });

    http
      .post('/api/v1/projects/proj1/restore', { toRevision: 5 })
      .subscribe((r) => (result = r));
    const projectReq = httpMock.expectOne('/api/v1/projects/proj1/restore');
    projectReq.flush({ ok: true });
    expect(result).toEqual({ ok: true });
  });

  it('lets every method through unaffected when time travel is not active', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'] as const) {
      http.request(method, '/api/v1/projects/proj1/pages/abc').subscribe();
      httpMock.expectOne('/api/v1/projects/proj1/pages/abc').flush({});
    }
  });

  it('never blocks non-project requests (auth) even during time travel', () => {
    timeTravel.enter(5);

    http.post('/api/v1/auth/refresh', null).subscribe();
    httpMock.expectOne('/api/v1/auth/refresh').flush({});
  });
});
