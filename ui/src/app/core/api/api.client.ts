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

/** Which state a page preview renders (M27.2.3): the drafts (default) or what the next build publishes. */
export type PreviewView = 'draft' | 'published';

/** The Changes list's filters (M27.1.3); `type`, `status` and `locale` may repeat. */
export interface ChangesQuery {
  type?: string[];
  status?: string[];
  locale?: string[];
  changedBy?: number;
  folderUuid?: string;
  q?: string;
  sort?: string;
  page?: number;
  size?: number;
}

/** The Schedules list's filters (M27.4.4); `type` and `status` may repeat. */
export interface SchedulesQuery {
  type?: string[];
  status?: string[];
  owner?: number;
  assetUuid?: string;
  page?: number;
  size?: number;
}

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

  // ── System jobs (instance admins, M29) ────────────────────────────────────

  /** Every system job, orphaned ones (row without code) included. */
  adminJobs(): Observable<S['AdminJobView'][]> {
    return this.http.get<S['AdminJobView'][]>(`${BASE}/admin/jobs`, { withCredentials: true });
  }

  adminJob(key: string): Observable<S['AdminJobView']> {
    return this.http.get<S['AdminJobView']>(`${BASE}/admin/jobs/${encodeURIComponent(key)}`, { withCredentials: true });
  }

  /** The job's runs, newest first, each with its report sample. */
  adminJobRuns(key: string, page = 0, size = 20): Observable<S['AdminJobRunPage']> {
    return this.http.get<S['AdminJobRunPage']>(`${BASE}/admin/jobs/${encodeURIComponent(key)}/runs`, {
      withCredentials: true,
      params: this.params({ page, size }),
    });
  }

  /** One run with its full report; polled until `finishedAt` is set. */
  adminJobRun(key: string, runId: number): Observable<S['AdminJobRunView']> {
    return this.http.get<S['AdminJobRunView']>(`${BASE}/admin/jobs/${encodeURIComponent(key)}/runs/${runId}`, {
      withCredentials: true,
    });
  }

  /**
   * Changes schedule and settings (merged) of the job read at `version` (`If-Match: "v{version}"`). `422 SF-DOM-0180`
   * lists every problem under `errors` and `409 SF-API-0409` means stale; both are shown by the form.
   */
  adminUpdateJob(key: string, version: number, body: S['UpdateJobRequest']): Observable<S['AdminJobView']> {
    return this.http.patch<S['AdminJobView']>(`${BASE}/admin/jobs/${encodeURIComponent(key)}`, body, {
      withCredentials: true,
      headers: { 'If-Match': `"v${version}"` },
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Back to the property defaults and the instance's job zone. */
  adminResetJob(key: string): Observable<S['AdminJobView']> {
    return this.http.post<S['AdminJobView']>(`${BASE}/admin/jobs/${encodeURIComponent(key)}/reset`, null, {
      withCredentials: true,
    });
  }

  /** Starts a run (`202`, the run as it started); `409 SF-DOM-0181` while the job is running. */
  adminRunJob(key: string, dryRun: boolean): Observable<S['AdminJobRunView']> {
    return this.http.post<S['AdminJobRunView']>(`${BASE}/admin/jobs/${encodeURIComponent(key)}/run`, null, {
      withCredentials: true,
      params: this.params({ dryRun }),
    });
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

  /**
   * One media asset with the file each language renders (`localeFiles`, M27.6.4); `revision` reads the version valid
   * then (time travel). List rows don't carry the per-language files.
   */
  mediaDetail(projectKey: string, uuid: string, revision?: number | null): Observable<S['MediaView']> {
    return this.http.get<S['MediaView']>(`${BASE}/projects/${projectKey}/media/${uuid}`, {
      withCredentials: true,
      params: this.params({ revision: revision ?? undefined }),
    });
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

  /**
   * A text media file's content, current or at a time-travel `revision` (M18.1.2). For localized media, `locale`
   * reads the file that language renders (M27.3.1); omitted, the default file.
   */
  mediaText(
    projectKey: string,
    uuid: string,
    revision?: number | null,
    locale?: string | null,
  ): Observable<S['MediaTextView']> {
    return this.http.get<S['MediaTextView']>(`${BASE}/projects/${projectKey}/media/${uuid}/text`, {
      withCredentials: true,
      params: this.params({ revision: revision ?? undefined, locale: locale ?? undefined }),
    });
  }

  /**
   * Saves a text media file's content: one revision per change; a 422 carries `diagnostics`. For localized media,
   * `locale` writes that language's own file (M27.3.1).
   */
  saveMediaText(
    projectKey: string,
    uuid: string,
    text: string,
    etag?: number,
    locale?: string | null,
  ): Observable<S['MediaSaveResponse']> {
    return this.http.put<S['MediaSaveResponse']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/text`,
      { text } satisfies S['MediaTextRequest'],
      { ...this.mutationOptions(etag), params: this.params({ locale: locale ?? undefined }) },
    );
  }

  /**
   * Localizes or un-localizes media (M27.3.1): one file per language, or one for all. Un-localizing with other
   * language files answers `409 SF-MEDIA-0505` listing them (`files`) unless `confirmDiscard`.
   */
  setMediaLocalized(
    projectKey: string,
    uuid: string,
    localized: boolean,
    confirmDiscard: boolean,
    etag?: number,
  ): Observable<S['MediaView']> {
    // The drawer turns the 409 into its own confirmation, so no error toast next to it.
    return this.http.put<S['MediaView']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/localized`,
      { localized, confirmDiscard } satisfies S['MediaLocalizedRequest'],
      { ...this.mutationOptions(etag), context: new HttpContext().set(SKIP_ERROR_TOAST, true) },
    );
  }

  /** Uploads or replaces one language's own file of localized media (M27.3.1). */
  putMediaLocaleFile(projectKey: string, uuid: string, locale: string, file: File): Observable<S['MediaSaveResponse']> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<S['MediaSaveResponse']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/files/${encodeURIComponent(locale)}`,
      formData,
      { withCredentials: true },
    );
  }

  /** Removes one language's own file, so the language falls back again (M27.3.1). */
  removeMediaLocaleFile(projectKey: string, uuid: string, locale: string): Observable<S['MediaView']> {
    return this.http.delete<S['MediaView']>(
      `${BASE}/projects/${projectKey}/media/${uuid}/files/${encodeURIComponent(locale)}`,
      { withCredentials: true },
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

  /** `locale` picks the file a language renders, for localized media (M27.3.1). */
  mediaBinaryUrl(projectKey: string, uuid: string, variant?: string, locale?: string | null): string {
    const query = new URLSearchParams();
    if (variant) {
      query.set('variant', variant);
    }
    if (locale) {
      query.set('locale', locale);
    }
    const text = query.toString();
    return `${BASE}/projects/${projectKey}/media/${uuid}/binary${text ? `?${text}` : ''}`;
  }

  /** Fetches a media binary (or named variant) through `HttpClient`, so the app's Bearer session
   * (attached by the auth interceptor) rides along — unlike a plain `<img src>`/`<a href>`
   * pointed at `mediaBinaryUrl()`, which the browser fetches directly with no auth header and
   * gets a 401 from the `/binary` route's `VIEWER`-gated `@PreAuthorize` (mirrors
   * `mediaThumbnailBlob`, which already solves this same problem for grid thumbnails). */
  mediaBinaryBlob(projectKey: string, uuid: string, variant?: string, locale?: string | null): Observable<Blob> {
    return this.http.get(this.mediaBinaryUrl(projectKey, uuid, variant, locale), {
      responseType: 'blob',
    });
  }

  /** `locale` picks the file a language renders, for localized media (M27.3.1). */
  mediaThumbnailUrl(projectKey: string, uuid: string, locale?: string | null): string {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
    return `${BASE}/projects/${projectKey}/media/${uuid}/thumbnail${query}`;
  }

  mediaThumbnailBlob(projectKey: string, uuid: string, locale?: string | null): Observable<Blob> {
    return this.http.get(this.mediaThumbnailUrl(projectKey, uuid, locale), {
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
    view?: PreviewView,
  ): Observable<HttpResponse<string>> {
    return this.http.get(`${BASE}/projects/${projectKey}/preview/pages/${uuid}`, {
      withCredentials: true,
      params: this.params({ revision, channel, page, locale, view }),
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

  /** `view` (M27.2.3) is bound into the link: a published link keeps showing the released state. */
  sharePreviewUrl(
    projectKey: string,
    uuid: string,
    revision?: number,
    channel?: string,
    locale?: string,
    view?: PreviewView,
  ): Observable<S['PreviewShareLink']> {
    return this.http.get<S['PreviewShareLink']>(
      `${BASE}/projects/${projectKey}/preview/pages/${uuid}/share`,
      { withCredentials: true, params: this.params({ revision, channel, locale, view }) },
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

  // ── Releases (M27.1.3) ──────────────────────────────────────────────────

  /** What releasing `items` would take along (dependencies) and what blocks it (incomplete content). Writes nothing. */
  releasePlan(projectKey: string, body: S['ReleaseRequest']): Observable<S['ReleasePlanView']> {
    return this.http.post<S['ReleasePlanView']>(`${BASE}/projects/${projectKey}/releases/plan`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Releases the items and the kept dependencies in one revision; `422 SF-DOM-0150` for incomplete content. */
  release(projectKey: string, body: S['ReleaseRequest']): Observable<S['ReleaseResultView']> {
    return this.http.post<S['ReleaseResultView']>(`${BASE}/projects/${projectKey}/releases`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Takes the items offline; the drafts stay. */
  unpublish(projectKey: string, body: S['ReleaseRequest']): Observable<S['ReleaseResultView']> {
    return this.http.post<S['ReleaseResultView']>(`${BASE}/projects/${projectKey}/releases/unpublish`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Writes the released versions back as the drafts; `sharedFieldsKept` lists the items whose shared fields stayed. */
  discard(projectKey: string, body: S['ReleaseRequest']): Observable<S['ReleaseResultView']> {
    return this.http.post<S['ReleaseResultView']>(`${BASE}/projects/${projectKey}/releases/discard`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  // ── Changes (M27.1.3) ───────────────────────────────────────────────────

  /** One page of unreleased (asset, locale) pairs. */
  listChanges(projectKey: string, query: ChangesQuery = {}): Observable<S['ChangesPageView']> {
    return this.http.get<S['ChangesPageView']>(`${BASE}/projects/${projectKey}/changes`, {
      withCredentials: true,
      params: this.listParams(query),
    });
  }

  /** How many pending pairs there are per status, plus `total`. */
  changesCount(projectKey: string): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(`${BASE}/projects/${projectKey}/changes/count`, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** The released-to-draft diff of one asset in one locale (`locale` omitted: the shared key). */
  changeDiff(projectKey: string, uuid: string, locale?: string | null): Observable<S['ChangeDiffView']> {
    return this.http.get<S['ChangeDiffView']>(`${BASE}/projects/${projectKey}/changes/${uuid}/diff`, {
      withCredentials: true,
      params: this.params({ locale: locale || undefined }),
    });
  }

  // ── Schedules (M27.4.4) ─────────────────────────────────────────────────

  listSchedules(projectKey: string, query: SchedulesQuery = {}): Observable<S['SchedulePageView']> {
    return this.http.get<S['SchedulePageView']>(`${BASE}/projects/${projectKey}/schedules`, {
      withCredentials: true,
      params: this.listParams(query),
    });
  }

  schedule(projectKey: string, id: number): Observable<S['ScheduleView']> {
    return this.http.get<S['ScheduleView']>(`${BASE}/projects/${projectKey}/schedules/${id}`, {
      withCredentials: true,
    });
  }

  /** `422`: `SF-DOM-0160`–`0166` (type, params, time, cron, form) and the release codes. */
  createSchedule(projectKey: string, body: S['ScheduleRequest']): Observable<S['ScheduleView']> {
    return this.http.post<S['ScheduleView']>(`${BASE}/projects/${projectKey}/schedules`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Replaces time, policies and params of a pending schedule; `version` is its `If-Match` (`"v{version}"`). */
  updateSchedule(projectKey: string, id: number, version: number, body: S['ScheduleRequest']): Observable<S['ScheduleView']> {
    return this.http.put<S['ScheduleView']>(`${BASE}/projects/${projectKey}/schedules/${id}`, body, {
      withCredentials: true,
      headers: { 'If-Match': `"v${version}"` },
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** `cancel`, `take-over`, `run-now` or `repin` a schedule; answers the schedule as it is afterwards. */
  scheduleAction(
    projectKey: string,
    id: number,
    action: 'cancel' | 'take-over' | 'run-now' | 'repin',
  ): Observable<S['ScheduleView']> {
    return this.http.post<S['ScheduleView']>(`${BASE}/projects/${projectKey}/schedules/${id}/${action}`, null, {
      withCredentials: true,
    });
  }

  scheduleExecutions(
    projectKey: string,
    id: number,
    page = 0,
    size = 50,
  ): Observable<S['ScheduleExecutionPageView']> {
    return this.http.get<S['ScheduleExecutionPageView']>(`${BASE}/projects/${projectKey}/schedules/${id}/executions`, {
      withCredentials: true,
      params: this.params({ page, size }),
    });
  }

  // ── Publish policy (M28) ─────────────────────────────────────────────────

  /** What the project's editors may do to put content online. */
  publishPolicy(projectKey: string): Observable<S['PublishPolicyView']> {
    return this.http.get<S['PublishPolicyView']>(`${BASE}/projects/${projectKey}/publish-policy`, { withCredentials: true });
  }

  /** Replaces the policy (`PROJECT_ADMIN`); `400` lists broken implications under `errors`, shown by the card itself. */
  updatePublishPolicy(projectKey: string, body: S['PublishPolicyView']): Observable<S['PublishPolicyView']> {
    return this.http.put<S['PublishPolicyView']>(`${BASE}/projects/${projectKey}/publish-policy`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** The pending schedules a proposed policy would make fail at execution. */
  publishPolicyImpact(projectKey: string, body: S['PublishPolicyView']): Observable<S['PublishPolicyImpactView']> {
    return this.http.post<S['PublishPolicyImpactView']>(`${BASE}/projects/${projectKey}/publish-policy/impact`, body, {
      withCredentials: true,
    });
  }

  // ── Revision compaction (M29.4) ──────────────────────────────────────────

  /** The project's compaction policy, how far it has compacted and the last run on it (`PROJECT_ADMIN`). */
  compactionPolicy(projectKey: string): Observable<S['CompactionPolicyView']> {
    return this.http.get<S['CompactionPolicyView']>(`${BASE}/projects/${projectKey}/compaction`, { withCredentials: true });
  }

  /**
   * Sets the policy (`PROJECT_ADMIN`). Enabling or lowering `olderThanDays` needs `confirm` = the project key
   * (`422 SF-DOM-0182`); `olderThanDays` below 30 is `422 SF-DOM-0183`. Errors are shown by the card itself.
   */
  updateCompactionPolicy(
    projectKey: string,
    body: S['CompactionPolicyRequest'],
    confirm?: string,
  ): Observable<S['CompactionPolicyView']> {
    return this.http.put<S['CompactionPolicyView']>(`${BASE}/projects/${projectKey}/compaction`, body, {
      withCredentials: true,
      params: this.params({ confirm }),
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** What compacting now with `olderThanDays` would remove: a dry run that changes nothing (`PROJECT_ADMIN`). */
  compactionEstimate(projectKey: string, olderThanDays: number): Observable<S['CompactionEstimateView']> {
    return this.http.get<S['CompactionEstimateView']>(`${BASE}/projects/${projectKey}/compaction/estimate`, {
      withCredentials: true,
      params: this.params({ olderThanDays }),
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** The next run times of a cron in a zone, validated like a create (`422 SF-DOM-0165` for an invalid cron). */
  schedulePreviewTimes(projectKey: string, body: S['PreviewTimesRequest']): Observable<S['PreviewTimesView']> {
    return this.http.post<S['PreviewTimesView']>(`${BASE}/projects/${projectKey}/schedules/preview-times`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /** Query params where array values repeat the key (`type=PAGE&type=MEDIA`). */
  private listParams(values: object): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          params = params.append(key, String(item));
        }
      } else if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return params;
  }
}
