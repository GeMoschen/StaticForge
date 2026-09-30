import { HttpClient } from '@angular/common/http';
import type { CdlSections } from '../../shared/code-editor/cdl-sections';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type GlobalSetSummaryView = S['GlobalSetSummaryView'];
export type GlobalSetDetailView = S['GlobalSetDetailView'];
export type CreateGlobalSetRequest = S['CreateGlobalSetRequest'];
export type FolderView = S['FolderView'];
export type Diagnostic = S['Diagnostic'];

const BASE = '/api/v1';

/** Wire format for the backend's ETag: `"rev-<revision>"` (mirrors `RevisionHeaders#etag`). */
export function etagFor(revision: number): string {
  return `"rev-${revision}"`;
}

/**
 * Globals store client (M17.4.1). Property sets have their own endpoints; folders reuse the
 * generic `/folders` ones with `scope=GLOBALS`, exactly as the navigation store does, so there is
 * no Globals-specific folder API to keep in step.
 *
 * <p>Schema and values are separate calls because they carry separate permissions: `DEVELOPER`
 * declares the fields, `EDITOR` fills them in.
 */
@Injectable({ providedIn: 'root' })
export class GlobalsService {
  private readonly http = inject(HttpClient);

  list(projectKey: string, folderUuid?: string): Observable<GlobalSetSummaryView[]> {
    return this.http.get<GlobalSetSummaryView[]>(`${BASE}/projects/${projectKey}/globals`, {
      withCredentials: true,
      params: folderUuid ? { folder: folderUuid } : undefined,
    });
  }

  /** One set; `revision` reads the version valid then, which is what time travel shows. */
  get(projectKey: string, uuid: string, revision?: number | null): Observable<GlobalSetDetailView> {
    return this.http.get<GlobalSetDetailView>(`${BASE}/projects/${projectKey}/globals/${uuid}`, {
      withCredentials: true,
      params: revision != null ? { revision } : undefined,
    });
  }

  create(projectKey: string, req: CreateGlobalSetRequest): Observable<GlobalSetDetailView> {
    return this.http.post<GlobalSetDetailView>(`${BASE}/projects/${projectKey}/globals`, req, {
      withCredentials: true,
    });
  }

  /**
   * Saves the schema's sections (M34). `content`, when given, saves the values edited against the stored schema in the
   * same revision — the detail's one Save; they are migrated into the new schema with it.
   */
  updateSchema(
    projectKey: string,
    uuid: string,
    sections: CdlSections,
    content?: Record<string, unknown>,
    etag?: string,
  ): Observable<GlobalSetDetailView> {
    return this.http.put<GlobalSetDetailView>(
      `${BASE}/projects/${projectKey}/globals/${uuid}/schema`,
      { contentCdl: sections.content, rulesCdl: sections.rules, ...(content ? { content } : {}) },
      this.mutationOptions(etag),
    );
  }

  updateContent(
    projectKey: string,
    uuid: string,
    content: Record<string, unknown>,
    etag?: string,
  ): Observable<GlobalSetDetailView> {
    return this.http.put<GlobalSetDetailView>(
      `${BASE}/projects/${projectKey}/globals/${uuid}/content`,
      { content },
      this.mutationOptions(etag),
    );
  }

  delete(projectKey: string, uuid: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/globals/${uuid}`, {
      withCredentials: true,
    });
  }

  /**
   * Validates draft CDL. `kind=GLOBAL_SET` adds the property-set restrictions (no `body`, no
   * `catalog`) the save will enforce, so the editor never shows a green light the server rejects.
   */
  validateCdl(projectKey: string, sections: CdlSections): Observable<{ diagnostics: Diagnostic[] }> {
    return this.http.post<{ diagnostics: Diagnostic[] }>(
      `${BASE}/projects/${projectKey}/cdl/validate`,
      { contentCdl: sections.content, rulesCdl: sections.rules },
      { withCredentials: true, params: { kind: 'GLOBAL_SET' } },
    );
  }

  // ── Folder CRUD (generic `/folders` endpoints, scoped to GLOBALS) ─────────

  folders(projectKey: string, depth = 10): Observable<FolderView[]> {
    return this.http.get<FolderView[]>(`${BASE}/projects/${projectKey}/folders`, {
      withCredentials: true,
      params: { scope: 'GLOBALS', depth },
    });
  }

  createFolder(projectKey: string, displayName: string, parentFolderUuid?: string): Observable<FolderView> {
    return this.http.post<FolderView>(
      `${BASE}/projects/${projectKey}/folders`,
      { displayName, parentFolderUuid, scope: 'GLOBALS' },
      { withCredentials: true },
    );
  }

  renameFolder(projectKey: string, uuid: string, displayName: string, etag?: string): Observable<FolderView> {
    return this.http.put<FolderView>(
      `${BASE}/projects/${projectKey}/folders/${uuid}`,
      { displayName },
      this.mutationOptions(etag),
    );
  }

  moveFolder(projectKey: string, uuid: string, folderUuid: string | undefined): Observable<unknown> {
    return this.http.post(
      `${BASE}/projects/${projectKey}/folders/${uuid}/move`,
      { folderUuid },
      { withCredentials: true },
    );
  }

  deleteFolder(projectKey: string, uuid: string, cascade?: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/folders/${uuid}`, {
      withCredentials: true,
      params: cascade != null ? { cascade } : undefined,
    });
  }

  /** Moves a set between Globals folders through the generic asset-move endpoint. */
  moveSet(projectKey: string, uuid: string, folderUuid: string | undefined): Observable<unknown> {
    return this.http.post(
      `${BASE}/projects/${projectKey}/assets/${uuid}/move`,
      { folderUuid },
      { withCredentials: true },
    );
  }

  private mutationOptions(etag?: string): { withCredentials: true; headers?: Record<string, string> } {
    return etag ? { withCredentials: true, headers: { 'If-Match': etag } } : { withCredentials: true };
  }
}
