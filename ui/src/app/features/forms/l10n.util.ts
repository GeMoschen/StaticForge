/**
 * The client-side twin of the server's `L10nValues` helper: how a language-dependent
 * (`localizable`, M24) editor value is stored, and how the form engine reads and writes one
 * language of it without touching the others.
 *
 * ```json
 * "headline": { "type": "L10N", "values": { "de": "Die Parka", "en": "The parka" } }
 * ```
 */

export const L10N_TYPE = 'L10N';

/** A language-dependent stored value. */
export interface L10nValue {
  type: typeof L10N_TYPE;
  values: Record<string, unknown>;
}

/** What the form engine needs to know to bind one language of a content object. */
export interface EditingLocale {
  /** The language being edited. */
  locale: string;
  /** Its fallback chain, the language itself first — used for the "inherited from …" hint. */
  chain: string[];
}

/** Whether `node` is a language-dependent value. */
export function isL10n(node: unknown): node is L10nValue {
  return (
    !!node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    (node as L10nValue).type === L10N_TYPE &&
    !!(node as L10nValue).values &&
    typeof (node as L10nValue).values === 'object'
  );
}

/**
 * The value stored for exactly `locale`, without falling back — what the editor's input shows,
 * so an untranslated field looks empty rather than silently inheriting.
 */
export function valueFor(node: unknown, locale: string): unknown {
  if (!isL10n(node)) {
    return undefined;
  }
  const value = node.values[locale];
  return value === null ? undefined : value;
}

/** The first language in `chain` that has a value, or `null` when none does. */
export function resolvedLocale(node: unknown, chain: string[]): string | null {
  if (!isL10n(node)) {
    return null;
  }
  for (const locale of chain) {
    const value = node.values[locale];
    if (value !== undefined && value !== null && value !== '') {
      return locale;
    }
  }
  return null;
}

/** The value `chain` resolves to — what the page will actually render. */
export function resolve(node: unknown, chain: string[]): unknown {
  if (!isL10n(node)) {
    return node;
  }
  const locale = resolvedLocale(node, chain);
  return locale === null ? undefined : node.values[locale];
}

/**
 * A copy of `node` with `locale` set to `value`, every other language untouched — the whole
 * reason the form writes back through this helper rather than replacing the value.
 *
 * <p>An empty value removes that language's entry, so "cleared" and "never translated" stay the
 * same thing, and the page falls back exactly as the server would.
 */
export function withValue(node: unknown, locale: string, value: unknown): L10nValue {
  const values: Record<string, unknown> = isL10n(node) ? { ...node.values } : {};
  if (value === undefined || value === null || value === '') {
    delete values[locale];
  } else {
    values[locale] = value;
  }
  return { type: L10N_TYPE, values };
}

/** The languages this value carries a translation for. */
export function localesOf(node: unknown): string[] {
  if (!isL10n(node)) {
    return [];
  }
  return Object.keys(node.values).filter((locale) => {
    const value = node.values[locale];
    return value !== undefined && value !== null && value !== '';
  });
}

/** The languages a value is translated into that the project no longer declares. */
export function orphanedLocales(node: unknown, declared: string[]): string[] {
  const lower = declared.map((code) => code.toLowerCase());
  return localesOf(node).filter((locale) => !lower.includes(locale.toLowerCase()));
}
