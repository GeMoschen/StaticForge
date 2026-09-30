/**
 * Which format a template or text file is highlighted as (M33 follow-up): the channel's own "Highlight as" when it
 * isn't `AUTO`, then the project's overrides (file extension before MIME type), then the built-in detection (MIME
 * type before file extension), else plain text. OCTL instructions are highlighted on top of every format.
 */

/** The formats the code editors highlight as. */
export type CodeFormat = 'HTML' | 'MARKDOWN' | 'JSON' | 'XML' | 'CSS' | 'JAVASCRIPT' | 'YAML' | 'PLAIN';

export const CODE_FORMATS: readonly CodeFormat[] = [
  'HTML',
  'MARKDOWN',
  'JSON',
  'XML',
  'CSS',
  'JAVASCRIPT',
  'YAML',
  'PLAIN',
];

/** How each format is named in the UI. */
export const CODE_FORMAT_LABELS: Record<CodeFormat, string> = {
  HTML: 'HTML',
  MARKDOWN: 'Markdown',
  JSON: 'JSON',
  XML: 'XML',
  CSS: 'CSS',
  JAVASCRIPT: 'JavaScript',
  YAML: 'YAML',
  PLAIN: 'Plain text',
};

/** A project's overrides (`ProjectDetail.codeHighlighting`): extension (no dot) or MIME type → format. */
export interface CodeHighlightingOverrides {
  extensions?: Record<string, string>;
  mimeTypes?: Record<string, string>;
}

/** What a template or file says about itself. */
export interface CodeFormatSource {
  /** A channel's `settings.highlightAs`; `AUTO` or absent means detect. */
  highlightAs?: string | null;
  /** The file extension, with or without the dot (`html`, `.svg`). */
  extension?: string | null;
  mimeType?: string | null;
  overrides?: CodeHighlightingOverrides | null;
}

/** The format to highlight as, and whether the file is SVG (XML with SVG element and attribute completion). */
export interface ResolvedCodeFormat {
  format: CodeFormat;
  svg: boolean;
}

const BY_MIME: Record<string, CodeFormat> = {
  'text/html': 'HTML',
  'application/xhtml+xml': 'HTML',
  'text/markdown': 'MARKDOWN',
  'text/x-markdown': 'MARKDOWN',
  'application/json': 'JSON',
  'text/json': 'JSON',
  'application/xml': 'XML',
  'text/xml': 'XML',
  'text/css': 'CSS',
  'text/javascript': 'JAVASCRIPT',
  'application/javascript': 'JAVASCRIPT',
  'application/x-javascript': 'JAVASCRIPT',
  'application/ecmascript': 'JAVASCRIPT',
  'text/ecmascript': 'JAVASCRIPT',
  'application/yaml': 'YAML',
  'application/x-yaml': 'YAML',
  'text/yaml': 'YAML',
  'text/x-yaml': 'YAML',
};

const BY_EXTENSION: Record<string, CodeFormat> = {
  html: 'HTML',
  htm: 'HTML',
  xhtml: 'HTML',
  shtml: 'HTML',
  md: 'MARKDOWN',
  markdown: 'MARKDOWN',
  json: 'JSON',
  jsonld: 'JSON',
  webmanifest: 'JSON',
  geojson: 'JSON',
  xml: 'XML',
  svg: 'XML',
  rss: 'XML',
  atom: 'XML',
  xsl: 'XML',
  xslt: 'XML',
  xsd: 'XML',
  kml: 'XML',
  gpx: 'XML',
  css: 'CSS',
  js: 'JAVASCRIPT',
  mjs: 'JAVASCRIPT',
  cjs: 'JAVASCRIPT',
  yaml: 'YAML',
  yml: 'YAML',
  txt: 'PLAIN',
};

function known(format: string | null | undefined): CodeFormat | null {
  const upper = (format ?? '').toUpperCase();
  return (CODE_FORMATS as readonly string[]).includes(upper) ? (upper as CodeFormat) : null;
}

/** The extension without dot, lower case; `null` when there is none. */
export function normalizeExtension(extension: string | null | undefined): string | null {
  const value = (extension ?? '').trim().toLowerCase().replace(/^\./, '');
  return value || null;
}

/** The MIME type without parameters, lower case; `null` when there is none. */
export function normalizeMimeType(mimeType: string | null | undefined): string | null {
  const value = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return value || null;
}

/** The extension of a file name (`logo.SVG` → `svg`); `null` without one. */
export function extensionOf(fileName: string | null | undefined): string | null {
  const name = (fileName ?? '').split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? normalizeExtension(name.slice(dot + 1)) : null;
}

function builtInMime(mime: string): CodeFormat | null {
  if (BY_MIME[mime]) {
    return BY_MIME[mime];
  }
  if (mime.endsWith('+json')) {
    return 'JSON';
  }
  if (mime.endsWith('+xml')) {
    return 'XML';
  }
  return null;
}

/** Resolves the format for a template or text file (see the file comment for the order). */
export function resolveCodeFormat(source: CodeFormatSource): ResolvedCodeFormat {
  const extension = normalizeExtension(source.extension);
  const mime = normalizeMimeType(source.mimeType);
  const svg = extension === 'svg' || mime === 'image/svg+xml';
  const format =
    (source.highlightAs && source.highlightAs.toUpperCase() !== 'AUTO' ? known(source.highlightAs) : null) ??
    (extension ? known(source.overrides?.extensions?.[extension]) : null) ??
    (mime ? known(source.overrides?.mimeTypes?.[mime]) : null) ??
    (mime ? builtInMime(mime) : null) ??
    (extension ? (BY_EXTENSION[extension] ?? null) : null) ??
    'PLAIN';
  return { format, svg: format === 'XML' && svg };
}

/** What a channel says about its templates (`ChannelView`). */
export interface CodeFormatChannel {
  key?: string;
  fileExtension?: string;
  mimeType?: string;
  settings?: unknown;
}

/** A channel's `settings.highlightAs`, or `null`. */
export function highlightAsOf(settings: unknown): string | null {
  const value = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)['highlightAs'] : null;
  return typeof value === 'string' ? value : null;
}

/** The format of a channel's templates; the extension falls back to the key like the server's (`markdown` → `md`). */
export function channelCodeFormat(
  channel: CodeFormatChannel | null | undefined,
  overrides: CodeHighlightingOverrides | null | undefined,
): ResolvedCodeFormat {
  if (!channel) {
    return { format: 'PLAIN', svg: false };
  }
  const extension = channel.fileExtension || (channel.key === 'markdown' ? 'md' : channel.key);
  return resolveCodeFormat({
    highlightAs: highlightAsOf(channel.settings),
    extension,
    mimeType: channel.mimeType,
    overrides,
  });
}
