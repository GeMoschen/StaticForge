import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AutosaveService } from '../../shared/services/autosave.base';
import type { ConflictInfo, ResolveMode, SaveState } from './types';

type PageView = components['schemas']['PageView'];

/**
 * Full page payload persisted on flush. `templateRef` is required by the
 * backend's PUT /pages/{uuid} validator (a full-replace merge against no
 * base, unlike the PATCH /content endpoint) — omitting it is rejected with
 * a 422 "Page payload requires templateRef."
 */
export interface PagePayload {
  templateRef?: string;
  content?: unknown;
  bodies?: unknown;
  nav?: unknown;
  output?: unknown;
  meta?: unknown;
}

/**
 * Debounced autosave for the page editor (see {@link AutosaveService}): pages persist through
 * `PUT /pages/{uuid}` and re-read through the page detail. Provided at the page-editor component
 * level (NOT root).
 */
@Injectable()
export class PageAutosaveService extends AutosaveService<PagePayload, PageView> {
  private readonly api = inject(ApiClient);

  protected persist(payload: PagePayload, revision: number | undefined): Observable<PageView> {
    return this.api.updatePage(this.projectKey, this.uuid, payload, revision);
  }

  protected reload(): Observable<PageView> {
    return this.api.pageDetail(this.projectKey, this.uuid);
  }
}

export type { ConflictInfo, ResolveMode, SaveState };
