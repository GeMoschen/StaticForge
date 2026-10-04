import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type NavTreeView = S['NavTreeView'];
export type NavigationFolderView = S['NavigationFolderView'];
export type NavigationStartNodeView = S['NavigationStartNodeView'];
export type PageReferenceView = S['PageReferenceView'];
export type CreatePageReferenceRequest = S['CreatePageReferenceRequest'];
export type UpdatePageReferenceRequest = S['UpdatePageReferenceRequest'];
export type PageReferenceResolveView = S['PageReferenceResolveView'];
export type FolderView = S['FolderView'];
export type UrlRegistryEntryView = S['UrlRegistryEntryView'];
export type PageUrlRegistryEntryView = S['PageUrlRegistryEntryView'];
export type ReorderNavigationRequest = S['ReorderNavigationRequest'];

/** Raw shape of a navigation folder's `startNode` payload field — a child within the same folder, or absent/null for a pure grouping node. */
export interface StartNodeInput {
  kind: 'PAGE_REFERENCE' | 'FOLDER';
  assetUuid: string;
}

/** Partial-update body for `PATCH .../navigation/folders/{uuid}` — `startNode` must be independently omittable (leave untouched) vs. explicitly `null` (clear), see `M8.1.5`'s resolution notes. */
export interface NavigationFolderPatch {
  displayName?: string;
  startNode?: StartNodeInput | null;
}

const BASE = '/api/v1';

/** Wire format for the backend's ETag: `"rev-<revision>"` (mirrors `RevisionHeaders#etag`). */
export function etagFor(revision: number): string {
  return `"rev-${revision}"`;
}

@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly http = inject(HttpClient);

  /** The full resolved navigation forest — one entry per top-level folder or unfoldered
   * reference, with no distinguished root node (matches Pages/Media/Templates). */
  tree(projectKey: string, depth?: number): Observable<NavTreeView[]> {
    return this.http.get<NavTreeView[]>(`${BASE}/projects/${projectKey}/navigation/tree`, {
      withCredentials: true,
      params: depth != null ? { depth } : undefined,
    });
  }

  /**
   * One page of the URL registry's page rows (M35.22): where each page is (or would be) published, for the public URLs
   * the menu shows. Read quietly — a menu without URLs is still usable, so a failure raises no error toast.
   */
  pageUrlRows(projectKey: string, page = 0, size = 500): Observable<PageUrlRegistryEntryView> {
    return this.http.get<PageUrlRegistryEntryView>(`${BASE}/projects/${projectKey}/url-registry`, {
      withCredentials: true,
      params: { targetType: 'PAGE', page, size },
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  // ── Folder CRUD (generic `/folders` endpoints, scoped to NAVIGATION — unchanged by M8.1.5) ──

  createFolder(projectKey: string, displayName: string, parentFolderUuid?: string): Observable<FolderView> {
    return this.http.post<FolderView>(
      `${BASE}/projects/${projectKey}/folders`,
      { displayName, parentFolderUuid, scope: 'NAVIGATION' },
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

  moveFolder(projectKey: string, uuid: string, folderUuid: string | undefined, etag?: string): Observable<unknown> {
    return this.http.post(
      `${BASE}/projects/${projectKey}/folders/${uuid}/move`,
      { folderUuid },
      this.mutationOptions(etag),
    );
  }

  deleteFolder(projectKey: string, uuid: string, cascade?: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/folders/${uuid}`, {
      withCredentials: true,
      params: cascade != null ? { cascade } : undefined,
    });
  }

  // ── Navigation-specific ──────────────────────────────────────────────────

  /** Renames a navigation folder and/or sets/clears its `startNode` in one call. */
  updateFolder(
    projectKey: string,
    uuid: string,
    patch: NavigationFolderPatch,
    etag?: string,
  ): Observable<NavigationFolderView> {
    const body: Record<string, unknown> = {};
    if (patch.displayName !== undefined) {
      body['displayName'] = patch.displayName;
    }
    if ('startNode' in patch) {
      body['startNode'] = patch.startNode;
    }
    return this.http.patch<NavigationFolderView>(
      `${BASE}/projects/${projectKey}/navigation/folders/${uuid}`,
      body,
      this.mutationOptions(etag),
    );
  }

  /**
   * Stores the order of a folder's children (M35.22): the menu shows them in `childUuids` order, ahead of any child the
   * list does not name (those follow alphabetically); `[]` restores the alphabetical order. Answers the folder with the
   * revision this write produced.
   */
  reorderChildren(
    projectKey: string,
    folderUuid: string,
    childUuids: readonly string[],
    etag?: string,
  ): Observable<NavigationFolderView> {
    const body: ReorderNavigationRequest = { childUuids: [...childUuids] };
    return this.http.put<NavigationFolderView>(
      `${BASE}/projects/${projectKey}/navigation/folders/${folderUuid}/order`,
      body,
      this.mutationOptions(etag),
    );
  }

  createReference(projectKey: string, req: CreatePageReferenceRequest): Observable<PageReferenceView> {
    return this.http.post<PageReferenceView>(
      `${BASE}/projects/${projectKey}/navigation/references`,
      req,
      { withCredentials: true },
    );
  }

  /**
   * `locale` (M24) writes the label for one content language, leaving the others as they are;
   * omitted, the project's default language is written.
   */
  updateReference(
    projectKey: string,
    uuid: string,
    req: UpdatePageReferenceRequest,
    etag?: string,
    locale?: string,
  ): Observable<PageReferenceView> {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
    return this.http.patch<PageReferenceView>(
      `${BASE}/projects/${projectKey}/navigation/references/${uuid}${query}`,
      req,
      this.mutationOptions(etag),
    );
  }

  deleteReference(projectKey: string, uuid: string, force?: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/navigation/references/${uuid}`, {
      withCredentials: true,
      params: force != null ? { force } : undefined,
    });
  }

  resolveReference(projectKey: string, uuid: string): Observable<PageReferenceResolveView> {
    return this.http.get<PageReferenceResolveView>(
      `${BASE}/projects/${projectKey}/navigation/references/${uuid}/resolve`,
      { withCredentials: true },
    );
  }

  /** Moves a `PageReference` between navigation folders via the generic asset-move endpoint (M8.1.5: works for any AssetType with no changes). */
  moveReference(projectKey: string, uuid: string, folderUuid: string | undefined): Observable<unknown> {
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
