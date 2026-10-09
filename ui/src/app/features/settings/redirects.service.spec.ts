import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { RedirectsService } from './redirects.service';

const BASE = '/api/v1/projects/proj/redirects';

describe('RedirectsService', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    return { service: TestBed.inject(RedirectsService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('lists with the filters that are set, noLocale among them, and leaves the empty ones out', () => {
    const { service, http } = setup();

    service.list('proj', { channel: 'files', locale: '', noLocale: true, kind: 'MANUAL', q: '', page: 2, size: 50 }).subscribe();

    const request = http.expectOne((r) => r.url === BASE);
    expect(request.request.params.keys().sort()).toEqual(['channel', 'kind', 'noLocale', 'page', 'size']);
    expect(request.request.params.get('noLocale')).toBe('true');
    request.flush({});
  });

  it('deletes every manual redirect with kind=MANUAL, and no If-Match', () => {
    const { service, http } = setup();
    let deleted = -1;

    service.deleteAllManual('proj').subscribe((result) => (deleted = result.deleted));

    const request = http.expectOne((r) => r.url === BASE);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.params.get('kind')).toBe('MANUAL');
    expect(request.request.headers.has('If-Match')).toBe(false);
    request.flush({ deleted: 4 });
    expect(deleted).toBe(4);
  });

  it('replaces and deletes one redirect at the version read', () => {
    const { service, http } = setup();

    service.update('proj', 7, 3, { fromPath: 'a.html', toPath: 'b.html' }).subscribe();
    service.delete('proj', 7, 3).subscribe();

    const [put, remove] = http.match(`${BASE}/7`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.headers.get('If-Match')).toBe('"v3"');
    expect(remove.request.method).toBe('DELETE');
    expect(remove.request.headers.get('If-Match')).toBe('"v3"');
    put.flush({});
    remove.flush(null);
  });
});
