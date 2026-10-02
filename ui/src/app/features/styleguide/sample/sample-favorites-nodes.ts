import type { SfTreeNode } from '../../../shared/components/tree/tree-model';
import { MEDIA_FILES, mediaFolderChildren } from './media/sample-media-data';
import { childrenOf } from './sample-data';
import { contentChildren, templateChildren } from './sample-content-data';
import {
  FAVORITES_NODE,
  FAVORITE_ICONS,
  FAVORITE_NODE_PREFIX,
  SampleFavorite,
  SampleFavoriteKind,
  favoriteKey,
} from './sample-favorites';
import type { SampleArea } from './sample-state';

/** The pinned *Favorites* node at the top of a tree (M35.15); it exists only while there are favorites. */
export function favoritesNode<T>(label: string): SfTreeNode<T> {
  return { id: FAVORITES_NODE, label, icon: 'star', hasChildren: true, pinned: true, draggable: false, droppable: false };
}

/** What a store holds directly inside a folder (`null` = its root), as favorites would describe it. */
function storeChildren(area: SampleArea, folderId: string | null): SampleFavorite[] {
  const make = (id: string, name: string, kind: SampleFavoriteKind): SampleFavorite => ({
    key: favoriteKey(area, id),
    kind,
    id,
    name,
    path: '',
    area,
  });
  switch (area) {
    case 'pages':
      return childrenOf(folderId).map((e) => make(e.id, e.name, e.kind === 'folder' ? 'folder' : 'page'));
    case 'content':
      return contentChildren(folderId).map((e) => make(e.id, e.name, e.kind === 'folder' ? 'folder' : 'recordset'));
    case 'templates':
      return templateChildren(folderId).map((e) => make(e.id, e.name, e.kind === 'folder' ? 'folder' : 'template'));
    case 'media':
      return [
        ...mediaFolderChildren(folderId).map((f) => make(f.id, f.name, 'folder')),
        ...MEDIA_FILES.filter((f) => f.folderId === folderId).map((f) => make(f.id, f.name, 'media')),
      ];
    default:
      return [];
  }
}

function toNode<T>(id: string, item: SampleFavorite, secondary: string | null): SfTreeNode<T> {
  return {
    id,
    label: item.name,
    icon: FAVORITE_ICONS[item.kind],
    secondary,
    hasChildren: item.kind === 'folder' && storeChildren(item.area, item.id).length > 0,
    draggable: false,
    droppable: false,
    // The item itself: opening the node opens it in its own area.
    data: item as unknown as T,
  };
}

/**
 * The children of the *Favorites* node: every favorite, from every store, whichever tree this is. A favorite folder is a
 * folder node (loaded lazily when it is opened) — a favorite is not tied to the store of the tree it is shown in.
 */
export function favoriteNodes<T>(favorites: readonly SampleFavorite[]): SfTreeNode<T>[] {
  return favorites.map((favorite) => toNode<T>(`${FAVORITE_NODE_PREFIX}${favorite.key}`, favorite, favorite.path || null));
}

/** The children of a favorite folder node (`fav:<key>` or `fav:<key>/<id>`): what its folder holds in its store. */
export function favoriteChildren<T>(nodeId: string, favorites: readonly SampleFavorite[]): SfTreeNode<T>[] {
  const rest = nodeId.slice(FAVORITE_NODE_PREFIX.length);
  const slash = rest.indexOf('/');
  const key = slash < 0 ? rest : rest.slice(0, slash);
  const favorite = favorites.find((f) => f.key === key);
  if (!favorite) {
    return [];
  }
  const folderId = slash < 0 ? favorite.id : rest.slice(slash + 1);
  return storeChildren(favorite.area, folderId).map((item) => toNode<T>(`${FAVORITE_NODE_PREFIX}${key}/${item.id}`, item, null));
}

/** Whether a node belongs to the *Favorites* node (the node itself or anything below it). */
export function isFavoriteNode(id: string): boolean {
  return id === FAVORITES_NODE || id.startsWith(FAVORITE_NODE_PREFIX);
}
