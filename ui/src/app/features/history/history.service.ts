import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Observable, map } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { HistoryFilter, filterToApi } from './history-model';
import { HistoryRow, RevisionApi, toHistoryRow } from './history-rows';

const BASE = '/api/v1';

export type AssetDiff = components['schemas']['AssetDiff'];

export interface HistoryPage {
  readonly rows: readonly HistoryRow[];
  /** How many revisions match in all, before paging. */
  readonly total: number;
}

export interface HistoryQuery {
  readonly filter: HistoryFilter;
  /** Only the revisions that touched this item (an editor's History). */
  readonly assetUuid?: string;
  /** 0-based. */
  readonly page: number;
  readonly size: number;
}

/**
 * The History screens' window on the API (M35.12): the project's revisions — filtered, paged, with the author's name
 * and the items they touched — one revision, the diffs, and the two ways back (restore an item, roll the project back).
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);

  list(projectKey: string, query: HistoryQuery, now = Date.now()): Observable<HistoryPage> {
    const api = filterToApi(query.filter, now);
    let params = new HttpParams().set('page', query.page).set('size', query.size);
    for (const [name, value] of Object.entries({ userId: api.userId, q: api.q, from: api.from, to: api.to, assetUuid: query.assetUuid })) {
      if (value !== undefined) {
        params = params.set(name, String(value));
      }
    }
    for (const type of api.changeType ?? []) {
      params = params.append('changeType', type);
    }
    return this.http
      .get<RevisionApi[]>(`${BASE}/projects/${projectKey}/revisions`, { withCredentials: true, params, observe: 'response' })
      .pipe(
        map((response) => {
          const rows = (response.body ?? []).map((rev) => this.row(rev));
          const total = Number(response.headers.get('X-Total-Count'));
          return { rows, total: Number.isFinite(total) && response.headers.has('X-Total-Count') ? total : rows.length };
        }),
      );
  }

  revision(projectKey: string, revisionId: number): Observable<HistoryRow> {
    return this.api.getRevision(projectKey, revisionId).pipe(map((rev) => this.row(rev as RevisionApi)));
  }

  revisionDiff(projectKey: string, revisionId: number): Observable<components['schemas']['RevisionDiff']> {
    return this.api.revisionDiff(projectKey, revisionId);
  }

  /** An item as of `from` against as of `to` (default: now). */
  assetDiff(projectKey: string, uuid: string, from: number, to?: number): Observable<AssetDiff> {
    let params = new HttpParams().set('from', from);
    if (to !== undefined) {
      params = params.set('to', to);
    }
    return this.http.get<AssetDiff>(`${BASE}/projects/${projectKey}/assets/${uuid}/diff`, { withCredentials: true, params });
  }

  restoreAsset(projectKey: string, uuid: string, fromRevision: number): Observable<unknown> {
    return this.api.restoreAsset(projectKey, uuid, { fromRevision });
  }

  /** Rolls the project back: a new revision that restores the state at `toRevision`. */
  rollBack(projectKey: string, toRevision: number, comment?: string): Observable<HistoryRow> {
    return this.api
      .restoreProject(projectKey, { toRevision, comment } as components['schemas']['ProjectRestoreRequest'])
      .pipe(map((rev) => this.row(rev as RevisionApi)));
  }

  private row(rev: RevisionApi): HistoryRow {
    return toHistoryRow(rev, this.transloco.translate('history.page.unknownAuthor'));
  }
}
