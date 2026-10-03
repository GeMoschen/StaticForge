import { inject } from '@angular/core';
import { CanDeactivateFn, Router } from '@angular/router';
import { ActiveEditorService } from '../../core/editor/active-editor.service';

/** The path of a URL, without its query. */
function pathOf(router: Router, url: string): string {
  const tree = router.parseUrl(url);
  return tree.root.children['primary']?.segments.map((segment) => segment.path).join('/') ?? '';
}

/**
 * Leaves the media library with unsaved edits in its detail drawer (M35.19, decisions 48 and 97): leaving the screen, or
 * the open file (`?asset=`) changing — another file, closing the drawer, another folder, browser back or forward — asks
 * Save / Discard / Cancel first (see {@link ActiveEditorService.canLeave}). Anything else in the URL (search, sort, the
 * drawer's tab, the folder of a file that stays open) passes. Needs `runGuardsAndResolvers: 'always'` on the route, as
 * only query parameters change.
 */
export const mediaLeaveGuard: CanDeactivateFn<unknown> = (_component, _route, currentState, nextState) => {
  const router = inject(Router);
  const from = router.parseUrl(currentState.url);
  const to = router.parseUrl(nextState.url);
  if (pathOf(router, currentState.url) === pathOf(router, nextState.url) && from.queryParams['asset'] === to.queryParams['asset']) {
    return true;
  }
  return inject(ActiveEditorService).canLeave();
};
