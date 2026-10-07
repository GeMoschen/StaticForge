import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api.client';

describe('ApiClient.renameAsset', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the given revision as If-Match', () => {
    api.renameAsset('p', 'a1', { displayName: 'New' }, 4).subscribe();
    const req = http.expectOne('/api/v1/projects/p/assets/a1/display-name');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.headers.get('If-Match')).toBe('"rev-4"');
    req.flush({ revision: 5 });
  });

  it('reads the current revision first when none is given, then sends it as If-Match', () => {
    let result: { revision?: number } | undefined;
    api.renameAsset('p', 'a1', { displayName: 'New' }).subscribe((r) => (result = r));
    http.expectOne('/api/v1/projects/p/assets/a1').flush({ uuid: 'a1', revision: 7 });
    const req = http.expectOne('/api/v1/projects/p/assets/a1/display-name');
    expect(req.request.headers.get('If-Match')).toBe('"rev-7"');
    req.flush({ revision: 8 });
    expect(result?.revision).toBe(8);
  });
});

describe('ApiClient.renameFolder', () => {
  it('reads the current revision first when none is given', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(ApiClient);
    const http = TestBed.inject(HttpTestingController);
    api.renameFolder('p', 'f1', { displayName: 'News' }).subscribe();
    http.expectOne('/api/v1/projects/p/assets/f1').flush({ uuid: 'f1', revision: 3 });
    const req = http.expectOne('/api/v1/projects/p/folders/f1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.headers.get('If-Match')).toBe('"rev-3"');
    req.flush({ uuid: 'f1', revision: 4 });
    http.verify();
  });
});
