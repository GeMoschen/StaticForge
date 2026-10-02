import { DestroyRef, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { openedAsset } from '../../core/assets/opened-asset';
import { RecentsService } from '../../core/assets/recents.service';

/**
 * Records every asset the person opens as a recent (M35.15), whichever store it is in: a navigation to a page, record,
 * record set, or a store's `?asset=` / `?folder=` item resolves the asset (its type, name and place) and puts it first
 * in the project's recents. One listener for every screen, so screens do not have to report what they open. Call it
 * from the frame's constructor.
 */
export function useAssetTracking(): void {
  const router = inject(Router);
  const recents = inject(RecentsService);
  let last = '';
  const subscription = router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe((event) => {
    const opened = openedAsset(event.urlAfterRedirects);
    const id = opened ? `${opened.projectKey}/${opened.uuid}` : '';
    // A query change on the same asset (a tab, a filter) is not another visit.
    if (opened && id !== last) {
      recents.visitByUuid(opened.projectKey, opened.uuid);
    }
    last = id;
  });
  inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
}
