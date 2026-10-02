import type { components } from '../core/api/generated/schema.d.ts';

type FolderView = components['schemas']['FolderView'];

/** The folder whose canonical path is `path`, anywhere in the tree. */
export function findFolderByPath(nodes: readonly FolderView[], path: string): FolderView | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const found = findFolderByPath(node.children ?? [], path);
    if (found) {
      return found;
    }
  }
  return null;
}

/** The folder that contains the folder `uuid` (`null` for a top-level node or an unknown uuid). */
export function findParentFolder(
  nodes: readonly FolderView[],
  uuid: string,
  parent: FolderView | null = null,
): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return parent;
    }
    const found = findParentFolder(node.children ?? [], uuid, node);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * The body of the move that puts something back into `parent`: the project root (`{}`) for no parent and for the fixed
 * "All Pages" wrapper, which stands for the root.
 */
export function moveBackBody(parent: FolderView | null | undefined, rootUuid?: string): { folderUuid?: string } {
  return parent?.uuid && parent.uuid !== rootUuid ? { folderUuid: parent.uuid } : {};
}

/** The folder (or leaf) `uuid` anywhere in the tree. */
export function findFolderById(nodes: readonly FolderView[], uuid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const found = findFolderById(node.children ?? [], uuid);
    if (found) {
      return found;
    }
  }
  return null;
}
