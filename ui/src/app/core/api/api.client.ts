import { HttpClient, HttpContext, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from './error.interceptor';
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

  /**
   * Changes the caller's own password. The server revokes every session of the account on success, so the caller
   * signs in again with the new password (`SessionService.changeOwnPassword`). Errors are shown by the form.
   */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(
      `${BASE}/auth/password`,
      { currentPassword, newPassword },
      { withCredentials: true, context: new HttpContext().set(SKIP_ERROR_TOAST, true) },
    );
  }

  /** Edits the caller's profile (M26); answers the updated profile. Errors are shown by the form. */
  updateMe(body: S['UpdateMeRequest']): Observable<S['MeResponse']> {
    return this.http.patch<S['MeResponse']>(`${BASE}/auth/me`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** The rules a new password must meet (public). */
  passwordPolicy(): Observable<S['PasswordPolicyView']> {
    return this.http.get<S['PasswordPolicyView']>(`${BASE}/auth/password-policy`, { withCredentials: true });
  }

  /** Signs the caller out of every session, this one included. */
  revokeAllSessions(): Observable<void> {
    return this.http.post<void>(`${BASE}/auth/sessions/revoke`, null, { withCredentials: true });
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

  /** The project's content languages (M24). */
  getProjectLocales(key: string): Observable<S['ProjectLocalesView']> {
    return this.http.get<S['ProjectLocalesView']>(`${BASE}/projects/${key}/locales`, {
      withCredentials: true,
    });
  }

  /**
   * Replaces the project's content languages. `confirmDiscard` authorises a change that would
   * reduce language-dependent values to one language; without it the server answers with
   * `confirmationRequired` and writes nothing.
   */
  updateProjectLocales(
    key: string,
    body: S['ProjectLocalesRequest'],
    confirmDiscard = false,
  ): Observable<S['ProjectLocalesView']> {
    const query = confirmDiscard ? '?confirmDiscard=true' : '';
    return this.http.put<S['ProjectLocalesView']>(`${BASE}/projects/${key}/locales${query}`, body, {
      withCredentials: true,
    });
  }

  /**
   * How complete one asset's translations are (M24.4.2): per language, how many language-dependent
   * fields the default language fills that it does not.
   */
  translationStatus(projectKey: string, uuid: string): Observable<S['TranslationStatusView']> {
    return this.http.get<S['TranslationStatusView']>(
      `${BASE}/projects/${projectKey}/translation-status/${uuid}`,
      { withCredentials: true },
    );
  }

  /** Every asset's translation status; `locale` lists only those still missing a translation in it. */
  listTranslationStatus(
    projectKey: string,
    opts: { type?: string; locale?: string } = {},
  ): Observable<S['TranslationStatusView'][]> {
    return this.http.get<S['TranslationStatusView'][]>(
      `${BASE}/projects/${projectKey}/translation-status`,
      { withCredentials: true, params: this.params(opts) },
    );
  }

  listMembers(key: string): Observable<S['ProjectMemberView'][]> {
    return this.http.get<S['ProjectMemberView'][]>(
      `${BASE}/projects/${key}/members`,
      { withCredentials: true },
    );
  }

  /** Adds a member or changes their role (M26). */
  setMemberRole(key: string, userId: number, role: string): Observable<S['ProjectMemberView']> {
    return this.http.put<S['ProjectMemberView']>(
      `${BASE}/projects/${key}/members/${userId}`,
      { role },
      { withCredentials: true },
    );
  }

  removeMember(key: string, userId: number): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${key}/members/${userId}`, { withCredentials: true });
  }

  /** Accounts a project admin can add to `projectKey` (M26): at most 20, never with emails. */
  lookupUsers(projectKey: string, q: string): Observable<S['UserLookupHit'][]> {
    return this.http.get<S['UserLookupHit'][]>(`${BASE}/users/lookup`, {
      withCredentials: true,
      params: this.params({ projectKey, q }),
    });
  }

  /** Makes the project read-only and hides it from its members (instance admin, M26). */
  archiveProject(key: string): Observable<void> {
    return this.http.post<void>(`${BASE}/projects/${key}/archive`, null, { withCredentials: true });
  }

  unarchiveProject(key: string): Observable<void> {
    return this.http.post<void>(`${BASE}/projects/${key}/unarchive`, null, { withCredentials: true });
  }

  // ── Administration (instance admins, M26) ─────────────────────────────────

  adminListUsers(query: {
    q?: string;
    status?: string;
    systemRole?: string;
    includeDeleted?: boolean;
    page?: number;
    size?: number;
    sort?: string;
  }): Observable<S['AdminUserPage']> {
    return this.http.get<S['AdminUserPage']>(`${BASE}/admin/users`, {
      withCredentials: true,
      params: this.params(query),
    });
  }

  adminGetUser(id: number): Observable<S['AdminUserDetail']> {
    return this.http.get<S['AdminUserDetail']>(`${BASE}/admin/users/${id}`, { withCredentials: true });
  }

  /** Errors are shown by the create dialog. */
  adminCreateUser(body: S['CreateUserRequest']): Observable<S['AdminUserDetail']> {
    return this.http.post<S['AdminUserDetail']>(`${BASE}/admin/users`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Errors are shown by the profile form. */
  adminUpdateUser(id: number, body: S['UpdateUserRequest']): Observable<S['AdminUserDetail']> {
    return this.http.patch<S['AdminUserDetail']>(`${BASE}/admin/users/${id}`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  adminUserAction(id: number, action: 'disable' | 'enable' | 'unlock'): Observable<S['AdminUserDetail']> {
    return this.http.post<S['AdminUserDetail']>(`${BASE}/admin/users/${id}/${action}`, null, {
      withCredentials: true,
    });
  }

  adminRevokeSessions(id: number): Observable<void> {
    return this.http.post<void>(`${BASE}/admin/users/${id}/revoke-sessions`, null, { withCredentials: true });
  }

  /** Errors are shown by the reset dialog. */
  adminResetPassword(id: number, body: S['ResetPasswordRequest']): Observable<S['AdminUserDetail']> {
    return this.http.post<S['AdminUserDetail']>(`${BASE}/admin/users/${id}/password`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  adminSetSystemRole(id: number, systemRole: string): Observable<S['AdminUserDetail']> {
    return this.http.put<S['AdminUserDetail']>(
      `${BASE}/admin/users/${id}/system-role`,
      { systemRole },
      { withCredentials: true },
    );
  }

  /** Anonymizes the account; `confirm` must be its current username. Errors are shown by the delete dialog. */
  adminDeleteUser(id: number, confirm: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/admin/users/${id}`, {
      withCredentials: true,
      params: this.params({ confirm }),
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  adminListProjects(query: { q?: string; includeArchived?: boolean } = {}): Observable<S['AdminProjectRow'][]> {
    return this.http.get<S['AdminProjectRow'][]>(`${BASE}/admin/projects`, {
      withCredentials: true,
      params: this.params(query),
    });
  }

  /** The instance audit trail, newest first; `action` may repeat. */
  adminAudit(query: {
    action?: string[];
    userId?: number;
    project?: string;
    from?: string;
    to?: string;
    page?: number;
    size?: number;
  }): Observable<S['AdminAuditPage']> {
    let params = this.params({
      userId: query.userId,
      project: query.project,
      from: query.from,
      to: query.to,
      page: query.page,
      size: query.size,
    });
    for (const action of query.action ?? []) {
      params = params.append('action', action);
    }
    return this.http.get<S['AdminAuditPage']>(`${BASE}/admin/audit`, { withCredentials: true, params });
  }

  adminAuditActions(): Observable<string[]> {
    return this.http.get<string[]>(`${BASE}/admin/audit/actions`, { withCredentials: true });
  }

  // ── Folders ─────────────────────────────────────────────────────────────

  listFolders(projectKey: string, scope: 'PAGES' | 'MEDIA' | 'NAVIGATION', depth?: number): Observable<S['FolderView'][]> {
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

  /** Swaps the file; `processCmsCleared` reports a processed file that is no longer text (M18). */
  replaceMedia(projectKey: string, uuid: string, file: File): Observable<S['MediaSaveResponse']> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<S['MediaSaveResponse']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/replace`,
      formData,
      { withCredentials: true },
    );
  }

  /**
   * `locale` (M24) writes alt text and caption for one content language, leaving the others as they
   * are; `copyright` stays single-valued. Omitted, the project's default language is written.
   */
  updateMediaMetadata(
    projectKey: string,
    uuid: string,
    body: S['MediaMetadataRequest'],
    etag?: number,
    locale?: string,
  ): Observable<S['MediaView']> {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
    return this.http.put<S['MediaView']>(
      `${BASE}/projects/${projectKey}/media/${uuid}${query}`,
      body,
      this.mutationOptions(etag),
    );
  }

  /** Switches CMS syntax processing of a text media file on or off (M18.1.1); a 422 carries `diagnostics`. */
  setMediaProcessCms(
    projectKey: string,
    uuid: string,
    processCms: boolean,
    etag?: number,
  ): Observable<S['MediaSaveResponse']> {
    return this.http.put<S['MediaSaveResponse']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/process`,
      { processCms } satisfies S['MediaProcessRequest'],
      this.mutationOptions(etag),
    );
  }

  /** A text media file's content, current or at a time-travel `revision` (M18.1.2). */
  mediaText(projectKey: string, uuid: string, revision?: number | null): Observable<S['MediaTextView']> {
    return this.http.get<S['MediaTextView']>(`${BASE}/projects/${projectKey}/media/${uuid}/text`, {
      withCredentials: true,
      params: this.params({ revision: revision ?? undefined }),
    });
  }

  /** Saves a text media file's content: one revision per change; a 422 carries `diagnostics`. */
  saveMediaText(
    projectKey: string,
    uuid: string,
    text: string,
    etag?: number,
  ): Observable<S['MediaSaveResponse']> {
    return this.http.put<S['MediaSaveResponse']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/text`,
      { text } satisfies S['MediaTextRequest'],
      this.mutationOptions(etag),
    );
  }

  /** Compiles draft text as the file's CMS syntax source without saving (M18.2.1). */
  validateMediaText(projectKey: string, uuid: string, text: string): Observable<S['OctlValidateResponse']> {
    return this.http.post<S['OctlValidateResponse']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/text/validate`,
      { text } satisfies S['MediaTextRequest'],
      { withCredentials: true },
    );
  }

  /** The rendered output of a processed text media file, as text (M18.3.2); a 422 carries `diagnostics`. */
  mediaRenderedText(projectKey: string, uuid: string, revision?: number | null): Observable<string> {
    return this.http.get(`${BASE}/projects/${projectKey}/media/${uuid}/binary`, {
      withCredentials: true,
      params: this.params({ rendered: true, revision: revision ?? undefined }),
      responseType: 'text',
    });
  }

  mediaBinaryUrl(projectKey: string, uuid: string, variant?: string): string {
    const query = variant ? `?variant=${encodeURIComponent(variant)}` : '';
    return `${BASE}/projects/${projectKey}/media/${uuid}/binary${query}`;
  }

  /** Fetches a media binary (or named variant) through `HttpClient`, so the app's Bearer session
   * (attached by the auth interceptor) rides along — unlike a plain `<img src>`/`<a href>`
   * pointed at `mediaBinaryUrl()`, which the browser fetches directly with no auth header and
   * gets a 401 from the `/binary` route's `VIEWER`-gated `@PreAuthorize` (mirrors
   * `mediaThumbnailBlob`, which already solves this same problem for grid thumbnails). */
  mediaBinaryBlob(projectKey: string, uuid: string, variant?: string): Observable<Blob> {
    return this.http.get(this.mediaBinaryUrl(projectKey, uuid, variant), {
      responseType: 'blob',
    });
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

  previewSavedPage(
    projectKey: string,
    uuid: string,
    revision?: number,
    channel?: string,
    locale?: string,
  ): Observable<string> {
    return this.http.get(`${BASE}/projects/${projectKey}/preview/pages/${uuid}`, {
      withCredentials: true,
      params: this.params({ revision, channel, locale }),
      responseType: 'text',
    });
  }

  /**
   * A saved page's preview with its response headers (M21.3.1): `page` renders that page of a paginated page, and
   * `X-SF-Total-Pages`/`X-SF-Page` tell how many pages there are and which one was rendered.
   */
  previewSavedPageResponse(
    projectKey: string,
    uuid: string,
    revision?: number,
    channel?: string,
    page?: number,
    locale?: string,
  ): Observable<HttpResponse<string>> {
    return this.http.get(`${BASE}/projects/${projectKey}/preview/pages/${uuid}`, {
      withCredentials: true,
      params: this.params({ revision, channel, page, locale }),
      responseType: 'text',
      observe: 'response',
    });
  }

  /** How many items a pagination source holds now (M21.4.1): the page editor's "N items → M pages" hint. */
  paginationCount(
    projectKey: string,
    kind: 'NAV' | 'DATASET',
    source: string,
  ): Observable<{ itemCount: number; skipped: number }> {
    return this.http.get<{ itemCount: number; skipped: number }>(`${BASE}/projects/${projectKey}/pagination/count`, {
      withCredentials: true,
      params: this.params({ kind, source }),
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
    locale?: string,
  ): Observable<S['PreviewShareLink']> {
    return this.http.get<S['PreviewShareLink']>(
      `${BASE}/projects/${projectKey}/preview/pages/${uuid}/share`,
      { withCredentials: true, params: this.params({ revision, channel, locale }) },
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

  renameAsset(
    projectKey: string,
    uuid: string,
    body: S['RenameAssetRequest'],
    etag?: number,
  ): Observable<S['AssetDetailView']> {
    return this.http.patch<S['AssetDetailView']>(
      `${BASE}/projects/${projectKey}/assets/${uuid}/display-name`,
      body,
      this.mutationOptions(etag),
    );
  }
}
