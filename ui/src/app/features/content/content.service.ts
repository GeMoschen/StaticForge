import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type DatasetSummaryView = S['DatasetSummaryView'];
export type DatasetDetailView = S['DatasetDetailView'];
export type CreateDatasetRequest = S['CreateDatasetRequest'];
export type UpdateDatasetRequest = S['UpdateDatasetRequest'];
export type RecordDetailView = S['RecordDetailView'];
export type RecordRowView = S['RecordRowView'];
export type RecordPageView = S['RecordPageView'];
export type FolderView = S['FolderView'];
export type Diagnostic = S['Diagnostic'];

const BASE = '/api/v1';

/** Wire format for the backend's ETag: `"rev-<revision>"` (mirrors `RevisionHeaders#etag`). */
export function etagFor(revision: number): string {
  return `"rev-${revision}"`;
}

/** One sort key of a record listing; serialized as `field,asc|desc`. */
export interface RecordSort {
  field: string;
  direction: 'asc' | 'desc';
}

/** A record listing request (M19.2.1): server-side paging, sorting and filtering. */
export interface RecordQuery {
  page: number;
  size: number;
  sort: RecordSort[];
  /** Display-name substring. */
  q?: string;
  /** OCTL expression over bare field names, e.g. `role == 'lead'`. */
  where?: string;
  /** Content-store-relative folder prefix, e.g. `/team/`. */
  folder?: string;
}

/**
 * The HTTP params of a record listing. `sort` repeats once per key (`sort=role,desc&sort=name,asc`),
 * blank filters are left out entirely so the server applies no filter.
 */
export function recordQueryParams(query: RecordQuery): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {
    page: String(query.page),
    size: String(query.size),
  };
  if (query.sort.length > 0) {
    params['sort'] = query.sort.map((s) => `${s.field},${s.direction}`);
  }
  if (query.q?.trim()) {
    params['q'] = query.q.trim();
  }
  if (query.where?.trim()) {
    params['where'] = query.where.trim();
  }
  if (query.folder && query.folder !== '/') {
    params['folder'] = query.folder;
  }
  return params;
}

/**
 * Content store client (M19.4): dataset schemas, records and Content folders.
 *
 * <p>Schemas are developer-owned (`DEVELOPER` writes), records editor-owned (`EDITOR` writes). Folders
 * use the generic `/folders` endpoints with `scope=CONTENT`; moving, deleting, restoring, history and
 * usages of a record use the generic asset endpoints on `ApiClient`.
 */
@Injectable({ providedIn: 'root' })
export class ContentService {
  private readonly http = inject(HttpClient);

  // ── Datasets ──────────────────────────────────────────────────────────

  listDatasets(projectKey: string): Observable<DatasetSummaryView[]> {
    return this.http.get<DatasetSummaryView[]>(`${BASE}/projects/${projectKey}/datasets`, { withCredentials: true });
  }

  /** One dataset; `revision` reads the schema valid then (time travel). */
  getDataset(projectKey: string, uuid: string, revision?: number | null): Observable<DatasetDetailView> {
    return this.http.get<DatasetDetailView>(`${BASE}/projects/${projectKey}/datasets/${uuid}`, {
      withCredentials: true,
      params: revision != null ? { revision } : undefined,
    });
  }

  createDataset(projectKey: string, req: CreateDatasetRequest): Observable<DatasetDetailView> {
    return this.http.post<DatasetDetailView>(`${BASE}/projects/${projectKey}/datasets`, req, { withCredentials: true });
  }

  updateDataset(projectKey: string, uuid: string, req: UpdateDatasetRequest, etag: string): Observable<DatasetDetailView> {
    return this.http.put<DatasetDetailView>(`${BASE}/projects/${projectKey}/datasets/${uuid}`, req, {
      withCredentials: true,
      headers: { 'If-Match': etag },
    });
  }

  deleteDataset(projectKey: string, uuid: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/datasets/${uuid}`, { withCredentials: true });
  }

  /** Validates draft schema CDL with the dataset restrictions (no bodies) the save enforces. */
  validateCdl(projectKey: string, source: string): Observable<{ diagnostics?: Diagnostic[] }> {
    return this.http.post<{ diagnostics?: Diagnostic[] }>(
      `${BASE}/projects/${projectKey}/cdl/validate`,
      { source },
      { withCredentials: true, params: { kind: 'DATASET' } },
    );
  }

  // ── Records ───────────────────────────────────────────────────────────

  listRecords(projectKey: string, datasetUuid: string, query: RecordQuery): Observable<RecordPageView> {
    return this.http.get<RecordPageView>(`${BASE}/projects/${projectKey}/datasets/${datasetUuid}/records`, {
      withCredentials: true,
      params: recordQueryParams(query),
    });
  }

  getRecord(projectKey: string, uuid: string, revision?: number | null): Observable<RecordDetailView> {
    return this.http.get<RecordDetailView>(`${BASE}/projects/${projectKey}/records/${uuid}`, {
      withCredentials: true,
      params: revision != null ? { revision } : undefined,
    });
  }

  createRecord(
    projectKey: string,
    datasetUuid: string,
    req: { folderUuid?: string; displayName?: string; content: Record<string, unknown> },
  ): Observable<RecordDetailView> {
    return this.http.post<RecordDetailView>(`${BASE}/projects/${projectKey}/datasets/${datasetUuid}/records`, req, {
      withCredentials: true,
    });
  }

  updateRecord(
    projectKey: string,
    uuid: string,
    req: { content: Record<string, unknown>; displayName?: string },
    etag: string,
  ): Observable<RecordDetailView> {
    return this.http.put<RecordDetailView>(`${BASE}/projects/${projectKey}/records/${uuid}`, req, {
      withCredentials: true,
      headers: { 'If-Match': etag },
    });
  }

  // ── Content folders (generic `/folders`, scoped to CONTENT) ─────────────

  folders(projectKey: string, depth = 10): Observable<FolderView[]> {
    return this.http.get<FolderView[]>(`${BASE}/projects/${projectKey}/folders`, {
      withCredentials: true,
      params: { scope: 'CONTENT', depth },
    });
  }

  createFolder(projectKey: string, displayName: string, parentFolderUuid?: string): Observable<FolderView> {
    return this.http.post<FolderView>(
      `${BASE}/projects/${projectKey}/folders`,
      { displayName, parentFolderUuid, scope: 'CONTENT' },
      { withCredentials: true },
    );
  }

  renameFolder(projectKey: string, uuid: string, displayName: string): Observable<FolderView> {
    return this.http.put<FolderView>(
      `${BASE}/projects/${projectKey}/folders/${uuid}`,
      { displayName },
      { withCredentials: true },
    );
  }

  moveFolder(projectKey: string, uuid: string, folderUuid: string | undefined): Observable<unknown> {
    return this.http.post(`${BASE}/projects/${projectKey}/folders/${uuid}/move`, { folderUuid }, { withCredentials: true });
  }

  /** Moves a record between Content folders through the generic asset-move endpoint. */
  moveRecord(projectKey: string, uuid: string, folderUuid: string | undefined): Observable<unknown> {
    return this.http.post(`${BASE}/projects/${projectKey}/assets/${uuid}/move`, { folderUuid }, { withCredentials: true });
  }
}
