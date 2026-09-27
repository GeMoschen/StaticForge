import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type RedirectView = S['RedirectView'];
export type RedirectPageView = S['RedirectPageView'];
export type RedirectRequest = S['RedirectRequest'];
export type RedirectForAssetRequest = S['RedirectForAssetRequest'];

/** Where a redirect came from (M30, epic decision 14). */
export type RedirectKind = 'AUTO' | 'MANUAL';

/** What a redirect does against the default target's current build (M30, epic decision 16). */
export type RedirectState = 'ACTIVE' | 'SHADOWED' | 'DANGLING' | 'LOOP';

/** The registry list's filters (M30.4.1); every one is optional. */
export interface RedirectsQuery {
  channel?: string;
  locale?: string;
  kind?: RedirectKind;
  state?: RedirectState;
  q?: string;
  page?: number;
  size?: number;
}

const BASE = '/api/v1';

/**
 * `M30.4.1`'s redirect registry: the Redirects settings tab and the "Redirect old URL to…" option of the unpublish and
 * delete dialogs. Writes present their own errors (a stale `If-Match`, a duplicate source, a loop), so they skip the
 * global error toast.
 */
@Injectable({ providedIn: 'root' })
export class RedirectsService {
  private readonly http = inject(HttpClient);

  list(projectKey: string, query: RedirectsQuery = {}): Observable<RedirectPageView> {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value as string | number;
      }
    }
    return this.http.get<RedirectPageView>(`${BASE}/projects/${projectKey}/redirects`, { withCredentials: true, params });
  }

  get(projectKey: string, id: number): Observable<RedirectView> {
    return this.http.get<RedirectView>(`${BASE}/projects/${projectKey}/redirects/${id}`, { withCredentials: true });
  }

  /** `409 SF-DOM-0191` duplicate source, `422 SF-DOM-0192` loop, `422 SF-DOM-0193` invalid channel, locale or path. */
  create(projectKey: string, body: RedirectRequest): Observable<RedirectView> {
    return this.http.post<RedirectView>(`${BASE}/projects/${projectKey}/redirects`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Replaces the redirect read at `version` (`If-Match: "v{version}"`); a stale version is `409 SF-API-0409`. */
  update(projectKey: string, id: number, version: number, body: RedirectRequest): Observable<RedirectView> {
    return this.http.put<RedirectView>(`${BASE}/projects/${projectKey}/redirects/${id}`, body, {
      withCredentials: true,
      headers: { 'If-Match': `"v${version}"` },
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Deletes the redirect read at `version`; a stale version is `409 SF-API-0409`. */
  delete(projectKey: string, id: number, version: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/redirects/${id}`, {
      withCredentials: true,
      headers: { 'If-Match': `"v${version}"` },
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /**
   * One manual redirect per current output path of `assetUuid` (default target's build) to a page or path;
   * `422 SF-DOM-0194` when the asset has no published output.
   */
  forAsset(projectKey: string, body: RedirectForAssetRequest): Observable<RedirectView[]> {
    return this.http.post<RedirectView[]>(`${BASE}/projects/${projectKey}/redirects/for-asset`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }
}
