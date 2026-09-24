import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../ui/toast.service';

/** Set on a request whose caller presents its own errors (e.g. search shows an unavailable index inline). */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

interface Problem {
  title?: string;
  detail?: string;
  status?: number;
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toasts = inject(ToastService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        !req.context.get(SKIP_ERROR_TOAST) &&
        err.status !== 401 &&
        // A pending password change is not an error to toast: the app goes to the password screen instead.
        err.status !== 428 &&
        !(err.url ?? '').includes('/auth/login')
      ) {
        let message = 'Something went wrong';
        const body = err.error;
        if (body && typeof body === 'object') {
          const problem = body as Problem;
          message = problem.detail ?? problem.title ?? message;
        }
        toasts.show(message, 'error');
      }
      return throwError(() => err);
    }),
  );
};
