import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Same project-API prefix `ApiClient` builds every project-scoped URL from. */
const PROJECT_API_PREFIX = /\/api\/v1\/projects\//;

/**
 * `POST /assets/{uuid}/restore` and `POST /projects/{key}/restore` are the one
 * legitimate class of write issued *about* a past revision (from
 * `revision-diff.component.ts`, reached via the same `timeTravel.enter()` call that
 * puts the app into time travel) — they must keep working while time-travelling.
 */
const RESTORE_PATH = /\/restore$/;

export const READ_ONLY_TIME_TRAVEL_MESSAGE =
  "You're viewing a past revision — exit time travel to make changes.";

/**
 * Client-side backstop: while `TimeTravelStore.isTimeTravel()` is true, reject every
 * mutating (POST/PUT/PATCH/DELETE) request to the project API before it reaches the
 * network, regardless of which component/service issued it. GET/HEAD requests (revision
 * diff, asset-at-revision reads, preview) and non-project requests (auth/login/refresh)
 * are never affected. The explicit restore/rollback endpoints are exempt — they're the
 * one supported way to write *about* a past revision while looking at it.
 */
export const readonlyInterceptor: HttpInterceptorFn = (req, next) => {
  const timeTravel = inject(TimeTravelStore);

  if (
    MUTATING_METHODS.has(req.method) &&
    PROJECT_API_PREFIX.test(req.url) &&
    !RESTORE_PATH.test(req.url) &&
    timeTravel.isTimeTravel()
  ) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 0,
          statusText: 'Read-only (viewing revision)',
          url: req.url,
          error: { title: READ_ONLY_TIME_TRAVEL_MESSAGE, detail: READ_ONLY_TIME_TRAVEL_MESSAGE },
        }),
    );
  }

  return next(req);
};
