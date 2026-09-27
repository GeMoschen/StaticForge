import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_TOAST } from '../../core/api/error.interceptor';
import type { DraftCheckView } from './page-issues.util';

/** What to check: a page's draft in one channel and language, at a revision while time travelling. */
export interface DraftCheckRequest {
  projectKey: string;
  pageUuid: string;
  channel: string;
  locale: string | null;
  revision: number | null;
}

/**
 * `M30.3.1`'s draft checks: the page's draft rendered as a build of the drafts would write it, checked by the project's
 * quality rules. The Issues panel degrades to "Checks unavailable" on any error, so the call skips the global error
 * toast — a failing check must never get in the way of editing.
 */
@Injectable({ providedIn: 'root' })
export class DraftChecksService {
  private readonly http = inject(HttpClient);

  check(request: DraftCheckRequest): Observable<DraftCheckView> {
    const params: Record<string, string | number> = { channel: request.channel };
    if (request.locale) {
      params['locale'] = request.locale;
    }
    if (request.revision !== null) {
      params['revision'] = request.revision;
    }
    return this.http.post<DraftCheckView>(
      `/api/v1/projects/${request.projectKey}/preview/pages/${request.pageUuid}/checks`,
      null,
      { withCredentials: true, params, context: new HttpContext().set(SKIP_ERROR_TOAST, true) },
    );
  }
}
