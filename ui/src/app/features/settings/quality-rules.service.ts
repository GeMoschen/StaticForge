import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import type { components } from '../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type QualityRulesView = S['QualityRulesView'];
export type QualityRuleItem = S['QualityRuleItem'];
export type QualityRuleParam = S['QualityRuleParam'];
export type QualityRulesRequest = S['QualityRulesRequest'];

const BASE = '/api/v1';

/**
 * `M30.1.2`'s per-project quality rule configuration: every rule with its default and configured severity and
 * parameters. The Quality settings tab shows `PUT`'s validation errors on the rules they name, so it skips the global
 * error toast.
 */
@Injectable({ providedIn: 'root' })
export class QualityRulesService {
  private readonly http = inject(HttpClient);

  get(projectKey: string): Observable<QualityRulesView> {
    return this.http.get<QualityRulesView>(`${BASE}/projects/${projectKey}/quality-rules`, { withCredentials: true });
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
