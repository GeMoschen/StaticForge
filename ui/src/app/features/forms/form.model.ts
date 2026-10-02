/**
 * The content-definition JSON contract returned by the backend as
 * `compiledDefinition` — the normalized AST emitted by the CDL compiler
 * (spec §14). These interfaces mirror the Java records in
 * `server/sf-template/.../template/content` one-to-one.
 *
 * IMPORTANT: the `EditorType` enum serializes as its UPPERCASE name (Java enum
 * default), so `"TEXT"`, `"RICHTEXT"`, `"MEDIA"`, etc. are the canonical strings.
 */
export type EditorType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'RICHTEXT'
  | 'MARKDOWN'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'SELECT'
  | 'MULTISELECT'
  | 'COLOR'
  | 'LINK'
  | 'MEDIA'
  | 'REFERENCE'
  | 'LIST'
  | 'GROUP'
  | 'JSON'
  | 'CATALOG'
  | 'PAGINATION';

/** The declaration of a PAGINATION editor (M21.1.1), mirroring `PaginationOptions`. */
export interface PaginationOptions {
  /** Allowed source kinds, lowercase: `nav` and/or `dataset`. */
  sources: string[];
  pageSize: number;
  maxPageSize?: number | null;
  /** Offered sort keys; the first is the default. */
  sort: string[];
}

export type PaginationSourceKind = 'NAV' | 'DATASET';

/** Value shape of a PAGINATION editor; `null` means the page is not paginated. */
export interface PaginationValue {
  type: 'PAGINATION';
  source: { kind: PaginationSourceKind; uuid: string };
  pageSize: number;
  sort?: { key: string; direction: 'ASC' | 'DESC' } | null;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface EditorDefinition {
  name: string;
  type: EditorType;
  label?: string;
  help?: string;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  maxChars?: number;
  pattern?: string;
  patternMessage?: string;
  mimeTypes?: string[];
  /** For REFERENCE editors: restricts the asset picker to these asset types (e.g. `['PAGE']`); empty/absent allows any type. */
  assetTypes?: string[];
  /** For REFERENCE editors (M19.3.2, M25): restricts picking to records and record sets of this dataset UID. */
  dataset?: string;
  options?: SelectOption[];
  features?: string[];
  /** For CATALOG editors: restricts cards to these section-template UIDs; empty/absent allows any. */
  allow?: string[];
  visibleWhen?: string;
  renamedFrom?: string;
  /**
   * Language-dependent (M24): the stored value is one value per language rather than a bare value,
   * and the form binds whichever language is being edited. Only leaf editors carry it.
   */
  localizable?: boolean;
  /**
   * `half`: the field shares a row with the next half-width field when the form is wide enough (M35.17); `full`
   * (the default) spans the row. Set by the template's `width: half`.
   */
  width?: 'half' | 'full';
  items?: EditorDefinition[];
  /** For PAGINATION editors (M21.1.1): sources, page size and sort keys. */
  pagination?: PaginationOptions | null;
}

export interface BodyDefinition {
  name: string;
  label?: string;
  allow?: string[];
  min?: number;
  max?: number;
}

export interface ContentDefinition {
  editors: EditorDefinition[];
  bodies: BodyDefinition[];
}

/** The raw value type carried by an editor control (loosely typed on purpose). */
export type EditorValue = unknown;

export type LinkKind = 'INTERNAL' | 'EXTERNAL' | 'MEDIA' | 'ANCHOR' | 'MAIL';

/** Value shape of a LINK editor. */
export interface Link {
  kind: LinkKind;
  uuid?: string;
  url?: string;
  anchor?: string;
  target?: string;
  title?: string;
}

/** Value shape of a MEDIA editor (`{ type: 'MEDIA_REF', ... }`). */
export interface MediaRef {
  type: 'MEDIA_REF';
  uuid: string;
  variant?: string;
  altOverride?: string;
}

/** Value shape of a REFERENCE editor (`{ type: 'ASSET_REF', ... }`). */
export interface AssetRef {
  type: 'ASSET_REF';
  uuid: string;
  assetType: string;
}

/** A single card in a CATALOG editor — same shape as a page body's section instance. */
export interface CatalogCard {
  instanceId: string;
  templateRef: string;
  content: Record<string, unknown>;
}

/** Value shape of a CATALOG editor (`{ type: 'CATALOG', cards: [...] }`). */
export interface CatalogValue {
  type: 'CATALOG';
  cards: CatalogCard[];
}

/**
 * A type-appropriate default for an editor when no configured `defaultValue`
 * and no persisted value are available.
 */
export function defaultEditorValue(type: EditorType): unknown {
  switch (type) {
    case 'BOOLEAN':
      return false;
    case 'NUMBER':
      return null;
    case 'MULTISELECT':
      return [];
    case 'LIST':
      return [];
    case 'CATALOG':
      return { type: 'CATALOG', cards: [] } satisfies CatalogValue;
    case 'TEXT':
    case 'TEXTAREA':
    case 'MARKDOWN':
    case 'COLOR':
    case 'DATE':
    case 'DATETIME':
    case 'SELECT':
    case 'JSON':
      return '';
    default:
      return null;
  }
}

/**
 * Resolves the seed value for a top-level editor from a persisted value record
 * (or the configured `defaultValue`), mirroring the intended
 * `value[name] ?? defaultValue` semantics.
 */
export function editorValueFromDefinition(
  definition: EditorDefinition,
  value: Record<string, unknown> | null | undefined,
): unknown {
  const current = value != null ? value[definition.name] : undefined;
  if (current !== undefined && current !== null) {
    return current;
  }
  if (definition.defaultValue !== undefined && definition.defaultValue !== null) {
    return definition.defaultValue;
  }
  return defaultEditorValue(definition.type);
}

/** Field names carried by the LINK editor FormGroup (with their defaults). */
export const LINK_FIELDS: Record<keyof Link, unknown> = {
  kind: 'INTERNAL',
  uuid: null,
  url: null,
  anchor: null,
  target: null,
  title: null,
};

/** Field names carried by the MEDIA editor FormGroup (with their defaults). */
export const MEDIA_FIELDS: Record<keyof MediaRef, unknown> = {
  type: 'MEDIA_REF',
  uuid: null,
  variant: null,
  altOverride: null,
};

/** Field names carried by the REFERENCE editor FormGroup (with their defaults). */
export const REFERENCE_FIELDS: Record<keyof AssetRef, unknown> = {
  type: 'ASSET_REF',
  uuid: null,
  assetType: null,
};
