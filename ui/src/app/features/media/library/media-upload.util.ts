import { HttpErrorResponse } from '@angular/common/http';

/** Why a file did not go into the library (decision 98). */
export type UploadError = 'type' | 'size' | 'duplicate' | 'network' | 'server';

/** `name.jpg` → `name-2.jpg`: the next name that is not in `taken` (lower-cased names). */
export function nextFreeName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? '' : name.slice(dot);
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

/**
 * Whether a MIME type is on the allow-list the server checks uploads against (`*`, `image/*` families, exact types).
 * A file the browser could not type (`''`) passes: the server sniffs the content and has the last word.
 */
export function mimeAllowed(mimeType: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns || patterns.length === 0 || mimeType === '') {
    return true;
  }
  const type = mimeType.toLowerCase();
  return patterns.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern === '*' || pattern === '*/*') {
      return true;
    }
    return pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern;
  });
}

/** What a failed request means for the panel: the reason and, for a server problem, what the server said. */
export function uploadFailure(err: unknown): { error: UploadError; detail?: string } {
  if (!(err instanceof HttpErrorResponse) || err.status === 0) {
    return { error: 'network' };
  }
  if (err.status === 413) {
    return { error: 'size' };
  }
  if (err.status === 415) {
    return { error: 'type' };
  }
  const body = err.error as { detail?: string; title?: string } | null;
  const detail = body && typeof body === 'object' ? (body.detail ?? body.title) : undefined;
  return { error: 'server', detail };
}

/** A picture can carry alt text. */
export function acceptsAlt(mimeType: string | undefined): boolean {
  return !!mimeType && mimeType.startsWith('image/');
}
