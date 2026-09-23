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
export type AssetRefView = S['AssetRefView'];
export type RecordSetSummaryView = S['RecordSetSummaryView'];
export type RecordSetDetailView = S['RecordSetDetailView'];
export type RecordSetQuery = S['RecordSetQuery'];
export type RecordSetQueryDiagnostic = S['RecordSetQueryDiagnostic'];
export type RecordSetQueryPreviewView = S['RecordSetQueryPreviewView'];
export type CreateRecordSetRequest = S['CreateRecordSetRequest'];
export type UpdateRecordSetRequest = S['UpdateRecordSetRequest'];

/** `FolderView.type` of a record set leaf in the Content folder tree (M25). */
export const RECORD_SET_TYPE = 'RECORD_SET';

/**
 * What a record create sends (M25): the record set it goes into — which also fixes its dataset —
 * and its first values. `CreateRecordRequest` on the wire, with `content` typed as the JSON it is.
 */
export interface CreateRecordBody {
  recordSetUuid: string;
  displayName?: string;
  content: Record<string, unknown>;
}

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
 * A record set grid request (M25): the listing parameters, without a folder, plus whether the set's own
 * query applies and, for time travel, the revision to list the set at.
 */
export interface RecordSetGridQuery extends Omit<RecordQuery, 'folder'> {
  /** `true`: the stored query runs first (render order, excluded records left out); `false`: every record. */
  applySetQuery: boolean;
  /** The set as of this revision — its records, their values and its query then (`null`/absent: current). */
  revision?: number | null;
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

/** The HTTP params of a record set grid request; `folder` doesn't apply (a set is the scope). */
export function recordSetGridParams(query: RecordSetGridQuery): Record<string, string | string[]> {
  const { applySetQuery, revision, ...listing } = query;
  const params = recordQueryParams(listing);
  if (applySetQuery) {
    params['applySetQuery'] = 'true';
  }
  if (revision != null) {
    params['revision'] = String(revision);
  }
  return params;
}

/**
 * Content store client (M19.4, M25): dataset schemas, record sets, records and Content folders.
 *
 * <p>Schemas are developer-owned (`DEVELOPER` writes), record sets and records editor-owned (`EDITOR`
 * writes). Folders use the generic `/folders` endpoints with `scope=CONTENT`; moving, renaming,
 * deleting, restoring, history and usages of a set or record use the generic asset endpoints.
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

  /** Adds a record to a record set; `datasetUuid` must be the set's dataset (M25). */
  createRecord(projectKey: string, datasetUuid: string, req: CreateRecordBody): Observable<RecordDetailView> {
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

  // ── Record sets (M25) ─────────────────────────────────────────────────

  /** Live record sets by display name; `datasetUuid` narrows them to one dataset's. */
  listRecordSets(projectKey: string, datasetUuid?: string): Observable<RecordSetSummaryView[]> {
    return this.http.get<RecordSetSummaryView[]>(`${BASE}/projects/${projectKey}/record-sets`, {
      withCredentials: true,
      params: datasetUuid ? { dataset: datasetUuid } : undefined,
    });
  }

  /** One record set with its stored query; `revision` reads it as it was then (time travel). */
  getRecordSet(projectKey: string, uuid: string, revision?: number | null): Observable<RecordSetDetailView> {
    return this.http.get<RecordSetDetailView>(`${BASE}/projects/${projectKey}/record-sets/${uuid}`, {
      withCredentials: true,
      params: revision != null ? { revision } : undefined,
    });
  }

  createRecordSet(projectKey: string, req: CreateRecordSetRequest): Observable<RecordSetDetailView> {
    return this.http.post<RecordSetDetailView>(`${BASE}/projects/${projectKey}/record-sets`, req, {
      withCredentials: true,
    });
  }

  /** Replaces the set's display name and/or its whole query; `If-Match` is required. */
  updateRecordSet(
    projectKey: string,
    uuid: string,
    req: UpdateRecordSetRequest,
    etag: string,
  ): Observable<RecordSetDetailView> {
    return this.http.put<RecordSetDetailView>(`${BASE}/projects/${projectKey}/record-sets/${uuid}`, req, {
      withCredentials: true,
      headers: { 'If-Match': etag },
    });
  }

  /** Deletes a set; one with live records needs `cascade` (its records go in the same revision). */
  deleteRecordSet(projectKey: string, uuid: string, cascade: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/projects/${projectKey}/record-sets/${uuid}`, {
      withCredentials: true,
      params: cascade ? { cascade: 'true' } : undefined,
    });
  }

  /** The set's grid: every record, or with `applySetQuery` the records the set shows, in its order. */
  listSetRecords(projectKey: string, uuid: string, query: RecordSetGridQuery): Observable<RecordPageView> {
    return this.http.get<RecordPageView>(`${BASE}/projects/${projectKey}/record-sets/${uuid}/records`, {
      withCredentials: true,
      params: recordSetGridParams(query),
    });
  }

  /** Validates a draft set query and counts what it would select; nothing is saved. */
  previewSetQuery(projectKey: string, uuid: string, query: RecordSetQuery): Observable<RecordSetQueryPreviewView> {
    return this.http.post<RecordSetQueryPreviewView>(
      `${BASE}/projects/${projectKey}/record-sets/${uuid}/preview-query`,
      query,
      { withCredentials: true },
    );
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

  /**
   * Moves an asset through the generic asset-move endpoint: a record set into a Content folder
   * (`undefined`: the store root), a record into another set of its dataset (M25).
   */
  moveAsset(projectKey: string, uuid: string, folderUuid: string | undefined): Observable<unknown> {
    return this.http.post(`${BASE}/projects/${projectKey}/assets/${uuid}/move`, { folderUuid }, { withCredentials: true });
  }
}
