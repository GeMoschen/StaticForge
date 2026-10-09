import type { components } from '../../../core/api/generated/schema.d.ts';

export type GenerationTargetView = components['schemas']['GenerationTargetView'];
export type GenerationTargetRequest = components['schemas']['GenerationTargetRequest'];
type JsonNode = components['schemas']['JsonNode'];

/** A target's kind as the form names it; the server's `TargetType` is `FILESYSTEM`, `ZIP` or `S3`. */
export type TargetKind = 'folder' | 'zip' | 's3';

export const TARGET_KINDS: readonly TargetKind[] = ['folder', 'zip', 's3'];
export const KIND_TYPES: Readonly<Record<TargetKind, string>> = { folder: 'FILESYSTEM', zip: 'ZIP', s3: 'S3' };
export const KIND_ICONS: Readonly<Record<TargetKind, string>> = { folder: 'folder', zip: 'folder_zip', s3: 'cloud' };

/** The form's "Redirect output" choices (M30, epic decision 18: `config.redirectFormats`), in the server's order. */
export const REDIRECT_OUTPUTS = [
  { key: 'html', format: 'HTML_STUB' },
  { key: 'htaccess', format: 'HTACCESS' },
  { key: 'json', format: 'JSON' },
] as const;
export type RedirectKey = (typeof REDIRECT_OUTPUTS)[number]['key'];

/** What a target without `config.redirectFormats` writes (the server's `RedirectFormat.DEFAULT`). */
const DEFAULT_REDIRECT_FORMATS: readonly string[] = ['HTML_STUB'];

/** A target being edited in the drawer (`id` null: a new one). */
export interface TargetDraft {
  id: number | null;
  name: string;
  kind: TargetKind;
  /** The output folder, relative to the project's output root; empty: `target-<id>`. */
  path: string;
  baseUrl: string;
  isDefault: boolean;
  redirects: Record<RedirectKey, boolean>;
}

type TargetConfig = Record<string, unknown>;

const configOf = (target: GenerationTargetView | null): TargetConfig => (target?.config as TargetConfig | undefined) ?? {};

const redirectChecks = (formats: readonly string[]): Record<RedirectKey, boolean> => ({
  html: formats.includes('HTML_STUB'),
  htaccess: formats.includes('HTACCESS'),
  json: formats.includes('JSON'),
});

/** The kind of a server `type`; anything unknown reads as the first, Folder. */
export function kindOf(type: string | undefined): TargetKind {
  return TARGET_KINDS.find((kind) => KIND_TYPES[kind] === type) ?? 'folder';
}

/** A new target; the project's first one starts as the default so builds work without a second step. */
export function newDraft(first: boolean): TargetDraft {
  return {
    id: null,
    name: '',
    kind: 'folder',
    path: '',
    baseUrl: '',
    isDefault: first,
    redirects: redirectChecks(DEFAULT_REDIRECT_FORMATS),
  };
}

/** `target` as the form edits it. The view resolves a missing `redirectFormats` to the default, so that is what it writes. */
export function draftOf(target: GenerationTargetView): TargetDraft {
  const path = configOf(target)['path'];
  return {
    id: target.id ?? null,
    name: target.name ?? '',
    kind: kindOf(target.type),
    path: typeof path === 'string' ? path : '',
    baseUrl: target.baseUrl ?? '',
    isDefault: target.isDefault ?? false,
    redirects: redirectChecks(target.redirectFormats ?? DEFAULT_REDIRECT_FORMATS),
  };
}

/**
 * The request for `draft`. `config` keeps the keys the form does not edit (`original`'s); `redirectFormats` is always
 * explicit, since `[]` means "no redirect output" and a missing key cannot say that. A blank `baseUrl` removes it.
 */
export function requestOf(draft: TargetDraft, original: GenerationTargetView | null): GenerationTargetRequest {
  const config: TargetConfig = { ...configOf(original) };
  const path = draft.path.trim();
  if (path) {
    config['path'] = path;
  } else {
    delete config['path'];
  }
  config['redirectFormats'] = REDIRECT_OUTPUTS.filter((o) => draft.redirects[o.key]).map((o) => o.format);
  return {
    name: draft.name.trim(),
    type: KIND_TYPES[draft.kind],
    config: config as JsonNode,
    isDefault: draft.isDefault,
    baseUrl: draft.baseUrl.trim(),
  };
}
