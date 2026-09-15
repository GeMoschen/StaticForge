import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  GenerationRunEvent,
  streamGenerationEvents,
} from './generation-sse';

type GenerationRunView = components['schemas']['GenerationRunView'];
type GenerationRequestDto = components['schemas']['GenerationRequestDto'];
type GenerationTargetView = components['schemas']['GenerationTargetView'];
type GenerationTargetRequest = components['schemas']['GenerationTargetRequest'];

/** Request shape accepted by {@link GenerationService.start}; adds the
 * optional idempotency header carrier on top of the backend DTO. */
export interface StartGenerationRequest extends GenerationRequestDto {
  idempotencyKey?: string;
}

const BASE = '/api/v1';

@Injectable({ providedIn: 'root' })
export class GenerationService {
  constructor(private readonly http: HttpClient) {}

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
