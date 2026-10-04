/** The placeholder a multi-language project's output path needs, so pages of different languages don't overwrite each other. */
export const LOCALE_PLACEHOLDER = '{locale}';

/** The server's code for "this output path has no `{locale}`" (M35.1 item 10). */
export const OUTPUT_PATH_LOCALE_CODE = 'SF-GEN-0112';

interface ServerWarning {
  readonly code?: string | null;
  readonly message?: string | null;
}

/** The map an update sends: blank paths are left out, so those channels use the default output path. */
export function outputPathsForSave(paths: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [channel, path] of Object.entries(paths)) {
    if (path.trim()) {
      out[channel] = path.trim();
    }
  }
  return out;
}

/**
 * Whether an output path lacks `{locale}` in a project with more than one language (decision 163, the client check while
 * typing). A blank path uses the server's default, which is not judged; a project with one language or none needs none.
 */
export function outputPathLacksLocale(path: string | null | undefined, languageCount: number): boolean {
  const value = (path ?? '').trim();
  return languageCount > 1 && value !== '' && !value.includes(LOCALE_PLACEHOLDER);
}

/**
 * The messages to show under one channel's output path, never the same thing twice: the client check while typing when the
 * path lacks `{locale}` in a multi-language project, else the server's warnings about the saved path. The server's
 * warning is dropped once the client check says the same, and while the path differs from the saved one (the server
 * judged the saved path, not the edit).
 */
export function outputPathMessages(options: {
  path: string;
  savedPath: string;
  languageCount: number;
  server: readonly ServerWarning[];
  clientMessage: string;
}): string[] {
  const client = outputPathLacksLocale(options.path, options.languageCount);
  const messages: string[] = client ? [options.clientMessage] : [];
  if (options.path.trim() === options.savedPath.trim()) {
    for (const warning of options.server) {
      if (client && warning.code === OUTPUT_PATH_LOCALE_CODE) {
        continue;
      }
      if (warning.message && !messages.includes(warning.message)) {
        messages.push(warning.message);
      }
    }
  }
  return messages;
}
