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
