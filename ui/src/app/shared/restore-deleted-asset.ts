import { Observable, map, switchMap, throwError } from 'rxjs';
import { ApiClient } from '../core/api/api.client';
import type { components } from '../core/api/generated/schema.d.ts';

/**
 * The inverse of deleting an asset (M35.13): restores it from its last live revision, read from its history at the
 * moment of the Undo — a revision remembered from before the delete could be older than the last edit and would take
 * that edit back. Restoring a record set brings back the records the same delete took with it.
 */
export function restoreDeletedAsset(
  api: ApiClient,
  projectKey: string,
  uuid: string,
): Observable<components['schemas']['AssetDetailView']> {
  return api.assetHistory(projectKey, uuid).pipe(
    map((history) => history.find((entry) => !entry.deleted)?.revision),
    switchMap((fromRevision) =>
      fromRevision == null
        ? throwError(() => new Error('The asset has no live revision to restore.'))
        : api.restoreAsset(projectKey, uuid, { fromRevision }),
    ),
  );
}
