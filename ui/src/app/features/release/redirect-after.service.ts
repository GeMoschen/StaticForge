import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { problemOf } from '../../core/api/problem.util';
import { ToastService } from '../../core/ui/toast.service';
import { RedirectsService } from '../settings/redirects.service';
import type { RedirectSource, RedirectTargetPage } from './redirect-option.util';

/**
 * "Redirect old URL to…" after an unpublish or delete succeeded (M30.6.3, epic decision 17): one
 * `POST /redirects/for-asset` per page, to page 1 of the chosen page. The unpublish or delete is never rolled back —
 * a failed redirect call is a warning that links to the Redirects tab, where it can be added by hand.
 */
@Injectable({ providedIn: 'root' })
export class RedirectAfterService {
  private readonly api = inject(RedirectsService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  redirect(projectKey: string, sources: readonly RedirectSource[], target: RedirectTargetPage): void {
    if (sources.length === 0) {
      return;
    }
    forkJoin(
      sources.map((source) =>
        this.api.forAsset(projectKey, { assetUuid: source.uuid, toAssetUuid: target.uuid }).pipe(
          map((rows) => ({ source, rows: rows ?? [], problem: null as string | null })),
          catchError((err: unknown) =>
            of({ source, rows: [], problem: problemOf(err, 'The redirect could not be saved.').detail }),
          ),
        ),
      ),
    ).subscribe((results) => {
      const openRedirects = {
        label: 'Open Redirects',
        run: () => void this.router.navigate(['/p', projectKey, 'publishing', 'redirects']),
      };
      const failed = results.filter((result) => result.problem !== null);
      if (failed.length > 0) {
        const detail = failed.map((result) => `“${result.source.name}”: ${result.problem}`).join(' ');
        this.toasts.show(
          `The old URLs were not redirected to “${target.name}”. ${detail} Add the redirect in the Redirects tab.`,
          'warning',
          openRedirects,
        );
      }
      const written = results.reduce((count, result) => count + result.rows.length, 0);
      if (written > 0) {
        this.toasts.show(
          `${written === 1 ? '1 old URL redirects' : `${written} old URLs redirect`} to “${target.name}” once a build ` +
            'no longer contains the page. Until then the redirect shows as Shadowed.',
          'info',
          openRedirects,
        );
      }
    });
  }
}
