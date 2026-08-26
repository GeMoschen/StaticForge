import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type UrlRegistryEntryView = S['UrlRegistryEntryView'];
export type PageUrlRegistryEntryView = S['PageUrlRegistryEntryView'];
export type UrlRegistryOverrideRequest = S['UrlRegistryOverrideRequest'];
export type UrlRegistryResetRequest = S['UrlRegistryResetRequest'];

/** `area` filter/scope values, matching `UrlArea` on the server (case-insensitive on the wire). */
export type UrlArea = 'PREVIEW' | 'GENERATED';

export interface UrlRegistryListParams {
  channelKey?: string;
  area?: UrlArea;
  q?: string;
  page?: number;
  size?: number;
}

const BASE = '/api/v1';

/**
 * Thin `HttpClient` wrapper over `M8.2.4`'s `/url-registry` endpoints — same
 * self-contained, feature-local-service shape as `channels.service.ts`/`navigation.service.ts`
 * (no shared `ApiClient` involvement, `withCredentials: true` on every call).
 */
@Injectable({ providedIn: 'root' })
export class UrlRegistryService {
  private readonly http = inject(HttpClient);

  list(projectKey: string, params: UrlRegistryListParams = {}): Observable<PageUrlRegistryEntryView> {
    const query: Record<string, string | number> = {};
    if (params.channelKey) {
      query['channelKey'] = params.channelKey;
    }
    if (params.area) {
      query['area'] = params.area;
    }
    if (params.q) {
      query['q'] = params.q;
    }
    if (params.page != null) {
      query['page'] = params.page;
    }
    if (params.size != null) {
      query['size'] = params.size;
    }
    return this.http.get<PageUrlRegistryEntryView>(`${BASE}/projects/${projectKey}/url-registry`, {
      withCredentials: true,
      params: query,
    });
  }

  override(projectKey: string, id: number, url: string): Observable<UrlRegistryEntryView> {
    const req: UrlRegistryOverrideRequest = { url };
    return this.http.patch<UrlRegistryEntryView>(
      `${BASE}/projects/${projectKey}/url-registry/${id}`,
      req,
      { withCredentials: true },
    );
  }

  /** `req` must set at most one of `entryId`/`channelKey`/`area` — `{}` resets the whole project. */
  reset(projectKey: string, req: UrlRegistryResetRequest): Observable<void> {
    return this.http.post<void>(`${BASE}/projects/${projectKey}/url-registry/reset`, req, {
      withCredentials: true,
    });
  }
}
