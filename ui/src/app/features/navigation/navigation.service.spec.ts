import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { NavigationService } from './navigation.service';

describe('NavigationService', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    return { service: TestBed.inject(NavigationService), http: TestBed.inject(HttpTestingController) };
  }

  it('stores a folder\'s child order with PUT …/folders/{uuid}/order, sending the revision as If-Match', () => {
    const { service, http } = setup();
    let revision: number | undefined;
    service.reorderChildren('proj', 'f1', ['b', 'a'], '"rev-4"').subscribe((view) => (revision = view.revision));

    const request = http.expectOne('/api/v1/projects/proj/navigation/folders/f1/order');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ childUuids: ['b', 'a'] });
    expect(request.request.headers.get('If-Match')).toBe('"rev-4"');
    request.flush({ uuid: 'f1', revision: 5 });
    expect(revision).toBe(5);
  });

  it('an empty list clears the stored order', () => {
    const { service, http } = setup();
    service.reorderChildren('proj', 'f1', []).subscribe();
    const request = http.expectOne('/api/v1/projects/proj/navigation/folders/f1/order');
    expect(request.request.body).toEqual({ childUuids: [] });
    request.flush({});
  });

  it('reads the page rows of the URL registry quietly (no error toast)', () => {
    const { service, http } = setup();
    service.pageUrlRows('proj', 2, 100).subscribe();
    const request = http.expectOne((r) => r.url === '/api/v1/projects/proj/url-registry');
    expect(request.request.params.get('targetType')).toBe('PAGE');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('size')).toBe('100');
    request.flush({ content: [], last: true });
  });
});
