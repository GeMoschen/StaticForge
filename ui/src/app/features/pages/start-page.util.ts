import { HttpErrorResponse } from '@angular/common/http';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/** The UID of the fixed, protected pages root — the site root for output paths (M31). */
export const PAGES_ROOT_UID = 'pages_root';

/** Stale `If-Match` revision. */
const STALE_CODE = 'SF-API-0409';
/** Another page of the folder is also written as its index file (M31, epic decision 3). */
export const INDEX_CLAIM_CODE = 'SF-DOM-0111';

/** The members `SF-DOM-0111` adds to its problem document. */
interface IndexClaimProblem {
  conflictingPageUuid?: unknown;
  conflictingPageUid?: unknown;
}

/** Why setting a folder's start page failed, as the Pages screen presents it. */
export type StartPageFailure =
  | { kind: 'stale'; message: string }
  | { kind: 'index-claim'; message: string; pageUuid: string | null }
  | { kind: 'other'; message: string };

/** Whether `folder` is the site root (`pages_root`), which is protected but may name a start page. */
export function isPagesRoot(folder: FolderView | null | undefined): boolean {
  return !!folder && folder.protectedFolder === true && folder.uid === PAGES_ROOT_UID;
}

/** The folder's name in start-page labels: the pages root reads as the screen's own "All pages". */
export function startPageFolderLabel(folder: FolderView): string {
  return isPagesRoot(folder) ? 'All pages' : (folder.displayName ?? folder.uid ?? 'this folder');
}

/**
 * Reads a failed `PATCH /folders/{uuid}`. `SF-DOM-0111` names the conflicting page (`conflictingPageUuid`,
 * `conflictingPageUid`): the message names it — by its display name when `pages` knows it — and says to rename its UID.
 */
export function startPageFailure(err: unknown, pages: readonly AssetSummaryView[] = []): StartPageFailure {
  const problem = problemOf(err, 'Could not set the start page — try again in a moment.');
  if (problem.status === 409 && problem.code === INDEX_CLAIM_CODE) {
    const body: IndexClaimProblem =
      err instanceof HttpErrorResponse && err.error && typeof err.error === 'object' ? err.error : {};
    const pageUuid = typeof body.conflictingPageUuid === 'string' ? body.conflictingPageUuid : null;
    const pageUid = typeof body.conflictingPageUid === 'string' ? body.conflictingPageUid : null;
    const page = pageUuid ? pages.find((candidate) => candidate.uuid === pageUuid) : undefined;
    const name = page?.displayName && page.displayName !== pageUid ? `“${page.displayName}” (UID “${pageUid}”)` : `“${pageUid ?? 'unknown'}”`;
    return {
      kind: 'index-claim',
      pageUuid,
      message:
        `Page ${name} in this folder is also written as the folder's index file. ` +
        'Change its UID first (right-click the page → Rename), then choose the start page again.',
    };
  }
  if (problem.status === 409 && problem.code === STALE_CODE) {
    return {
      kind: 'stale',
      message: 'This folder was changed in the meantime. Reload it and choose the start page again.',
    };
  }
  return { kind: 'other', message: problem.detail };
}
