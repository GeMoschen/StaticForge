import { HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';

/** The header the typed time-travel reads, the record-set grid and the draft preview carry (M29.4.3). */
export const COMPACTED_HEADER = 'X-SF-Compacted';

/** `GET /projects/{key}/assets/{uuid}/versions/{revision}` — the time-travel read of any asset. */
const ASSET_VERSION_PATH = /\/api\/v1\/projects\/[^/]+\/assets\/[^/]+\/versions\/(\d+)$/;

/**
 * Tells {@link TimeTravelStore} which past-revision reads came back compacted, so the time-travel banner can say that
 * the user sees the state at the end of that day (M29.5.2). Reads at a revision are the `GET`s with `?revision=` (media,
 * property sets, datasets, records, record sets and their grid, preview; flagged by the `X-SF-Compacted: true` header)
 * and `GET …/assets/{uuid}/versions/{r}` (flagged by `AssetDetailView.compacted`). Nothing else is looked at.
 */
export const compactedReadInterceptor: HttpInterceptorFn = (req, next) => {
  const revision = req.method === 'GET' ? readRevision(req) : null;
  if (revision === null) {
    return next(req);
  }
  const timeTravel = inject(TimeTravelStore);
  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse && isCompacted(event)) {
        timeTravel.noteCompactedRead(revision);
      }
    }),
  );
};

function readRevision(req: HttpRequest<unknown>): number | null {
  const param = req.params.get('revision');
  const raw = param ?? ASSET_VERSION_PATH.exec(req.url)?.[1] ?? null;
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

function isCompacted(response: HttpResponse<unknown>): boolean {
  if (response.headers.get(COMPACTED_HEADER) === 'true') {
    return true;
  }
  const body = response.body;
  return typeof body === 'object' && body !== null && (body as { compacted?: unknown }).compacted === true;
}
