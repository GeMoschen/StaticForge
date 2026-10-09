import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import { UrlRegistryService } from './url-registry.service';

const BASE = '/api/v1/projects/proj/url-registry';

describe('UrlRegistryService', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    return { service: TestBed.inject(UrlRegistryService), http: TestBed.inject(HttpTestingController) };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('asks for the rows without a language with noLocale, which wins over a language', () => {
    const { service, http } = setup();

    service.list('proj', { noLocale: true, locale: 'de', channelKey: 'html' }).subscribe();

    const request = http.expectOne((r) => r.url === BASE);
    expect(request.request.params.get('noLocale')).toBe('true');
    expect(request.request.params.has('locale')).toBe(false);
    expect(request.request.params.get('channelKey')).toBe('html');
    request.flush({});
  });

  it('still lists the rows without a language with an empty locale', () => {
    const { service, http } = setup();

    service.list('proj', { locale: '' }).subscribe();

    const request = http.expectOne((r) => r.url === BASE);
    expect(request.request.params.get('locale')).toBe('');
    request.flush({});
  });

  it('leaves the failure of an override or a reset to the caller when asked to be quiet', () => {
    const { service, http } = setup();

    service.override('proj', 3, '/a.html', true).subscribe();
    service.reset('proj', { area: 'PREVIEW' }, true).subscribe();
    service.override('proj', 3, '/a.html').subscribe();

    const [quietOverride, loudOverride] = http.match(`${BASE}/3`);
    const quietReset = http.expectOne(`${BASE}/reset`);
    expect(quietOverride.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    expect(quietReset.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    expect(loudOverride.request.context.get(SKIP_ERROR_TOAST)).toBe(false);
    quietOverride.flush({});
    quietReset.flush(null);
    loudOverride.flush({});
  });
});
