import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { cdlFields, type CdlSections } from '../../shared/code-editor/cdl-sections';

const BASE = '/api/v1';

type S = components['schemas'];

export type TemplateSummary = S['TemplateSummary'];
export type TemplateDetail = S['TemplateDetail'];
export type PageTemplateSummary = S['PageTemplateSummary'];
export type CreateTemplateRequest = S['CreateTemplateRequest'];
export type UpdateTemplateRequest = S['UpdateTemplateRequest'];
export type Diagnostic = S['Diagnostic'];

export type TemplateKind = 'section' | 'page';

/** Wire format for the backend's ETag: `"rev-<revision>"`. */
export function etagFor(revision: number): string {
  return `"rev-${revision}"`;
}

function endpoint(kind: TemplateKind, key: string): string {
  return `${BASE}/projects/${key}/${kind}-templates`;
}

@Injectable({ providedIn: 'root' })
export class TemplatesService {
  private readonly http = inject(HttpClient);

  list(kind: TemplateKind, key: string): Observable<PageTemplateSummary> {
    return this.http.get<PageTemplateSummary>(`${endpoint(kind, key)}`, {
      withCredentials: true,
    });
  }

  get(kind: TemplateKind, key: string, uuid: string): Observable<TemplateDetail> {
    return this.http.get<TemplateDetail>(`${endpoint(kind, key)}/${uuid}`, {
      withCredentials: true,
    });
  }

  create(
    kind: TemplateKind,
    key: string,
    req: CreateTemplateRequest,
  ): Observable<TemplateDetail> {
    return this.http.post<TemplateDetail>(endpoint(kind, key), req, {
      withCredentials: true,
    });
  }

  /**
   * `confirmDiscard` (M24.2.2) authorises a CDL change that takes `localizable` off an editor whose
   * stored values carry translations; without it such a save answers `409` and writes nothing.
   */
  update(
    kind: TemplateKind,
    key: string,
    uuid: string,
    body: UpdateTemplateRequest,
    etag?: string,
    confirmDiscard = false,
  ): Observable<TemplateDetail> {
    const query = confirmDiscard ? '?confirmDiscard=true' : '';
    return this.http.put<TemplateDetail>(
      `${endpoint(kind, key)}/${uuid}${query}`,
      body,
      this.mutationOptions(etag),
    );
  }

  /** Undo of a template delete: the template comes back as its last live version was (M35.13). */
  restore(kind: TemplateKind, key: string, uuid: string): Observable<TemplateDetail> {
    return this.http.post<TemplateDetail>(`${endpoint(kind, key)}/${uuid}/restore`, null, {
      withCredentials: true,
    });
  }

  delete(kind: TemplateKind, key: string, uuid: string): Observable<void> {
    return this.http.delete<void>(`${endpoint(kind, key)}/${uuid}`, {
      withCredentials: true,
    });
  }

  /**
   * Validates a channel source. With `templateUuid` it is checked as that template's channel (M20.4.1): references,
   * the inheritance chain, and names against the effective definition built from the unsaved CDL sections when given.
   */
  validateOctl(key: string, body: S['OctlValidateRequest']): Observable<S['OctlValidateResponse']> {
    return this.http.post<S['OctlValidateResponse']>(`${BASE}/projects/${key}/octl/validate`, body, {
      withCredentials: true,
    });
  }

  /** Validates CDL sections (M34); `kind` applies a section template's restrictions. Each diagnostic names its section. */
  validateCdl(key: string, sections: CdlSections, kind?: 'SECTION_TEMPLATE'): Observable<S['CdlValidateResponse']> {
    const query = kind ? `?kind=${kind}` : '';
    return this.http.post<S['CdlValidateResponse']>(
      `${BASE}/projects/${key}/cdl/validate${query}`,
      cdlFields(sections),
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
