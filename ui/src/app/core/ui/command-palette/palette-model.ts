import { fuzzyMatch, type FuzzyMatch } from '../fuzzy-match.util';

export type PaletteGroup = 'actions' | 'navigate' | 'recent' | 'favorites' | 'search' | 'settings' | 'projects';
/** `>` actions only, `#` settings pages, `@` projects; no prefix = everything. */
export type PaletteMode = 'all' | 'actions' | 'settings' | 'projects';

export const PALETTE_PREFIXES: Readonly<Record<string, Exclude<PaletteMode, 'all'>>> = {
  '>': 'actions',
  '#': 'settings',
  '@': 'projects',
};

/** The prefix that enters a mode. */
export const PREFIX_OF_MODE: Readonly<Record<Exclude<PaletteMode, 'all'>, string>> = {
  actions: '>',
  settings: '#',
  projects: '@',
};

/** One selectable row. `label` is already translated; `run` does it (the palette closes first). */
export interface PaletteItem {
  readonly id: string;
  readonly group: PaletteGroup;
  readonly label: string;
  readonly icon: string;
  /** Muted text after the name (a path, the area a setting belongs to). */
  readonly context?: string | null;
  /** The key hint on the right, in `sf-kbd` notation. */
  readonly keys?: string | null;
  /** The server already matched it (search results): no fuzzy filter. */
  readonly matched?: boolean;
  readonly run: () => void;
}

/** What the palette can offer; each list is already filtered to what the person may use. */
export interface PaletteSources {
  readonly actions: readonly PaletteItem[];
  readonly navigate: readonly PaletteItem[];
  readonly settings: readonly PaletteItem[];
  readonly projects: readonly PaletteItem[];
  readonly recent: readonly PaletteItem[];
  readonly favorites: readonly PaletteItem[];
  /** The live search's hits, best first. */
  readonly search: readonly PaletteItem[];
  /** How many hits the search found in all (for the "See all" row). */
  readonly searchTotal: number;
}

export interface PaletteRow {
  readonly item: PaletteItem;
  readonly match: FuzzyMatch | null;
}

export interface PaletteSection {
  readonly group: PaletteGroup;
  readonly rows: PaletteRow[];
  /** More matches than shown. */
  readonly more: number;
}

export const SEARCH_CAP = 4;
const NAVIGATE_CAP = 6;
const EMPTY_ACTION_CAP = 5;

/** Reads the mode prefix off the query: `"> build"` → mode `actions`, rest `"build"`. */
export function parseQuery(raw: string): { mode: PaletteMode; rest: string } {
  const mode = PALETTE_PREFIXES[raw.charAt(0)];
  return mode ? { mode, rest: raw.slice(1).trimStart() } : { mode: 'all', rest: raw.trimStart() };
}

/**
 * The sections for a query. Empty query: the context actions, Recent, Favorites, then the screens. With text: Actions,
 * Navigate (screens and settings pages), Recent, Favorites and the search results, each ranked by match. A prefix
 * narrows it to one group. Pure.
 */
export function buildSections(raw: string, sources: PaletteSources): PaletteSection[] {
  const { mode, rest } = parseQuery(raw);
  const rank = (items: readonly PaletteItem[], cap = Infinity) => {
    const rows = items
      .map((item): PaletteRow => ({ item, match: item.matched ? null : fuzzyMatch(rest, item.label) }))
      .filter((row) => row.item.matched || row.match !== null)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
    return { rows: rows.slice(0, cap), more: Math.max(0, rows.length - cap) };
  };
  const section = (group: PaletteGroup, items: readonly PaletteItem[], cap?: number): PaletteSection[] => {
    const { rows, more } = rank(items, cap);
    return rows.length > 0 ? [{ group, rows, more }] : [];
  };

  if (mode === 'actions') {
    return section('actions', sources.actions);
  }
  if (mode === 'settings') {
    return section('settings', sources.settings);
  }
  if (mode === 'projects') {
    return section('projects', sources.projects);
  }
  if (rest === '') {
    return [
      ...section('actions', sources.actions, EMPTY_ACTION_CAP),
      ...section('recent', sources.recent),
      ...section('favorites', sources.favorites),
      ...section('navigate', sources.navigate),
    ];
  }
  const found = sources.search.slice(0, SEARCH_CAP);
  const searchSection: PaletteSection[] =
    found.length > 0
      ? [{ group: 'search', rows: found.map((item) => ({ item, match: null })), more: Math.max(0, sources.searchTotal - found.length) }]
      : [];
  return [
    ...section('actions', sources.actions),
    ...section('navigate', [...sources.navigate, ...sources.settings.map((item) => ({ ...item, group: 'navigate' as const }))], NAVIGATE_CAP),
    ...section('recent', sources.recent),
    ...section('favorites', sources.favorites),
    ...searchSection,
  ];
}
