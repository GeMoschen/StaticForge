import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';

type S = components['schemas'];

export type UrlRegistryEntryView = S['UrlRegistryEntryView'];
export type PageUrlRegistryEntryView = S['PageUrlRegistryEntryView'];
export type UrlRegistryOverrideRequest = S['UrlRegistryOverrideRequest'];
export type UrlRegistryResetRequest = S['UrlRegistryResetRequest'];
export type UrlRegistryAssetView = S['UrlRegistryAssetView'];

/** `area` filter/scope values, matching `UrlArea` on the server (case-insensitive on the wire). */
export type UrlArea = 'PREVIEW' | 'GENERATED';

/** What a URL belongs to (M32): a page output, a media file (or variant), or a folder without an index page. */
export type UrlTargetType = 'PAGE' | 'MEDIA' | 'FOLDER';

export interface UrlRegistryListParams {
  /** A failed read shows no global error toast (the caller has its own fallback). */
  quiet?: boolean;
  channelKey?: string;
  area?: UrlArea;
  targetType?: UrlTargetType;
  /** A language tag; `''` lists the rows without a language. */
  locale?: string;
  targetUuid?: string;
  q?: string;
  page?: number;
  size?: number;
}

const BASE = '/api/v1';

/**
 * Thin `HttpClient` wrapper over the `/url-registry` endpoints (`M8.2.4`, every target since M32.7) — same
 * self-contained, feature-local-service shape as `channels.service.ts`/`navigation.service.ts`
 * (no shared `ApiClient` involvement, `withCredentials: true` on every call).
 */
@Injectable({ providedIn: 'root' })
export class UrlRegistryService {
  private readonly http = inject(HttpClient);

  list(projectKey: string, params: UrlRegistryListParams = {}): Observable<PageUrlRegistryEntryView> {
    const query: Record<string, string | number> = {};
    for (const key of ['channelKey', 'area', 'targetType', 'targetUuid', 'q'] as const) {
      const value = params[key];
      if (value) {
        query[key] = value;
      }
    }
    if (params.locale != null) {
      query['locale'] = params.locale;
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
      ...(params.quiet ? { context: new HttpContext().set(SKIP_ERROR_TOAST, true) } : {}),
    });
  }

  /** The URLs of one asset, and for a pages folder the index page it links instead (M32.7). */
  forAsset(projectKey: string, uuid: string): Observable<UrlRegistryAssetView> {
    // The panel shows its own quiet note when this fails (a project without output): no global error toast.
    return this.http.get<UrlRegistryAssetView>(`${BASE}/projects/${projectKey}/url-registry/assets/${uuid}`, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Overrides one existing row's URL. */
  override(projectKey: string, id: number, url: string): Observable<UrlRegistryEntryView> {
    const req: UrlRegistryOverrideRequest = { url };
    return this.http.patch<UrlRegistryEntryView>(
      `${BASE}/projects/${projectKey}/url-registry/${id}`,
      req,
      { withCredentials: true },
    );
  }

  /** Sets a target's URL whether or not it has a row yet (M32.7). */
  assign(projectKey: string, req: UrlRegistryOverrideRequest): Observable<UrlRegistryEntryView> {
    return this.http.put<UrlRegistryEntryView>(`${BASE}/projects/${projectKey}/url-registry`, req, {
      withCredentials: true,
    });
  }

  /**
   * `req` sets at most one of `entryId`/`targetUuid`/`channelKey`/`area` (`area` may narrow a `targetUuid` reset) —
   * `{}` resets the whole project.
   */
  reset(projectKey: string, req: UrlRegistryResetRequest): Observable<void> {
    return this.http.post<void>(`${BASE}/projects/${projectKey}/url-registry/reset`, req, {
      withCredentials: true,
    });
  }
}

/** A readable reason for a failed override: the server's problem detail for `409 SF-DOM-0200` / `422 SF-DOM-0201`. */
export function overrideErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse && (err.status === 409 || err.status === 422)) {
    const detail = (err.error as { detail?: string } | null)?.detail;
    if (detail) {
      return detail;
    }
  }
  return 'Could not save the URL — try again in a moment.';
}

/** "Page", "Media", "Folder" — the label of a target type. */
export function targetTypeLabel(type: string | undefined): string {
  switch (type) {
    case 'PAGE':
      return 'Page';
    case 'MEDIA':
      return 'Media';
    case 'FOLDER':
      return 'Folder';
    default:
      return type ?? '';
  }
}

/** What a row names besides its asset: a media variant, or page N of a paginated page. */
export function outputLabel(entry: UrlRegistryEntryView): string {
  if (entry.variant) {
    return `variant ${entry.variant}`;
  }
  return (entry.pageNumber ?? 1) > 1 ? `page ${entry.pageNumber}` : '';
}
