import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';

const BASE = '/api/v1';

type S = components['schemas'];

export type StructureDetail = S['StructureDetail'];
export type StructureSummary = S['StructureSummary'];
export type StructureCreateRequest = S['StructureCreateRequest'];
export type StructureUpdateRequest = S['StructureUpdateRequest'];
export type StructurePreviewRequest = S['StructurePreviewRequest'];
export type PageStructureSummary = S['PageStructureSummary'];

/** Wire format for the backend's ETag: `"rev-<revision>"`. */
export function etagFor(revision: number): string {
  return `"rev-${revision}"`;
}

/** Inverse of `etagFor`; returns the numeric revision, or null if malformed. */
export function revisionFromEtag(etag: string): number | null {
  const match = /^"rev-(\d+)"$/.exec(etag.trim());
  return match ? Number(match[1]) : null;
}

@Injectable({ providedIn: 'root' })
export class StructuresService {
  private readonly http = inject(HttpClient);

  list(key: string): Observable<PageStructureSummary> {
    return this.http.get<PageStructureSummary>(
      `${BASE}/projects/${key}/structures`,
      { withCredentials: true },
    );
  }

  get(key: string, uuid: string): Observable<StructureDetail> {
    return this.http.get<StructureDetail>(
      `${BASE}/projects/${key}/structures/${uuid}`,
      { withCredentials: true },
    );
  }

  create(key: string, req: StructureCreateRequest): Observable<StructureDetail> {
    return this.http.post<StructureDetail>(
      `${BASE}/projects/${key}/structures`,
      req,
      { withCredentials: true },
    );
  }

  update(
    key: string,
    uuid: string,
    body: StructureUpdateRequest,
    etag?: string,
  ): Observable<StructureDetail> {
    return this.http.put<StructureDetail>(
      `${BASE}/projects/${key}/structures/${uuid}`,
      body,
      this.mutationOptions(etag),
    );
  }

  saveChannel(
    key: string,
    uuid: string,
    channelKey: string,
    source: string,
    etag?: string,
  ): Observable<S['ChannelTemplateDto']> {
    return this.http.put<S['ChannelTemplateDto']>(
      `${BASE}/projects/${key}/structures/${uuid}/channels/${channelKey}`,
      { source },
      this.mutationOptions(etag),
    );
  }

  preview(
    key: string,
    uuid: string,
    pageUuid?: string,
  ): Observable<any> {
    const body: StructurePreviewRequest =
      pageUuid != null && pageUuid !== '' ? { pageUuid } : {};
    return this.http.post<any>(
      `${BASE}/projects/${key}/structures/${uuid}/preview`,
      body,
      { withCredentials: true },
    );
  }

  private mutationOptions(etag?: string): {
    withCredentials: true;
    headers?: Record<string, string>;
  } {
    return etag
      ? { withCredentials: true, headers: { 'If-Match': etag } }
      : { withCredentials: true };
  }
}
