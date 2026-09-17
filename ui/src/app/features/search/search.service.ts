import { HttpClient, HttpContext, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import { ToastService } from '../../core/ui/toast.service';
import {
  PALETTE_SIZE,
  shouldSearch,
  type SearchResultView,
  type SearchStatusView,
} from './search.util';

const BASE = '/api/v1';

export interface SearchRequest {
  q: string;
  types?: string[];
  folder?: string;
  page?: number;
  size?: number;
}

/** What the palette types into: the project it searches (`null` outside a project) and the input. */
export interface LiveQuery {
  projectKey: string | null;
  q: string;
}

/** One state of an as-you-type search. */
export type LiveSearchState =
  | { kind: 'idle'; q: string }
  | { kind: 'no-project'; q: string }
  | { kind: 'loading'; q: string }
  | { kind: 'results'; q: string; result: SearchResultView }
  | { kind: 'unavailable'; q: string }
  | { kind: 'error'; q: string };

/** Project-scoped editorial search (M23.4.1): `GET /search`, its status and the admin reindex. */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  /** Errors are the caller's to present: an unavailable index is shown in place, not as a toast. */
  search(projectKey: string, request: SearchRequest): Observable<SearchResultView> {
    let params = new HttpParams().set('q', request.q);
    for (const type of request.types ?? []) {
      params = params.append('type', type);
    }
    if (request.folder) {
      params = params.set('folder', request.folder);
    }
    if (request.page) {
      params = params.set('page', String(request.page));
    }
    if (request.size) {
      params = params.set('size', String(request.size));
    }
    return this.http.get<SearchResultView>(`${BASE}/projects/${encodeURIComponent(projectKey)}/search`, {
      params,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  status(projectKey: string): Observable<SearchStatusView> {
    return this.http.get<SearchStatusView>(`${BASE}/projects/${encodeURIComponent(projectKey)}/search/status`, {
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Starts a full rebuild (PROJECT_ADMIN). A `409` means one is already running. */
  reindex(projectKey: string): Observable<SearchStatusView> {
    return this.http.post<SearchStatusView>(
      `${BASE}/projects/${encodeURIComponent(projectKey)}/search/reindex`,
      null,
      { context: new HttpContext().set(SKIP_ERROR_TOAST, true) },
    );
  }

  /**
   * As-you-type search for the palette: debounced, and every new input cancels the request still in flight, so fast
   * typing never queues requests. Inputs too short to search, and input outside a project, never call the API.
   */
  live(queries: Observable<LiveQuery>, debounceMs = 150): Observable<LiveSearchState> {
    return queries.pipe(
      map((query) => ({ projectKey: query.projectKey, q: query.q.trim() })),
      distinctUntilChanged((a, b) => a.projectKey === b.projectKey && a.q === b.q),
      debounceTime(debounceMs),
      switchMap((query): Observable<LiveSearchState> => {
        if (!query.projectKey) {
          return of({ kind: 'no-project', q: query.q });
        }
        if (!shouldSearch(query.q)) {
          return of({ kind: 'idle', q: query.q });
        }
        return this.search(query.projectKey, { q: query.q, size: PALETTE_SIZE }).pipe(
          map((result): LiveSearchState => ({ kind: 'results', q: query.q, result })),
          catchError((error: unknown) => of(this.failure(query.q, error))),
          startWith<LiveSearchState>({ kind: 'loading', q: query.q }),
        );
      }),
    );
  }

  private failure(q: string, error: unknown): LiveSearchState {
    if (error instanceof HttpErrorResponse && error.status === 503) {
      return { kind: 'unavailable', q };
    }
    if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
      this.toasts.show(problemMessage(error, 'Search failed — try again.'), 'error');
    }
    return { kind: 'error', q };
  }
}

export function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object') {
    const problem = error.error as { detail?: string; title?: string };
    return problem.detail ?? problem.title ?? fallback;
  }
  return fallback;
}
