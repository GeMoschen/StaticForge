import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from './auth.store';
import { returnUrlParams } from './password-change.guard';
import { SET_PASSWORD_URL } from './session.service';

/**
 * A `428 SF-API-0428` means the account must set a new password before anything else works (M26): mark it and go to
 * the "Set a new password" screen, keeping where the user was as `returnUrl`.
 */
export const passwordRequiredInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 428) {
        store.mustChangePassword.set(true);
        if (!router.url.startsWith(SET_PASSWORD_URL)) {
          void router.navigate([SET_PASSWORD_URL], { queryParams: returnUrlParams(router.url) });
        }
      }
      return throwError(() => err);
    }),
  );
};
