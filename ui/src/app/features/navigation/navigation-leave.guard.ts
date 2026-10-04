import { CanDeactivateFn } from '@angular/router';
import { mediaLeaveGuard } from '../media/media-leave.guard';

/**
 * Leaving the Navigation area with unsaved edits in the open menu item (M35.22, M35.13): leaving the screen, or the open
 * entry (`?asset=`) changing — another item, a folder, the Favorites list, browser back or forward — asks Save / Discard /
 * Cancel first (see `ActiveEditorService.canLeave`). Anything else in the URL passes. It is the media library's rule —
 * path and `asset` — and needs `runGuardsAndResolvers: 'always'` on the route, as only query parameters change.
 */
export const navigationLeaveGuard: CanDeactivateFn<unknown> = mediaLeaveGuard;
