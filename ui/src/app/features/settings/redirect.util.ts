import type { components } from '../../core/api/generated/schema.d.ts';

type ChannelView = components['schemas']['ChannelView'];

/** Why a typed path or URL isn't one the registry accepts; the key under `publishing.redirects.dialog.errors`. */
export type PathError =
  | 'fromEmpty'
  | 'fromQuery'
  | 'toEmpty'
  | 'urlSpaces'
  | 'urlHost'
  | 'urlInvalid'
  | 'toNeedsPath'
  | 'suffixSpaces'
  | 'doubleSlash'
  | 'scheme'
  | 'backslash'
  | 'escape'
  | 'dotDot'
  | 'blankSegment';

/** A path as the registry stores it, or why it isn't one. */
export type NormalizedPath = { path: string; error?: undefined } | { path?: undefined; error: PathError };

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HTTP_URL = /^https?:\/\/.+/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * The file a channel writes a folder's index page to (spec §18.3 `indexFileName`): the channel's setting, else
 * `index.<extension>` — as `ChannelOutputSettings` on the server.
 */
export function indexFileNameOf(channel: ChannelView | null | undefined): string {
  const settings = (channel?.settings ?? {}) as { indexFileName?: unknown };
  const configured = typeof settings.indexFileName === 'string' ? settings.indexFileName.trim() : '';
  return configured || `index.${channel?.fileExtension?.trim() || 'html'}`;
}

/** The page UID a channel renders as a folder's index (`indexUid`, default `index`). */
export function indexUidOf(channel: ChannelView | null | undefined): string {
  const settings = (channel?.settings ?? {}) as { indexUid?: unknown };
  const configured = typeof settings.indexUid === 'string' ? settings.indexUid.trim() : '';
  return configured || 'index';
}

/**
 * The output path the server stores for a source path the user typed as they know the URL (`/old/page.html`,
 * `/old/page/`), mirroring `RedirectPaths.source`: no leading slash, no `.` or empty segments, percent-decoded, and a
 * directory means its index file. The server stays the authority; this shows the value before saving.
 */
export function normalizeSourcePath(raw: string, indexFileName: string): NormalizedPath {
  const value = raw.trim();
  if (!value) {
    return { error: 'fromEmpty' };
  }
  if (value.includes('?') || value.includes('#')) {
    return { error: 'fromQuery' };
  }
  return normalizePath(value, indexFileName);
}

/**
 * The target the server stores for a path or URL the user typed, mirroring `RedirectPaths.target`: an absolute
 * `http(s)` URL as given, or an output path (a directory means its index file) with its query and fragment kept.
 */
export function normalizeTargetPath(raw: string, indexFileName: string): NormalizedPath {
  const value = raw.trim();
  if (!value) {
    return { error: 'toEmpty' };
  }
  if (HTTP_URL.test(value)) {
    if (/\s/.test(value) || CONTROL.test(value)) {
      return { error: 'urlSpaces' };
    }
    try {
      const url = new URL(value);
      return url.hostname ? { path: value } : { error: 'urlHost' };
    } catch {
      return { error: 'urlInvalid' };
    }
  }
  const suffixAt = firstIndexOf(value, '?', '#');
  const pathPart = suffixAt < 0 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? '' : value.slice(suffixAt);
  if (!pathPart) {
    return { error: 'toNeedsPath' };
  }
  if (/\s/.test(suffix) || CONTROL.test(suffix)) {
    return { error: 'suffixSpaces' };
  }
  const normalized = normalizePath(pathPart, indexFileName);
  return normalized.error !== undefined ? normalized : { path: normalized.path + suffix };
}

function normalizePath(value: string, indexFileName: string): NormalizedPath {
  if (value.startsWith('//')) {
    return { error: 'doubleSlash' };
  }
  if (SCHEME.test(value)) {
    return { error: 'scheme' };
  }
  if (value.includes('\\') || CONTROL.test(value)) {
    return { error: 'backslash' };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return { error: 'escape' };
  }
  if (decoded.includes('\\') || CONTROL.test(decoded)) {
    return { error: 'backslash' };
  }
  const directory = decoded === '' || decoded.endsWith('/');
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return { error: 'dotDot' };
    }
    if (segment.trim() === '') {
      return { error: 'blankSegment' };
    }
    segments.push(segment);
  }
  if (directory || segments.length === 0) {
    segments.push(indexFileName);
  }
  return { path: segments.join('/') };
}

function firstIndexOf(value: string, a: string, b: string): number {
  const i = value.indexOf(a);
  const j = value.indexOf(b);
  return i < 0 ? j : j < 0 ? i : Math.min(i, j);
}
