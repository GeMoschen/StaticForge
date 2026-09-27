import type { components } from '../../core/api/generated/schema.d.ts';
import type { RedirectKind, RedirectState } from './redirects.service';

type ChannelView = components['schemas']['ChannelView'];

/** A path as the registry stores it, or why it isn't one. */
export type NormalizedPath = { path: string; error?: undefined } | { path?: undefined; error: string };

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
    return { error: 'Enter the old path.' };
  }
  if (value.includes('?') || value.includes('#')) {
    return { error: 'The old path has no query (?…) or fragment (#…).' };
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
    return { error: 'Enter the new path or URL.' };
  }
  if (HTTP_URL.test(value)) {
    if (/\s/.test(value) || CONTROL.test(value)) {
      return { error: 'A URL can’t contain spaces.' };
    }
    try {
      const url = new URL(value);
      return url.hostname ? { path: value } : { error: 'Not an absolute http(s) URL with a host.' };
    } catch {
      return { error: 'Not a valid URL.' };
    }
  }
  const suffixAt = firstIndexOf(value, '?', '#');
  const pathPart = suffixAt < 0 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? '' : value.slice(suffixAt);
  if (!pathPart) {
    return { error: 'The target needs a path before its query or fragment.' };
  }
  if (/\s/.test(suffix) || CONTROL.test(suffix)) {
    return { error: 'The query or fragment contains spaces.' };
  }
  const normalized = normalizePath(pathPart, indexFileName);
  return normalized.error !== undefined ? normalized : { path: normalized.path + suffix };
}

function normalizePath(value: string, indexFileName: string): NormalizedPath {
  if (value.startsWith('//')) {
    return { error: 'A path can’t start with “//” (that names another host).' };
  }
  if (SCHEME.test(value)) {
    return { error: 'Only paths of the site and absolute http(s) URLs are allowed.' };
  }
  if (value.includes('\\') || CONTROL.test(value)) {
    return { error: 'A path can’t contain backslashes or control characters.' };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return { error: 'The path has an invalid %-escape.' };
  }
  if (decoded.includes('\\') || CONTROL.test(decoded)) {
    return { error: 'A path can’t contain backslashes or control characters.' };
  }
  const directory = decoded === '' || decoded.endsWith('/');
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return { error: 'A path can’t leave the site with “..”.' };
    }
    if (segment.trim() === '') {
      return { error: 'A path segment can’t be blank.' };
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

export const REDIRECT_KINDS: { value: RedirectKind; label: string }[] = [
  { value: 'AUTO', label: 'Automatic' },
  { value: 'MANUAL', label: 'Manual' },
];

export const REDIRECT_STATES: { value: RedirectState; label: string; explanation: string }[] = [
  {
    value: 'ACTIVE',
    label: 'Active',
    explanation: 'Written to every build: requests for the old path are sent to the target.',
  },
  {
    value: 'SHADOWED',
    label: 'Shadowed',
    explanation:
      'A page or media file is published at the old path, so the redirect is not written. It is kept and takes effect once nothing lives there any more.',
  },
  {
    value: 'DANGLING',
    label: 'Dangling',
    explanation:
      'The target page has no output in this channel and language (unpublished, deleted or not in this channel). The redirect is kept, but not written until the page is published again.',
  },
  {
    value: 'LOOP',
    label: 'Loop',
    explanation:
      'It leads back to its own path, directly or through other redirects, so builds leave it out. Point it somewhere else or delete it.',
  },
];

export function kindLabel(kind: string | null | undefined): string {
  return REDIRECT_KINDS.find((k) => k.value === kind)?.label ?? kind ?? '—';
}

export function stateLabel(state: string | null | undefined): string {
  return state ? (REDIRECT_STATES.find((s) => s.value === state)?.label ?? state) : 'Not built';
}

/** The state's explanation tooltip; a row has no state while the default target has no build. */
export function stateExplanation(state: string | null | undefined): string {
  return state
    ? (REDIRECT_STATES.find((s) => s.value === state)?.explanation ?? '')
    : 'Nothing is published on the default target yet: the state is known after the first build.';
}
