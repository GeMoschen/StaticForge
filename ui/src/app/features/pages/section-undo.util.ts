import { Observable, switchMap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { SectionInstance } from './types';

type PageView = components['schemas']['PageView'];

/**
 * The inverse of deleting a section (M35.13): puts it back identically — same instance id, same content — at the index
 * it had. The etag is the page's *current* revision, read now, so edits made since the delete don't make the undo fail.
 */
export function restoreSection(
  api: ApiClient,
  projectKey: string,
  pageUuid: string,
  bodyName: string,
  section: SectionInstance,
  position: number,
): Observable<PageView> {
  return api.pageDetail(projectKey, pageUuid).pipe(
    switchMap((page) =>
      api.addSection(
        projectKey,
        pageUuid,
        bodyName,
        {
          templateUuid: section.templateRef,
          position,
          instanceId: section.instanceId,
          content: section.content as components['schemas']['JsonNode'],
        },
        page.revision ?? undefined,
      ),
    ),
  );
}
