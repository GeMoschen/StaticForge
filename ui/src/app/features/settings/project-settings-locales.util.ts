import type { components } from '../../core/api/generated/schema.d.ts';

type ProjectLocalesView = components['schemas']['ProjectLocalesView'];

/** One row of the Languages editor: a language tag, its label and the languages it falls back to. */
export interface LocaleRow {
  code: string;
  label: string;
  fallbacks: string[];
}

/** A server or client validation finding, keyed by the form field it belongs to. */
export interface LocaleFieldError {
  field: string;
  message: string;
}

/**
 * Validates the edited rows exactly as the server does, so the form blocks a save the API would
 * reject anyway.
 *
 * <p>Kept in its own module, free of Angular imports, so it can be unit-tested directly — a spec
 * that imports the component instead pulls in its `templateUrl` and needs the JIT compiler.
 */
export function validateLocales(rows: LocaleRow[], defaultLocale: string): LocaleFieldError[] {
  const errors: LocaleFieldError[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const field = `locales[${index}].code`;
    const code = row.code.trim();
    if (!code) {
      errors.push({ field, message: 'A language tag is required.' });
      return;
    }
    if (!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(code)) {
      errors.push({ field, message: `'${code}' is not a valid BCP 47 language tag.` });
      return;
    }
    if (seen.has(code.toLowerCase())) {
      errors.push({ field, message: `'${code}' is listed more than once.` });
      return;
    }
    seen.add(code.toLowerCase());
  });

  if (rows.length > 0 && !defaultLocale) {
    errors.push({ field: 'defaultLocale', message: 'Pick the default language.' });
  } else if (rows.length > 0 && !seen.has(defaultLocale.toLowerCase())) {
    errors.push({ field: 'defaultLocale', message: `'${defaultLocale}' is not one of the languages listed above.` });
  }

  // A fallback chain that can reach its own language would loop forever at render time.
  const edges = new Map<string, string[]>();
  rows.forEach((row) => edges.set(row.code, row.fallbacks));
  for (const row of rows) {
    if (row.fallbacks.includes(row.code)) {
      errors.push({ field: `fallbacks[${row.code}]`, message: `'${row.code}' cannot fall back to itself.` });
      continue;
    }
    if (reachesSelf(row.code, row.code, edges, new Set<string>())) {
      errors.push({ field: `fallbacks[${row.code}]`, message: `The fallback chain of '${row.code}' is cyclic.` });
    }
  }
  return errors;
}

function reachesSelf(origin: string, current: string, edges: Map<string, string[]>, visited: Set<string>): boolean {
  if (visited.has(current)) {
    return false;
  }
  visited.add(current);
  for (const next of edges.get(current) ?? []) {
    if (next === origin || reachesSelf(origin, next, edges, visited)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the edited form still matches what the server last returned — the form is only saveable
 * once something actually differs. Pure, so it can be unit-tested without the component.
 */
export function localesChanged(
  before: ProjectLocalesView | null,
  rows: LocaleRow[],
  defaultLocale: string,
  defaultWithoutPrefix: boolean,
): boolean {
  if (!before) {
    return false;
  }
  const savedRows: LocaleRow[] = (before.locales ?? []).map((locale) => ({
    code: locale.code ?? '',
    label: locale.label ?? '',
    fallbacks: before.fallbacks?.[locale.code ?? ''] ?? [],
  }));
  // The saved default falls back to the first language the same way the form's does, so a project
  // stored without an explicit default does not look edited the moment it loads.
  const savedDefault = before.defaultLocale || savedRows[0]?.code || '';
  return (
    fingerprint(savedRows) !== fingerprint(rows) ||
    savedDefault !== defaultLocale ||
    (before.defaultWithoutPrefix ?? false) !== defaultWithoutPrefix
  );
}

/** Order matters for both the language list and each fallback chain, so neither is sorted. */
function fingerprint(rows: LocaleRow[]): string {
  return JSON.stringify(rows.map((row) => [row.code, row.label, row.fallbacks]));
}

/**
 * Whether saving these rows changes the site's generated URLs: the project gains or loses
 * languages, or the "default language without prefix" setting flips. Pure, so the confirmation can
 * be shown *before* the request rather than after the server answers.
 */
export function urlsWillChange(
  before: ProjectLocalesView | null,
  rows: LocaleRow[],
  defaultWithoutPrefix: boolean,
): boolean {
  const wasLocalized = (before?.locales?.length ?? 0) > 0;
  const willBeLocalized = rows.length > 0;
  if (wasLocalized !== willBeLocalized) {
    return true;
  }
  return willBeLocalized && (before?.defaultWithoutPrefix ?? false) !== defaultWithoutPrefix;
}
