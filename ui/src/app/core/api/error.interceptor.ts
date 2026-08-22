import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../ui/toast.service';

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
        err.status !== 401 &&
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
