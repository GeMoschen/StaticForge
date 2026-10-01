import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AuthStore } from '../../core/auth/auth.store';
import { SF_DEV_BUILD, styleguideGuard } from './styleguide.guard';

function run(devBuild: boolean, auth: { authenticated: boolean; admin: boolean }): boolean | UrlTree {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SF_DEV_BUILD, useValue: devBuild },
      { provide: AuthStore, useValue: { isAuthenticated: () => auth.authenticated, isInstanceAdmin: () => auth.admin } },
    ],
  });
  return TestBed.runInInjectionContext(() => styleguideGuard({}, [])) as boolean | UrlTree;
}

const url = (result: boolean | UrlTree) => (result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result);

describe('styleguideGuard', () => {
  it('is open to everyone in a development build', () => {
    expect(run(true, { authenticated: false, admin: false })).toBe(true);
  });

  it('lets instance admins in on a production build', () => {
    expect(run(false, { authenticated: true, admin: true })).toBe(true);
  });

  it('sends other users to the dashboard and signed-out visitors to the login', () => {
    expect(url(run(false, { authenticated: true, admin: false }))).toBe('/');
    TestBed.resetTestingModule();
    expect(url(run(false, { authenticated: false, admin: false }))).toBe('/login?returnUrl=%2Fstyleguide');
  });
});
