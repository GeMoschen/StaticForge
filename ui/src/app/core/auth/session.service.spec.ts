import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api.client';
import type { components } from '../api/generated/schema.d.ts';
import { AuthStore } from './auth.store';
import { SessionService } from './session.service';

type MeResponse = components['schemas']['MeResponse'];

const me: MeResponse = { id: 7, username: 'ada', displayName: 'Ada', systemRole: 'USER', mustChangePassword: true };

describe('SessionService', () => {
  let api: {
    logout: ReturnType<typeof vi.fn>;
    revokeAllSessions: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
  };
  let store: AuthStore;
  let router: Router;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    api = {
      logout: vi.fn().mockReturnValue(of(undefined)),
      revokeAllSessions: vi.fn().mockReturnValue(of(undefined)),
      changePassword: vi.fn().mockReturnValue(of(undefined)),
      login: vi.fn().mockReturnValue(of({ accessToken: 'new.token.x', tokenType: 'Bearer', expiresIn: 900 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiClient, useValue: api },
      ],
    });
    store = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    store.accessToken.set('old.token.x');
    store.setUser(me);
  });

  it('signs out: tells the server, clears the session and goes to the login page', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.inject(SessionService).signOut();

    expect(api.logout).toHaveBeenCalled();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.username()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('signs out everywhere the same way after revoking every session', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.inject(SessionService).signOutEverywhere().subscribe();

    expect(api.revokeAllSessions).toHaveBeenCalled();
    expect(store.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('changes the own password, signs in again with it and reloads the profile', () => {
    let result: MeResponse | undefined;

    TestBed.inject(SessionService).changeOwnPassword('temp', 'brand-new-secret').subscribe((r) => (result = r));

    expect(api.changePassword).toHaveBeenCalledWith('temp', 'brand-new-secret');
    expect(api.login).toHaveBeenCalledWith('ada', 'brand-new-secret');
    expect(store.accessToken()).toBe('new.token.x');
    httpMock.expectOne('/api/v1/auth/me').flush({ ...me, mustChangePassword: false });
    expect(result?.mustChangePassword).toBe(false);
    expect(store.mustChangePassword()).toBe(false);
  });
});
