import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  GenerationRunEvent,
  streamGenerationEvents,
} from './generation-sse';
import {
  entryQueryParams,
  type AssetImpactView,
  type GenerationPlanView,
  type PlanEntryQuery,
} from './insight/insight.util';
import {
  FINDINGS_PAGE_SIZE,
  findingApiParams,
  type FindingFilter,
  type FindingPageView,
  type QualityRuleItem,
} from './findings/findings.util';

type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationRequestDto = components['schemas']['GenerationRequestDto'];
type GenerationTargetView = components['schemas']['GenerationTargetView'];
type GenerationTargetRequest = components['schemas']['GenerationTargetRequest'];
type QualityRulesView = components['schemas']['QualityRulesView'];

/** Request shape accepted by {@link GenerationService.start}; adds the
 * optional idempotency header carrier on top of the backend DTO. */
export interface StartGenerationRequest extends GenerationRequestDto {
  idempotencyKey?: string;
}

const BASE = '/api/v1';

@Injectable({ providedIn: 'root' })
export class GenerationService {
  private readonly http = inject(HttpClient);

  history(projectKey: string): Observable<GenerationRunView[]> {
    return this.http.get<GenerationRunView[]>(
      `${BASE}/projects/${projectKey}/generations`,
    );
  }

  start(
    projectKey: string,
    req: StartGenerationRequest,
  ): Observable<GenerationRunView> {
    const { idempotencyKey, ...body } = req;
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return this.http.post<GenerationRunView>(
      `${BASE}/projects/${projectKey}/generations`,
      body,
      Object.keys(headers).length > 0 ? { headers } : undefined,
    );
  }

  /**
   * Dry run (M22.2.1): the plan a run started now with `req` would build, with every entry's reason. Nothing is
   * rendered or stored; `validate` also compiles the templates the plan needs.
   */
  planGeneration(
    projectKey: string,
    req: StartGenerationRequest,
    query: PlanEntryQuery,
    validate = false,
  ): Observable<GenerationPlanView> {
    const body: StartGenerationRequest = { ...req };
    delete body.idempotencyKey;
    return this.http.post<GenerationPlanView>(
      `${BASE}/projects/${projectKey}/generations/plan`,
      body,
      { params: entryQueryParams(query, validate ? { validate: true } : {}) },
    );
  }

  /** A past run's stored plan (M22.2.1); `entries` is null once retention pruned it. */
  getRunPlan(projectKey: string, runId: number, query: PlanEntryQuery): Observable<GenerationPlanView> {
    return this.http.get<GenerationPlanView>(
      `${BASE}/projects/${projectKey}/generations/${runId}/plan`,
      { params: entryQueryParams(query) },
    );
  }

  /** What would rebuild if the asset changed (M22.2.2), as of now. */
  assetImpact(projectKey: string, assetUuid: string, query: PlanEntryQuery): Observable<AssetImpactView> {
    return this.http.get<AssetImpactView>(
      `${BASE}/projects/${projectKey}/assets/${assetUuid}/impact`,
      { params: entryQueryParams(query) },
    );
  }

  /** One page of a run's quality check findings (M30.1.2), narrowed by `filter`. */
  findings(
    projectKey: string,
    runId: number,
    filter: FindingFilter,
    size = FINDINGS_PAGE_SIZE,
  ): Observable<FindingPageView> {
    return this.http.get<FindingPageView>(
      `${BASE}/projects/${projectKey}/generations/${runId}/findings`,
      { params: findingApiParams(filter, size) },
    );
  }

  /** The project's quality rules with their names (M30.1.2): what the findings' codes mean. */
  qualityRules(projectKey: string): Observable<QualityRuleItem[]> {
    return this.http
      .get<QualityRulesView>(`${BASE}/projects/${projectKey}/quality-rules`)
      .pipe(map((view) => view.rules ?? []));
  }

  status(projectKey: string, runId: number): Observable<GenerationRunView> {
    return this.http.get<GenerationRunView>(
      `${BASE}/projects/${projectKey}/generations/${runId}`,
    );
  }

  cancel(projectKey: string, runId: number): Observable<void> {
    return this.http.post<void>(
      `${BASE}/projects/${projectKey}/generations/${runId}/cancel`,
      null,
    );
  }

  promote(projectKey: string, runId: number): Observable<void> {
    return this.http.post<void>(
      `${BASE}/projects/${projectKey}/generations/${runId}/promote`,
      null,
    );
  }

  listTargets(projectKey: string): Observable<GenerationTargetView[]> {
    return this.http.get<GenerationTargetView[]>(
      `${BASE}/projects/${projectKey}/targets`,
    );
  }

  createTarget(
    projectKey: string,
    req: GenerationTargetRequest,
  ): Observable<GenerationTargetView> {
    return this.http.post<GenerationTargetView>(
      `${BASE}/projects/${projectKey}/targets`,
      req,
    );
  }

  updateTarget(
    projectKey: string,
    id: number,
    req: GenerationTargetRequest,
  ): Observable<GenerationTargetView> {
    return this.http.put<GenerationTargetView>(
      `${BASE}/projects/${projectKey}/targets/${id}`,
      req,
    );
  }

  deleteTarget(projectKey: string, id: number): Observable<void> {
    return this.http.delete<void>(
      `${BASE}/projects/${projectKey}/targets/${id}`,
    );
  }

  /**
   * Opens the live progress stream for a run. Emits decoded
   * {@link GenerationRunEvent} frames and completes when the run finishes or
   * the subscription is torn down.
   */
  connectEvents(
    projectKey: string,
    runId: number,
    token: string,
  ): Observable<GenerationRunEvent> {
    return streamGenerationEvents(
      `${BASE}/projects/${projectKey}/generations/${runId}/events`,
      token,
    ).events;
  }
}
