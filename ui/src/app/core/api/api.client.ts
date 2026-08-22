import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from './generated/schema.d.ts';

type S = components['schemas'];

const BASE = '/api/v1';

/** Wire format mirrors RevisionHeaders#etag: `"rev-<revision>"`. */
export function etagFor(revision: number): string {
  return `"rev-${revision}"`;
}

/** Inverse of etagFor; returns the numeric revision, or null if malformed. */
export function revisionFromEtag(etag: string): number | null {
  const match = /^"rev-(\d+)"$/.exec(etag.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

type QueryValue = string | number | boolean | undefined;

@Injectable({ providedIn: 'root' })
export class ApiClient {
  constructor(private readonly http: HttpClient) {}

  private params(values?: Record<string, QueryValue>): HttpParams {
    let params = new HttpParams();
    if (values) {
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null) {
          params = params.set(key, String(value));
        }
      }
    }
    return params;
  }

  private mutationOptions(etag?: number): {
    withCredentials: true;
    headers?: Record<string, string>;
  } {
    return etag !== undefined
      ? { withCredentials: true, headers: { 'If-Match': etagFor(etag) } }
      : { withCredentials: true };
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  login(username: string, password: string): Observable<S['LoginResponse']> {
    return this.http.post<S['LoginResponse']>(
      `${BASE}/auth/login`,
      { username, password },
      { withCredentials: true },
    );
  }

  refresh(): Observable<S['LoginResponse']> {
    return this.http.post<S['LoginResponse']>(`${BASE}/auth/refresh`, null, {
      withCredentials: true,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${BASE}/auth/logout`, null, {
      withCredentials: true,
    });
  }

  me(): Observable<S['MeResponse']> {
    return this.http.get<S['MeResponse']>(`${BASE}/auth/me`, {
      withCredentials: true,
    });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(
      `${BASE}/auth/password`,
      { currentPassword, newPassword },
      { withCredentials: true },
    );
  }

  // ── Projects ────────────────────────────────────────────────────────────

  listProjects(): Observable<S['ProjectSummary'][]> {
    return this.http.get<S['ProjectSummary'][]>(`${BASE}/projects`, {
      withCredentials: true,
    });
  }

  createProject(body: S['ProjectCreateRequest']): Observable<S['ProjectDetail']> {
    return this.http.post<S['ProjectDetail']>(`${BASE}/projects`, body, {
      withCredentials: true,
    });
  }

  getProject(key: string): Observable<S['ProjectDetail']> {
    return this.http.get<S['ProjectDetail']>(`${BASE}/projects/${key}`, {
      withCredentials: true,
    });
  }

  updateProject(key: string, body: S['ProjectUpdateRequest']): Observable<S['ProjectDetail']> {
    return this.http.put<S['ProjectDetail']>(`${BASE}/projects/${key}`, body, {
      withCredentials: true,
    });
  }

  listMembers(key: string): Observable<S['ProjectMemberView'][]> {
    return this.http.get<S['ProjectMemberView'][]>(
      `${BASE}/projects/${key}/members`,
      { withCredentials: true },
    );
  }

  // ── Folders ─────────────────────────────────────────────────────────────

  listFolders(projectKey: string, scope: 'PAGES' | 'MEDIA', depth?: number): Observable<S['FolderView'][]> {
    return this.http.get<S['FolderView'][]>(`${BASE}/projects/${projectKey}/folders`, {
      withCredentials: true,
      params: this.params({ scope, depth }),
    });
  }

  createFolder(
    projectKey: string,
    body: S['CreateFolderRequest'],
  ): Observable<S['FolderView']> {
    return this.http.post<S['FolderView']>(
      `${BASE}/projects/${projectKey}/folders`,
      body,
      { withCredentials: true },
    );
  }

  renameFolder(
    projectKey: string,
    uuid: string,
    body: S['RenameFolderRequest'],
    etag?: number,
  ): Observable<S['FolderView']> {
    return this.http.put<S['FolderView']>(
      `${BASE}/projects/${projectKey}/folders/${uuid}`,
      body,
      this.mutationOptions(etag),
    );
  }

  moveFolder(
    projectKey: string,
    uuid: string,
    body: S['MoveRequest'],
    etag?: number,
  ): Observable<S['MoveResultDto']> {
    return this.http.post<S['MoveResultDto']>(
      `${BASE}/projects/${projectKey}/folders/${uuid}/move`,
      body,
      this.mutationOptions(etag),
    );
  }

  deleteFolder(projectKey: string, uuid: string, cascade?: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/folders/${uuid}`, {
      withCredentials: true,
      params: this.params({ cascade }),
    });
  }

  // ── Assets ──────────────────────────────────────────────────────────────

  listAssets(
    projectKey: string,
    opts: { type?: string; q?: string; folder?: string; page?: number; size?: number } = {},
  ): Observable<S['PageAssetSummaryView']> {
    return this.http.get<S['PageAssetSummaryView']>(
      `${BASE}/projects/${projectKey}/assets`,
      { withCredentials: true, params: this.params(opts) },
    );
  }

  assetDetail(projectKey: string, uuid: string): Observable<S['AssetDetailView']> {
    return this.http.get<S['AssetDetailView']>(
      `${BASE}/projects/${projectKey}/assets/${uuid}`,
      { withCredentials: true },
    );
  }

  assetUsages(projectKey: string, uuid: string): Observable<S['UsageDto'][]> {
    return this.http.get<S['UsageDto'][]>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/usages`,
      { withCredentials: true },
    );
  }

  assetHistory(
    projectKey: string,
    uuid: string,
  ): Observable<S['AssetHistoryEntry'][]> {
    return this.http.get<S['AssetHistoryEntry'][]>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/history`,
      { withCredentials: true },
    );
  }

  restoreAsset(
    projectKey: string,
    uuid: string,
    body: S['RestoreRequest'],
  ): Observable<S['AssetDetailView']> {
    return this.http.post<S['AssetDetailView']>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/restore`,
      body,
      { withCredentials: true },
    );
  }

  moveAsset(
    projectKey: string,
    uuid: string,
    body: S['MoveRequest'],
  ): Observable<unknown> {
    return this.http.post<unknown>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/move`,
      body,
      { withCredentials: true },
    );
  }

  deleteAsset(projectKey: string, uuid: string, force?: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/assets/${uuid}`, {
      withCredentials: true,
      params: this.params({ force }),
    });
  }

  // ── Pages ───────────────────────────────────────────────────────────────

  listPages(
    projectKey: string,
    opts: { folder?: string; templateUuid?: string; q?: string } = {},
  ): Observable<S['AssetSummaryView'][]> {
    return this.http.get<S['AssetSummaryView'][]>(
      `${BASE}/projects/${projectKey}/pages`,
      { withCredentials: true, params: this.params(opts) },
    );
  }

  createPage(
    projectKey: string,
    body: S['CreatePageRequest'],
  ): Observable<S['PageView']> {
    return this.http.post<S['PageView']>(`${BASE}/projects/${projectKey}/pages`, body, {
      withCredentials: true,
    });
  }

  pageDetail(projectKey: string, uuid: string): Observable<S['PageView']> {
    return this.http.get<S['PageView']>(`${BASE}/projects/${projectKey}/pages/${uuid}`, {
      withCredentials: true,
    });
  }

  updatePage(
    projectKey: string,
    uuid: string,
    payloadJson: unknown,
    etag?: number,
  ): Observable<S['PageView']> {
    return this.http.put<S['PageView']>(
      `${BASE}/projects/${projectKey}/pages/${uuid}`,
      payloadJson,
      this.mutationOptions(etag),
    );
  }

  addSection(
    projectKey: string,
    uuid: string,
    body: string,
    request: S['AddSectionRequest'],
    etag?: number,
  ): Observable<S['PageView']> {
    return this.http.post<S['PageView']>(
      `${BASE}/projects/${projectKey}/pages/${uuid}/bodies/${body}/sections`,
      request,
      this.mutationOptions(etag),
    );
  }

  reorderSections(
    projectKey: string,
    uuid: string,
    body: string,
    instanceIds: string[],
    etag?: number,
  ): Observable<S['PageView']> {
    const request: S['ReorderRequest'] = { instanceIds };
    return this.http.put<S['PageView']>(
      `${BASE}/projects/${projectKey}/pages/${uuid}/bodies/${body}/order`,
      request,
      this.mutationOptions(etag),
    );
  }

  deleteSection(
    projectKey: string,
    uuid: string,
    body: string,
    instanceId: string,
    etag?: number,
  ): Observable<S['PageView']> {
    return this.http.delete<S['PageView']>(
      `${BASE}/projects/${projectKey}/pages/${uuid}/bodies/${body}/sections/${instanceId}`,
      this.mutationOptions(etag),
    );
  }

  moveSection(
    projectKey: string,
    targetUuid: string,
    targetBody: string,
    request: S['MoveSectionRequest'],
    etag?: number,
  ): Observable<S['PageView']> {
    return this.http.post<S['PageView']>(
      `${BASE}/projects/${projectKey}/pages/${targetUuid}/bodies/${targetBody}/sections/move`,
      request,
      this.mutationOptions(etag),
    );
  }

  duplicatePage(projectKey: string, uuid: string): Observable<S['PageView']> {
    return this.http.post<S['PageView']>(
      `${BASE}/projects/${projectKey}/pages/${uuid}/duplicate`,
      null,
      { withCredentials: true },
    );
  }

  // ── Templates ───────────────────────────────────────────────────────────

  listPageTemplates(
    projectKey: string,
    page?: number,
    size?: number,
  ): Observable<S['PageTemplateSummary']> {
    return this.http.get<S['PageTemplateSummary']>(
      `${BASE}/projects/${projectKey}/page-templates`,
      { withCredentials: true, params: this.params({ page, size }) },
    );
  }

  listSectionTemplates(
    projectKey: string,
    page?: number,
    size?: number,
  ): Observable<S['PageTemplateSummary']> {
    return this.http.get<S['PageTemplateSummary']>(
      `${BASE}/projects/${projectKey}/section-templates`,
      { withCredentials: true, params: this.params({ page, size }) },
    );
  }

  templateDetail(projectKey: string, uuid: string): Observable<S['TemplateDetail']> {
    return this.http.get<S['TemplateDetail']>(
      `${BASE}/projects/${projectKey}/page-templates/${uuid}`,
      { withCredentials: true },
    );
  }

  sectionTemplateDetail(projectKey: string, uuid: string): Observable<S['TemplateDetail']> {
    return this.http.get<S['TemplateDetail']>(
      `${BASE}/projects/${projectKey}/section-templates/${uuid}`,
      { withCredentials: true },
    );
  }

  // ── Media ───────────────────────────────────────────────────────────────

  listMedia(
    projectKey: string,
    opts: {
      mimeType?: string;
      folder?: string;
      q?: string;
      page?: number;
      size?: number;
    } = {},
  ): Observable<S['PageMediaSummaryView']> {
    return this.http.get<S['PageMediaSummaryView']>(
      `${BASE}/projects/${projectKey}/media`,
      { withCredentials: true, params: this.params(opts) },
    );
  }

  uploadMedia(
    projectKey: string,
    file: File,
    opts: { folderUuid?: string; altText?: string; caption?: string } = {},
  ): Observable<S['MediaView']> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<S['MediaView']>(
      `${BASE}/projects/${projectKey}/media`,
      formData,
      { withCredentials: true, params: this.params(opts) },
    );
  }

  replaceMedia(projectKey: string, uuid: string, file: File): Observable<S['MediaView']> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<S['MediaView']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/replace`,
      formData,
      { withCredentials: true },
    );
  }

  updateMediaMetadata(
    projectKey: string,
    uuid: string,
    body: S['MediaMetadataRequest'],
    etag?: number,
  ): Observable<S['MediaView']> {
    return this.http.put<S['MediaView']>(
      `${BASE}/projects/${projectKey}/media/${uuid}`,
      body,
      this.mutationOptions(etag),
    );
  }

  mediaBinaryUrl(projectKey: string, uuid: string, variant?: string): string {
    const query = variant ? `?variant=${encodeURIComponent(variant)}` : '';
    return `${BASE}/projects/${projectKey}/media/${uuid}/binary${query}`;
  }

  mediaThumbnailUrl(projectKey: string, uuid: string): string {
    return `${BASE}/projects/${projectKey}/media/${uuid}/thumbnail`;
  }

  mediaThumbnailBlob(projectKey: string, uuid: string): Observable<Blob> {
    return this.http.get(this.mediaThumbnailUrl(projectKey, uuid), {
      responseType: 'blob',
    });
  }

  // ── Preview ─────────────────────────────────────────────────────────────

  previewPage(
    projectKey: string,
    body: S['PreviewPageRequest'],
    channel?: string,
  ): Observable<string> {
    return this.http.post(`${BASE}/projects/${projectKey}/preview/page`, body, {
      withCredentials: true,
      params: this.params({ channel }),
      responseType: 'text',
    });
  }

  previewSavedPage(
    projectKey: string,
    uuid: string,
    revision?: number,
    channel?: string,
  ): Observable<string> {
    return this.http.get(`${BASE}/projects/${projectKey}/preview/pages/${uuid}`, {
      withCredentials: true,
      params: this.params({ revision, channel }),
      responseType: 'text',
    });
  }

  previewSection(
    projectKey: string,
    body: S['PreviewSectionRequest'],
    channel?: string,
  ): Observable<string> {
    return this.http.post(`${BASE}/projects/${projectKey}/preview/section`, body, {
      withCredentials: true,
      params: this.params({ channel }),
      responseType: 'text',
    });
  }

  sharePreviewUrl(
    projectKey: string,
    uuid: string,
    revision?: number,
    channel?: string,
  ): Observable<S['PreviewShareLink']> {
    return this.http.get<S['PreviewShareLink']>(
      `${BASE}/projects/${projectKey}/preview/pages/${uuid}/share`,
      { withCredentials: true, params: this.params({ revision, channel }) },
    );
  }

  // ── Revisions ───────────────────────────────────────────────────────────

  listRevisions(
    projectKey: string,
    opts?: { since?: number; userId?: number; assetUuid?: string },
  ): Observable<S['RevisionView'][]> {
    return this.http.get<S['RevisionView'][]>(
      `${BASE}/projects/${projectKey}/revisions`,
      { withCredentials: true, params: this.params(opts) },
    );
  }

  getRevision(projectKey: string, revisionId: number): Observable<S['RevisionView']> {
    return this.http.get<S['RevisionView']>(
      `${BASE}/projects/${projectKey}/revisions/${revisionId}`,
      { withCredentials: true },
    );
  }

  revisionDiff(
    projectKey: string,
    revisionId: number,
  ): Observable<S['RevisionDiff']> {
    return this.http.get<S['RevisionDiff']>(
      `${BASE}/projects/${projectKey}/revisions/${revisionId}/diff`,
      { withCredentials: true },
    );
  }

  restoreProject(
    projectKey: string,
    body: S['ProjectRestoreRequest'],
  ): Observable<S['RevisionView']> {
    return this.http.post<S['RevisionView']>(
      `${BASE}/projects/${projectKey}/restore`,
      body,
      { withCredentials: true },
    );
  }

  assetVersion(
    projectKey: string,
    uuid: string,
    revision: number,
  ): Observable<S['AssetDetailView']> {
    return this.http.get<S['AssetDetailView']>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/versions/${revision}`,
      { withCredentials: true },
    );
  }

  changeUid(
    projectKey: string,
    uuid: string,
    body: S['UidChangeRequest'],
  ): Observable<S['UidChangeResult']> {
    return this.http.patch<S['UidChangeResult']>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/uid`,
      body,
      { withCredentials: true },
    );
  }
}
