import type { PreviewView } from '../../core/api/api.client';
import { statusLabel } from '../release/release-status.util';

/** Where the preview's Draft/Published choice is remembered, per browser — like the editor's split ratio. */
export const PREVIEW_VIEW_STORAGE_KEY = 'sf-preview-view';

/** The response header naming the view a preview rendered (M27.2.3). */
export const VIEW_HEADER = 'X-SF-View';

/** The draft view's release status of the page in the rendered language (M27.2.3). */
export const RELEASE_STATUS_HEADER = 'X-SF-Release-Status';

/** The problem code of a published preview of a page that isn't released in the language. */
export const NOT_PUBLISHED_CODE = 'SF-DOM-0155';

/** The remembered view; Draft when nothing (or something unreadable) is stored. */
export function readStoredView(): PreviewView {
  try {
    return localStorage.getItem(PREVIEW_VIEW_STORAGE_KEY) === 'published' ? 'published' : 'draft';
  } catch {
    return 'draft';
  }
}

export function storeView(view: PreviewView): void {
  try {
    localStorage.setItem(PREVIEW_VIEW_STORAGE_KEY, view);
  } catch {
    /* a private window simply forgets the choice */
  }
}

/** The label of a view in the toolbar and on share links. */
export function viewLabel(view: PreviewView): string {
  return view === 'published' ? 'Published' : 'Draft';
}

/** "Changed" for `CHANGED`; an unknown status shows as it is, a missing one as `null`. */
export function releaseStatusLabel(status: string | null | undefined): string | null {
  return status ? statusLabel(status) : null;
}
