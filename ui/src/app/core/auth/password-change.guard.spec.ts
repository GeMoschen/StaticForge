import '@angular/compiler';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from './auth.store';
import { passwordChangeGuard, returnUrlParams, setPasswordGuard } from './password-change.guard';
import { passwordRequiredInterceptor } from './password-required.interceptor';

@Component({ standalone: true, template: '' })
class BlankComponent {}

describe('forced password change', () => {
  let router: Router;
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'account/set-password', canMatch: [setPasswordGuard], component: BlankComponent },
          { path: 'p/:projectKey/pages', canMatch: [passwordChangeGuard], component: BlankComponent },
          { path: '', canMatch: [passwordChangeGuard], component: BlankComponent },
        ]),
        provideHttpClient(withInterceptors([passwordRequiredInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    router = TestBed.inject(Router);
    store = TestBed.inject(AuthStore);
  });

  it('sends every route to the password screen while a change is pending, keeping the target', async () => {
    store.mustChangePassword.set(true);

    await router.navigateByUrl('/p/acme/pages?body=main');

    expect(router.url).toBe('/account/set-password?returnUrl=%2Fp%2Facme%2Fpages%3Fbody%3Dmain');
  });

  it('lets routes through once the change is done, and keeps the password screen for pending changes only', async () => {
    await router.navigateByUrl('/p/acme/pages');
    expect(router.url).toBe('/p/acme/pages');

    await router.navigateByUrl('/account/set-password');
    expect(router.url).toBe('/');
  });

  it('goes to the password screen on a 428 from any request, with the current URL to return to', async () => {
    await router.navigateByUrl('/p/acme/pages');
    const http = TestBed.inject(HttpClient);
    const httpMock = TestBed.inject(HttpTestingController);
    let failed = false;

    http.get('/api/v1/projects/acme').subscribe({ error: () => (failed = true) });
    httpMock
      .expectOne('/api/v1/projects/acme')
      .flush({ code: 'SF-API-0428', title: 'Password change required' }, { status: 428, statusText: 'x' });
    await new Promise((resolve) => setTimeout(resolve));

    expect(failed).toBe(true);
    expect(store.mustChangePassword()).toBe(true);
    expect(router.url).toBe('/account/set-password?returnUrl=%2Fp%2Facme%2Fpages');
  });

  it('keeps only URLs worth returning to', () => {
    expect(returnUrlParams('/p/acme/pages')).toEqual({ returnUrl: '/p/acme/pages' });
    expect(returnUrlParams('/')).toEqual({});
    expect(returnUrlParams('/account/set-password?returnUrl=x')).toEqual({});
    expect(returnUrlParams('https://evil.example')).toEqual({});
  });
});
