import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type ExportSelectionRequest = S['ExportSelectionRequest'];
export type ConflictReportView = S['ConflictReportView'];
export type ImportConflictView = S['ImportConflictView'];
export type ImportResultView = S['ImportResultView'];

const BASE = '/api/v1';

/**
 * Thin `HttpClient` wrapper over `M10`'s selective export/import endpoints — same
 * self-contained, feature-local-service shape as `url-registry.service.ts`/`channels.service.ts`
 * (no shared `ApiClient` involvement, `withCredentials: true` on every call).
 */
@Injectable({ providedIn: 'root' })
export class ImportExportService {
  private readonly http = inject(HttpClient);

  exportSelection(projectKey: string, selection: ExportSelectionRequest): Observable<Blob> {
    return this.http.post(`${BASE}/projects/${projectKey}/export/selection`, selection, {
      withCredentials: true,
      responseType: 'blob',
    });
  }

  analyzeImport(
    projectKey: string,
    file: File,
    skipExistingImplicit = false,
  ): Observable<ConflictReportView> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('skipExistingImplicit', String(skipExistingImplicit));
    return this.http.post<ConflictReportView>(
      `${BASE}/projects/${projectKey}/import/analyze`,
      formData,
      { withCredentials: true },
    );
  }

  commitImport(
    projectKey: string,
    file: File,
    skipExistingImplicit = false,
  ): Observable<ImportResultView> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('skipExistingImplicit', String(skipExistingImplicit));
    return this.http.post<ImportResultView>(`${BASE}/projects/${projectKey}/import`, formData, {
      withCredentials: true,
    });
  }
}

/**
 * Extracts the blocking/warning conflict list from a failed `commitImport` call's error
 * response (HTTP 409 — the backend's `Problem` body carries a `conflicts` extension
 * property alongside the standard problem-detail fields), so a caller can distinguish
 * "conflicts changed since you analyzed" from a generic network/server failure. Returns
 * `null` for any error that isn't a 409-with-conflicts shape.
 */
export function extractConflicts(error: unknown): ImportConflictView[] | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const body = error.error as { conflicts?: ImportConflictView[] } | null;
  return Array.isArray(body?.conflicts) ? body.conflicts : null;
}
