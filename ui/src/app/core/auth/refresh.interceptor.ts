import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { catchError, finalize, share, switchMap, tap, throwError } from 'rxjs';
import { AuthStore, jwtExpiresAt } from './auth.store';
import type { components } from '../api/generated/schema.d.ts';

type LoginResponse = components['schemas']['LoginResponse'];

const REFRESH_URL = '/api/v1/auth/refresh';
const LOGIN_URL = '/api/v1/auth/login';

/** Shared in-flight refresh: concurrent 401s await the same single request. */
let refreshInFlight: Observable<LoginResponse> | null = null;

/** Handle to the currently scheduled silent (proactive) refresh. */
let silentRefreshHandle: ReturnType<typeof setTimeout> | null = null;

function performRefresh(
  http: HttpClient,
  store: AuthStore,
  router: Router,
): Observable<LoginResponse> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = http
    .post<LoginResponse>(REFRESH_URL, null, {
      withCredentials: true,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    .pipe(
      tap((res) => store.setSession(res)),
      catchError((err: unknown) => {
        store.clear();
        redirectToLogin(router);
        return throwError(() => err);
      }),
      finalize(() => {
        refreshInFlight = null;
      }),
      share(),
    );
  return refreshInFlight;
}

function redirectToLogin(router: Router): void {
  if (typeof window === 'undefined') {
    return;
  }
  const returnUrl = window.location.pathname + window.location.search;
  void router.navigate(['/login'], { queryParams: { returnUrl } });
}

function scheduleSilentRefresh(
  store: AuthStore,
  http: HttpClient,
  router: Router,
): void {
  const token = store.accessToken();
  if (!token) {
    return;
  }
  const exp = jwtExpiresAt(token);
  if (exp === null) {
    return;
  }
  const lifetimeMs = exp * 1000 - Date.now();
  if (lifetimeMs <= 0) {
    return;
  }
  const delayMs = Math.floor(lifetimeMs * 0.8);
  if (silentRefreshHandle) {
    clearTimeout(silentRefreshHandle);
  }
  silentRefreshHandle = setTimeout(() => {
    performRefresh(http, store, router).subscribe({
      next: () => scheduleSilentRefresh(store, http, router),
      error: () => {
        /* silent refresh failure is non-fatal */
      },
    });
  }, delayMs);
}

export const refreshInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes(LOGIN_URL) || req.url.includes(REFRESH_URL)) {
    return next(req);
  }

  const http = inject(HttpClient);
  const store = inject(AuthStore);
  const router = inject(Router);

  scheduleSilentRefresh(store, http, router);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        return performRefresh(http, store, router).pipe(
          switchMap(() => {
            const token = store.accessToken();
            const retried: HttpRequest<unknown> = token
              ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
              : req;
            return next(retried);
          }),
        );
      }
      return throwError(() => err);
    }),
  );
};
