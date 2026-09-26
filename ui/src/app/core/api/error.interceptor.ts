import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ProjectContextStore } from '../project/project-context.store';
import { permissionDeniedMessage } from '../project/publish-permissions';
import { ToastService } from '../ui/toast.service';

/** Set on a request whose caller presents its own errors (e.g. search shows an unavailable index inline). */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

interface Problem {
  title?: string;
  detail?: string;
  status?: number;
  /** What a `403` says the caller lacks (M28): a publish permission or `ROLE:<role>`. */
  permission?: string;
}

/**
 * Toasts a failed request's problem. A `403` naming a `permission` means the project's publish policy (or the caller's
 * role) changed while the app was open: the project detail is re-read, so the controls follow, and the message says
 * what the user can no longer do.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toasts = inject(ToastService);
  const context = inject(ProjectContextStore);
  return next(req).pipe(
    catchError((err: unknown) => {
      const permission =
        err instanceof HttpErrorResponse && err.status === 403 && err.error && typeof err.error === 'object'
          ? (err.error as Problem).permission
          : undefined;
      if (permission) {
        context.refreshDetail();
      }
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
        if (permission) {
          message = permissionDeniedMessage(permission);
        } else if (body && typeof body === 'object') {
          const problem = body as Problem;
          message = problem.detail ?? problem.title ?? message;
        }
        toasts.show(message, 'error');
      }
      return throwError(() => err);
    }),
  );
};
