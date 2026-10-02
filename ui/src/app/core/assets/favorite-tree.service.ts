import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiClient } from '../api/api.client';
import type { FavoriteEntry } from '../preferences/preferences.types';
import type { SfTreeNode } from '../../shared/components/tree/tree-model';
import { assetRoute, type AssetRouteTarget } from '../../shared/asset-route.util';
import { assetIcon, assetLocation } from './asset-ref';

/** The id of the pinned *Favorites* node at the top of a tree (M35.15). */
export const FAVORITES_NODE = 'favorites-node';

/** Ids below the Favorites node are `fav:<favorite uuid>`, and `fav:<favorite uuid>/<uuid>/…` inside a favorite folder. */
export const FAVORITE_NODE_PREFIX = 'fav:';

/** What a node of the Favorites branch stands for: an asset or a folder of any store. */
export interface FavoriteNodeData {
  readonly type: string;
  readonly uuid: string;
  readonly name: string;
  /** Where it lives; for a folder its own path, which is how its contents are found. */
  readonly folderPath?: string;
}

/** Whether a tree node id belongs to the Favorites branch (the pinned node itself or anything below it). */
export function isFavoriteNode(id: string): boolean {
  return id === FAVORITES_NODE || id.startsWith(FAVORITE_NODE_PREFIX);
}

/** The parent of a folder path (`/pages_root/news/archive/` → `/pages_root/news/`). */
function parentPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length <= 1 ? '/' : `/${segments.slice(0, -1).join('/')}/`;
}

/** The most items read for one favorite folder (its direct contents). */
const FOLDER_PAGE_SIZE = 500;

/**
 * The *Favorites* branch of a tree (M35.15, gate decision 58): a pinned node at the top of every tree that lists the
 * project's favorites — pages, records, media, templates, folders, from any store, whichever tree this is. A favorite
 * folder is a folder node that loads its contents when it is opened, so a favorite is not tied to the store of the tree
 * it is shown in. Opening a node goes to the asset in its own area (`routeOf`).
 *
 * Contents are read through the asset listing, which answers with everything under a path: the direct children are
 * those whose own folder is the path (a folder counts by its own path, an asset by the folder it lives in).
 */
@Injectable({ providedIn: 'root' })
export class FavoriteTreeService {
  private readonly api = inject(ApiClient);

  /** The pinned node; give it to the tree only while there are favorites. */
  rootNode<T>(label: string): SfTreeNode<T> {
    return { id: FAVORITES_NODE, label, icon: 'star', hasChildren: true, pinned: true, draggable: false, droppable: false };
  }

  /** The favorites as the children of the pinned node. */
  nodes<T>(entries: readonly FavoriteEntry[]): SfTreeNode<T>[] {
    return entries.map((entry) =>
      this.toNode<T>(`${FAVORITE_NODE_PREFIX}${entry.uuid}`, {
        type: entry.kind,
        uuid: entry.uuid,
        name: entry.title ?? entry.uuid,
        folderPath: entry.folderPath,
      }, assetLocation(entry.folderPath, entry.kind)),
    );
  }

  /** The contents of a favorite folder node (nodes below it use the same call). */
  children<T>(projectKey: string, parent: SfTreeNode<T>): Observable<SfTreeNode<T>[]> {
    const data = parent.data as unknown as FavoriteNodeData | undefined;
    const path = data?.folderPath;
    if (!data || !path || data.type !== 'FOLDER') {
      return new Observable((subscriber) => {
        subscriber.next([]);
        subscriber.complete();
      });
    }
    return this.api.listAssets(projectKey, { folder: path, size: FOLDER_PAGE_SIZE }).pipe(
      map((result) =>
        (result.content ?? [])
          .filter((asset) => !!asset.uuid && asset.uuid !== data.uuid && this.isDirectChild(asset, path))
          .map((asset) =>
            this.toNode<T>(`${parent.id}/${asset.uuid}`, {
              type: asset.type ?? 'PAGE',
              uuid: asset.uuid!,
              name: asset.displayName ?? asset.uid ?? asset.uuid!,
              folderPath: asset.folderPath,
            }, null),
          ),
      ),
    );
  }

  /** Where a node of the branch opens. */
  routeOf(projectKey: string, node: SfTreeNode): AssetRouteTarget | null {
    const data = node.data as unknown as FavoriteNodeData | undefined;
    return data ? assetRoute(projectKey, { type: data.type, uuid: data.uuid, folderPath: data.folderPath }) : null;
  }

  private isDirectChild(asset: { type?: string; folderPath?: string }, path: string): boolean {
    const own = asset.folderPath ?? '';
    return asset.type === 'FOLDER' ? parentPath(own) === path : own === path;
  }

  private toNode<T>(id: string, data: FavoriteNodeData, secondary: string | null): SfTreeNode<T> {
    const folder = data.type === 'FOLDER';
    return {
      id,
      label: data.name,
      icon: assetIcon(data.type),
      secondary,
      hasChildren: folder,
      draggable: false,
      droppable: false,
      data: data as unknown as T,
    };
  }
}
