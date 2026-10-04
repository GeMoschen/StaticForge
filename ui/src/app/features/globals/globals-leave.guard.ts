import { CanDeactivateFn } from '@angular/router';
import { mediaLeaveGuard } from '../media/media-leave.guard';

/**
 * Leaving the Globals area with unsaved edits in the open global set (M35.22, M35.13): leaving the screen, or the open
 * item (`?asset=`) changing — another set, a folder, the Favorites list, browser back or forward — asks Save / Discard /
 * Cancel first (see `ActiveEditorService.canLeave`). Anything else in the URL (the tab) passes. It is the media
 * library's rule — path and `asset` — and needs `runGuardsAndResolvers: 'always'` on the route, as only query parameters change.
 */
export const globalsLeaveGuard: CanDeactivateFn<unknown> = mediaLeaveGuard;
