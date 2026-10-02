import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { Crumb } from '../../core/frame/breadcrumb.util';
import type { components } from '../../core/api/generated/schema.d.ts';

type FolderView = components['schemas']['FolderView'];

/**
 * The folders above a page as breadcrumb segments (M35.18): the page's folder path is matched against the Pages folder
 * tree, so each segment carries the folder's name and opens the folder (`/p/<key>/pages?folder=<uuid>`). The store's
 * own root is not a segment (the area crumb stands for it). A tree that cannot be read leaves the trail empty.
 */
@Injectable({ providedIn: 'root' })
export class FolderTrailService {
  private readonly api = inject(ApiClient);

  trailFor(projectKey: string, folderPath: string | undefined): Observable<Crumb[]> {
    if (!folderPath) {
      return of([]);
    }
    return this.api.listFolders(projectKey, 'PAGES', 10).pipe(
      map((roots) => trailOf(projectKey, roots, folderPath)),
      catchError(() => of([])),
    );
  }
}

/** The chain of folders whose path is a prefix of `folderPath`, outermost first, without the store root. Pure. */
export function trailOf(projectKey: string, roots: readonly FolderView[], folderPath: string): Crumb[] {
  const crumbs: Crumb[] = [];
  const walk = (folders: readonly FolderView[], depth: number): void => {
    for (const folder of folders) {
      const path = folder.path ?? '';
      if (path !== '' && folderPath.startsWith(path)) {
        if (depth > 0 && folder.uuid) {
          crumbs.push({
            id: `folder:${folder.uuid}`,
            label: folder.displayName ?? folder.uid ?? path,
            link: ['/p', projectKey, 'pages'],
            queryParams: { folder: folder.uuid },
          });
        }
        walk(folder.children ?? [], depth + 1);
        return;
      }
    }
  };
  walk(roots, 0);
  return crumbs;
}
