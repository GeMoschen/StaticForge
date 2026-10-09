import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../../../core/api/error.interceptor';
import type { components } from '../../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type QualityRulesView = S['QualityRulesView'];
export type QualityRuleItem = S['QualityRuleItem'];
export type QualityRuleParam = S['QualityRuleParam'];
export type QualityRulesRequest = S['QualityRulesRequest'];

/**
 * The project's last finished run on its default target (`SUCCESS` or `PARTIAL`) and its findings per rule. Both are
 * `null` while no run has finished. `counts` covers the stored findings only (`truncated` were dropped by the caps);
 * a rule without findings is absent from it.
 */
export interface QualityLastRunView {
  run: {
    id: number;
    status: string;
    finishedAt: string;
    targetId: number | null;
    findingErrors: number;
    findingWarnings: number;
    truncated: number;
  } | null;
  counts: Record<string, number> | null;
}

const BASE = '/api/v1';

/**
 * `M30.1.2`'s per-project quality rule configuration: every rule with its default and configured severity and
 * parameters. The Quality page shows `PUT`'s validation errors on the rules they name, so it skips the global error
 * toast.
 */
@Injectable({ providedIn: 'root' })
export class QualityRulesService {
  private readonly http = inject(HttpClient);

  get(projectKey: string): Observable<QualityRulesView> {
    return this.http.get<QualityRulesView>(`${BASE}/projects/${projectKey}/quality-rules`, { withCredentials: true });
  }

  /** The findings per rule of the last finished run (M35.24); every member reads it. */
  lastRun(projectKey: string): Observable<QualityLastRunView> {
    return this.http.get<QualityLastRunView>(`${BASE}/projects/${projectKey}/quality-rules/last-run`, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }

  /**
   * Replaces the configuration (`DEVELOPER`); a rule left out is at its default. `400 SF-API-0400` lists one message
   * per invalid entry under `errors`, each starting with the rule's code.
   */
  update(projectKey: string, body: QualityRulesRequest): Observable<QualityRulesView> {
    return this.http.put<QualityRulesView>(`${BASE}/projects/${projectKey}/quality-rules`, body, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }
}
