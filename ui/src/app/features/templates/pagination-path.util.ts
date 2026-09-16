/** The pattern pages 2..N use when a channel has none (M21.2.1): a sibling of page 1, `news/blog-2.html`. */
export const DEFAULT_PAGINATION_PATH = '{pagePath}-{pageNumber}.{ext}';

interface EditorLike {
  type?: string;
  items?: EditorLike[];
}

/**
 * Whether a page template paginates: its effective definition (own and inherited editors) holds a `pagination`
 * editor, or the CDL being edited declares one before it is saved.
 */
export function declaresPagination(effectiveEditors: EditorLike[] | null | undefined, cdlSource: string): boolean {
  return hasPaginationEditor(effectiveEditors ?? []) || /\beditor\s+pagination\b/.test(cdlSource);
}

function hasPaginationEditor(editors: EditorLike[]): boolean {
  return editors.some((editor) => editor.type === 'PAGINATION' || hasPaginationEditor(editor.items ?? []));
}

/** The stored per-channel patterns as strings, for the form. */
export function readPaginationPaths(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object') {
    for (const [channel, pattern] of Object.entries(value as Record<string, unknown>)) {
      if (typeof pattern === 'string') {
        out[channel] = pattern;
      }
    }
  }
  return out;
}

/** The map an update sends: blank patterns are left out, so those channels use the default. */
export function paginationPathsForSave(paths: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [channel, pattern] of Object.entries(paths)) {
    if (pattern.trim()) {
      out[channel] = pattern.trim();
    }
  }
  return out;
}

/** Why a pattern can't be saved (mirrors the server's check), or `null`; blank means "use the default". */
export function paginationPathError(pattern: string | null | undefined): string | null {
  const value = (pattern ?? '').trim();
  if (!value) {
    return null;
  }
  return value.includes('{pageNumber}') ? null : 'Must contain {pageNumber}, or every page would be written to the same file.';
}
