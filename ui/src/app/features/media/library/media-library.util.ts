import type { components } from '../../../core/api/generated/schema.d.ts';

type FolderView = components['schemas']['FolderView'];

/** How many media items one page of the grid loads. */
export const PAGE_SIZE = 40;

export function findFolder(nodes: FolderView[], uuid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const found = findFolder(node.children ?? [], uuid);
    if (found) {
      return found;
    }
  }
  return null;
}

/** The folder that holds the folder `uuid` (`null` for a top-level entry of `nodes`, or an unknown uuid). */
export function findParentFolder(nodes: FolderView[], uuid: string, parent: FolderView | null = null): FolderView | null {
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

/** How many sub-folders and media items a folder holds in all its levels — what deleting it takes along. */
export function folderContentCount(
  folder: FolderView,
  mediaByFolder: ReadonlyMap<string, readonly unknown[]>,
): { folders: number; media: number } {
  let folders = 0;
  let media = mediaByFolder.get(folder.path ?? '')?.length ?? 0;
  for (const child of folder.children ?? []) {
    const inner = folderContentCount(child, mediaByFolder);
    folders += 1 + inner.folders;
    media += inner.media;
  }
  return { folders, media };
}

export function findFolderByPath(nodes: FolderView[], path: string): FolderView | null {
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

/** Material Symbols icon for a mime type that has no thumbnail preview (anything non-image). */
export function mediaIconFor(mimeType?: string): string {
  const mime = mimeType ?? '';
  if (mime.startsWith('video/')) {
    return 'movie';
  }
  if (mime.startsWith('audio/')) {
    return 'audiotrack';
  }
  if (mime.startsWith('font/')) {
    return 'font_download';
  }
  if (mime === 'application/pdf') {
    return 'picture_as_pdf';
  }
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || mime === 'application/gzip') {
    return 'folder_zip';
  }
  if (mime === 'text/css' || mime === 'application/javascript' || mime === 'application/json' || mime === 'text/html') {
    return 'code';
  }
  if (mime.startsWith('text/')) {
    return 'description';
  }
  return 'draft';
}
