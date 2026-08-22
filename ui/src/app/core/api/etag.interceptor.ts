import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { tap } from 'rxjs';

const MUTATING_METHODS = new Set(['PUT', 'PATCH', 'POST', 'DELETE']);

/** Best-effort, in-memory ETag cache keyed by request URL (no query string). */
const etags = new Map<string, string>();

export const etagInterceptor: HttpInterceptorFn = (req, next) => {
  if (MUTATING_METHODS.has(req.method) && !req.headers.has('If-Match')) {
    const remembered = etags.get(req.url);
    if (remembered) {
      req = req.clone({ setHeaders: { 'If-Match': remembered } });
    }
  }

  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse && req.method === 'GET') {
        const etag = event.headers.get('ETag');
        if (etag) {
          etags.set(req.url, etag);
        }
      }
    }),
  );
};
