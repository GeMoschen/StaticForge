import { patchAt, readPath, composePatches } from './merge-patch';
import type { MergePatch } from './preferences.types';

/**
 * Whether a successful migration removes the `localStorage` keys it moved. Off while the components that own those
 * keys (theme service, nav rail, page editor, record grid, issues panel, preview, editing-locale store) still read and
 * write `localStorage` themselves — removing the keys would make them forget their values. Flip it, in the same change
 * that switches the last of those consumers to `PreferencesService` (M35.5, M35.10, ...).
 */
export const MIGRATION_REMOVES_LOCAL_KEYS = false;

export const LEGACY_KEYS = {
  rail: 'sf-nav-rail-expanded',
  theme: 'sf-theme',
  split: 'sf-editor-split-ratio',
  gridPrefix: 'sf-record-grid-hidden:',
  issueScopes: 'sf-issues-scopes',
  previewView: 'sf-preview-view',
  editingLocalePrefix: 'sf.editingLocale.',
} as const;

export const PAGE_EDITOR_SPLIT_PANE = 'page-editor-split';

export interface LegacyMigration {
  /** Merge patch with the values the server document lacks. */
  patch: MergePatch;
  /** Every `localStorage` key that was read (and whose value is now either migrated or already on the server). */
  keys: string[];
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function legacyKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

export function removeLegacyKeys(keys: readonly string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage refused: the stale key is harmless, the server now holds the value */
    }
  }
}

function parseStringArray(raw: string | null): string[] | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Reads the legacy `localStorage` keys and returns what should be written to the server — only values the server
 * document does not already hold, so it is idempotent and never overrides a newer server value. Pure apart from reading
 * storage.
 */
export function collectLegacyMigration(serverDoc: unknown): LegacyMigration {
  let patch: MergePatch = {};
  const keys: string[] = [];
  const add = (key: string, path: string[], value: unknown): void => {
    keys.push(key);
    if (value !== null && value !== undefined && readPath(serverDoc, path) === undefined) {
      patch = composePatches(patch, patchAt(path, value));
    }
  };

  const rail = safeGet(LEGACY_KEYS.rail);
  if (rail === '1' || rail === '0') {
    add(LEGACY_KEYS.rail, ['railCollapsed'], rail === '0');
  }
  const theme = safeGet(LEGACY_KEYS.theme);
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    add(LEGACY_KEYS.theme, ['theme'], theme);
  }
  const split = safeGet(LEGACY_KEYS.split);
  if (split !== null && split !== '' && Number.isFinite(Number(split))) {
    add(LEGACY_KEYS.split, ['paneSizes', PAGE_EDITOR_SPLIT_PANE], Number(split));
  }
  const scopes = parseStringArray(safeGet(LEGACY_KEYS.issueScopes));
  if (scopes !== null) {
    add(LEGACY_KEYS.issueScopes, ['issueScopes'], scopes);
  }
  const preview = safeGet(LEGACY_KEYS.previewView);
  if (preview === 'draft' || preview === 'published') {
    add(LEGACY_KEYS.previewView, ['previewView'], preview);
  }

  for (const key of legacyKeys()) {
    if (key.startsWith(LEGACY_KEYS.gridPrefix)) {
      const rest = key.slice(LEGACY_KEYS.gridPrefix.length);
      const cut = rest.lastIndexOf(':');
      const columns = parseStringArray(safeGet(key));
      if (cut > 0 && columns !== null) {
        add(key, ['projects', rest.slice(0, cut), 'gridColumns', rest.slice(cut + 1)], columns);
      }
    } else if (key.startsWith(LEGACY_KEYS.editingLocalePrefix)) {
      const projectKey = key.slice(LEGACY_KEYS.editingLocalePrefix.length);
      const locale = safeGet(key);
      if (projectKey !== '' && locale) {
        add(key, ['projects', projectKey, 'editingLocale'], locale);
      }
    }
  }
  return { patch, keys };
}
