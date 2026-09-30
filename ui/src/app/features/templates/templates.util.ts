import type { components } from '../../core/api/generated/schema.d.ts';
import { DATASETS_ROOT_UID, SECTION_TEMPLATES_ROOT_UID, type TemplateAssetKind } from './types';
import type { TemplateDetail } from './templates.service';

type FolderView = components['schemas']['FolderView'];

interface ChannelTemplateValue {
  source?: string;
  compiledHash?: string;
}

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

/** Same shape as `findFolder`, but matches on the well-known `uid` string instead of `uuid` —
 * needed since the fixed kind-roots are no longer necessarily top-level array items (they now
 * nest one level inside the fixed "All Templates" wrapper root). */
export function findFolderByUid(nodes: FolderView[], uid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uid === uid) {
      return node;
    }
    const found = findFolderByUid(node.children ?? [], uid);
    if (found) {
      return found;
    }
  }
  return null;
}

/** The inherited kind of one of the two fixed roots, by its well-known `uid`. */
export function rootKindOf(node: FolderView): TemplateAssetKind {
  if (node.uid === DATASETS_ROOT_UID) {
    return 'DATASET';
  }
  return node.uid === SECTION_TEMPLATES_ROOT_UID ? 'SECTION_TEMPLATE' : 'PAGE_TEMPLATE';
}

/** Whether two string maps hold the same entries. */
export function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && a[key] === b[key]);
}

/** Every channel's source of a template detail, keyed by channel. */
export function channelSourcesOf(detail: TemplateDetail | null): Record<string, string> {
  const templates = (detail?.channelTemplates as Record<string, ChannelTemplateValue> | null) ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(templates)) {
    out[key] = value?.source ?? '';
  }
  return out;
}

/** A per-channel path map of the detail (`outputPath`, `paginationPath`) as the update request sends it. */
export function pathMapOf(value: unknown): Record<string, string> {
  const raw = value as Record<string, string> | null | undefined;
  if (!raw) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === 'string') {
      out[key] = entry;
    }
  }
  return out;
}
