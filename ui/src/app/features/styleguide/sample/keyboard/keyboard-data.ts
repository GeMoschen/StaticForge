import { FuzzyMatch, fuzzyMatch } from '../../../../core/ui/fuzzy-match.util';
import { FAVORITE_ICONS, SampleFavorite } from '../sample-favorites';
import { PROJECTS, SITE, SampleEntry, entryById, pathTo } from '../sample-data';
import { SampleArea, SampleView } from '../sample-state';

// ── The command palette (M35.14) ─────────────────────────────────────────────

export type PaletteGroup = 'actions' | 'navigate' | 'recent' | 'favorites' | 'search' | 'settings' | 'projects';
/** `>` actions only, `#` settings pages, `@` projects; no prefix = everything. */
export type PaletteMode = 'all' | 'actions' | 'settings' | 'projects';

export const PALETTE_PREFIXES: Readonly<Record<string, Exclude<PaletteMode, 'all'>>> = {
  '>': 'actions',
  '#': 'settings',
  '@': 'projects',
};

/** What running an entry does in the sample. */
export type PaletteRun =
  | { readonly kind: 'area'; readonly area: SampleArea }
  | { readonly kind: 'page'; readonly id: string }
  | { readonly kind: 'toggle'; readonly what: 'theme' | 'density' | 'dev' }
  | { readonly kind: 'history' }
  | { readonly kind: 'favorite' }
  | { readonly kind: 'favorite-open'; readonly favorite: SampleFavorite }
  | { readonly kind: 'switch-mode'; readonly prefix: string }
  | { readonly kind: 'notice'; readonly key: string; readonly params?: Readonly<Record<string, string>> };

export interface PaletteEntry {
  readonly id: string;
  readonly group: PaletteGroup;
  /** A `styleguide.sample.keyboard.*` key, or fake data shown as it is. */
  readonly labelKey?: string;
  readonly text?: string;
  readonly icon: string;
  /** The key hint on the right. */
  readonly shortcut?: string;
  /** Muted context after the name (a path, the area a setting belongs to). */
  readonly context?: string;
  readonly run: PaletteRun;
}

/** What the palette depends on: the open screen and developer mode (entries the person may not use are left out). */
export interface PaletteContext {
  readonly view: SampleView;
  readonly dev: boolean;
  readonly dark: boolean;
  readonly compact: boolean;
  /** The open folder or page, for "Create page here" / "Release this page". */
  readonly itemName: string | null;
  /** The pages opened last and the favorite pages (ids), newest first. */
  readonly recents: readonly string[];
  readonly favorites: readonly SampleFavorite[];
  /** The open page is a favorite (`null` when no page is open). */
  readonly pageFavorite: boolean | null;
}

const EDITOR_VIEWS: readonly SampleView[] = ['editor', 'record', 'template'];
const CREATE_VIEWS: readonly SampleView[] = ['folder', 'editor'];

function area(id: string, labelKey: string, icon: string, target: SampleArea, shortcut?: string, context?: string): PaletteEntry {
  return { id, group: 'navigate', labelKey, icon, shortcut, context, run: { kind: 'area', area: target } };
}

/** Every screen, in the rail's order; Templates is for developers. */
function navigateEntries(ctx: PaletteContext): PaletteEntry[] {
  return [
    area('go-home', 'keyboard.nav.home', 'home', 'pages', 'g h'),
    area('go-pages', 'keyboard.nav.pages', 'description', 'pages', 'g p'),
    area('go-media', 'keyboard.nav.media', 'perm_media', 'media', 'g m'),
    area('go-content', 'keyboard.nav.content', 'dataset', 'content', 'g c'),
    area('go-navigation', 'keyboard.nav.navigation', 'account_tree', 'navigation', 'g n'),
    area('go-globals', 'keyboard.nav.globals', 'public', 'globals', 'g l'),
    ...(ctx.dev ? [area('go-templates', 'keyboard.nav.templates', 'code', 'templates', 'g t')] : []),
    area('go-changes', 'keyboard.nav.changes', 'difference', 'changes', 'g x'),
    area('go-publishing', 'keyboard.nav.publishing', 'rocket_launch', 'publishing', 'g b'),
    area('go-schedules', 'keyboard.nav.schedules', 'schedule', 'schedules', 'g s'),
    area('go-history', 'keyboard.nav.history', 'history', 'history', undefined),
    area('go-settings', 'keyboard.nav.settings', 'settings', 'settings', 'g ,'),
  ];
}

/** The Settings pages (`#` shows only these; Channels is developer-only). */
function settingsEntries(ctx: PaletteContext): PaletteEntry[] {
  const pages = [
    ['general', 'tune'],
    ['languages', 'translate'],
    ...(ctx.dev ? [['channels', 'cell_tower']] : []),
    ['media', 'perm_media'],
    ['codeHighlighting', 'palette'],
    ['compaction', 'compress'],
    ['importExport', 'import_export'],
    ['members', 'group'],
  ];
  return pages.map(([key, icon]) => ({
    id: `settings-${key}`,
    group: 'settings' as const,
    labelKey: `keyboard.settings.${key}`,
    icon,
    context: 'settings',
    run: { kind: 'area', area: 'settings' } as const,
  }));
}

/** Actions that depend on the context: a page open → release it; the Pages area → create here; developer mode → ... */
function actionEntries(ctx: PaletteContext): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  if (CREATE_VIEWS.includes(ctx.view)) {
    entries.push({
      id: 'create-page',
      group: 'actions',
      labelKey: 'keyboard.actions.createPage',
      icon: 'note_add',
      shortcut: 'n',
      context: ctx.itemName ?? undefined,
      run: { kind: 'notice', key: 'keyboard.notice.createPage' },
    });
  }
  if (EDITOR_VIEWS.includes(ctx.view) && ctx.view !== 'template') {
    entries.push({
      id: 'release',
      group: 'actions',
      labelKey: ctx.view === 'record' ? 'keyboard.actions.releaseRecord' : 'keyboard.actions.releasePage',
      icon: 'rocket_launch',
      shortcut: 'Alt+Shift+R',
      context: ctx.itemName ?? undefined,
      run: { kind: 'notice', key: 'keyboard.notice.release' },
    });
  }
  if (ctx.pageFavorite !== null) {
    entries.push({
      id: 'favorite',
      group: 'actions',
      labelKey: ctx.pageFavorite ? 'keyboard.actions.favoriteRemove' : 'keyboard.actions.favoriteAdd',
      icon: 'star',
      context: ctx.itemName ?? undefined,
      run: { kind: 'favorite' },
    });
  }
  entries.push(
    { id: 'build', group: 'actions', labelKey: 'keyboard.actions.build', icon: 'construction', shortcut: 'Alt+Shift+B', run: { kind: 'notice', key: 'keyboard.notice.build' } },
    { id: 'history', group: 'actions', labelKey: 'keyboard.actions.history', icon: 'history', shortcut: 'Alt+H', run: { kind: 'history' } },
    { id: 'switch-project', group: 'actions', labelKey: 'keyboard.actions.switchProject', icon: 'swap_horiz', context: '@', run: { kind: 'switch-mode', prefix: '@' } },
    { id: 'toggle-theme', group: 'actions', labelKey: ctx.dark ? 'keyboard.actions.themeLight' : 'keyboard.actions.themeDark', icon: ctx.dark ? 'light_mode' : 'dark_mode', run: { kind: 'toggle', what: 'theme' } },
    { id: 'toggle-density', group: 'actions', labelKey: ctx.compact ? 'keyboard.actions.densityComfortable' : 'keyboard.actions.densityCompact', icon: 'density_medium', run: { kind: 'toggle', what: 'density' } },
    { id: 'toggle-dev', group: 'actions', labelKey: ctx.dev ? 'keyboard.actions.devOff' : 'keyboard.actions.devOn', icon: 'code', run: { kind: 'toggle', what: 'dev' } },
    { id: 'sign-out', group: 'actions', labelKey: 'keyboard.actions.signOut', icon: 'logout', run: { kind: 'notice', key: 'keyboard.notice.signOut' } },
  );
  return entries;
}


function pageEntry(group: 'recent' | 'favorites' | 'search', page: SampleEntry, dev: boolean): PaletteEntry {
  const folders = pathTo(page.id).slice(0, -1).map((entry) => entry.name).join(' › ');
  return {
    id: `${group}-${page.id}`,
    group,
    text: page.name,
    icon: page.kind === 'folder' ? 'folder' : 'description',
    context: dev && page.url ? page.url : folders || undefined,
    run: { kind: 'page', id: page.id },
  };
}

function favoriteEntries(favorites: readonly SampleFavorite[]): PaletteEntry[] {
  return favorites.map((favorite) => ({
    id: `favorites-${favorite.key}`,
    group: 'favorites' as const,
    text: favorite.name,
    icon: FAVORITE_ICONS[favorite.kind],
    context: favorite.path || undefined,
    run: { kind: 'favorite-open', favorite } as const,
  }));
}

function allPages(entries: readonly SampleEntry[] = SITE): SampleEntry[] {
  return entries.flatMap((entry) => [entry, ...(entry.children ? allPages(entry.children) : [])]);
}

function projectEntries(): PaletteEntry[] {
  return PROJECTS.map((project) => ({
    id: `project-${project.key}`,
    group: 'projects' as const,
    text: project.name,
    icon: project.favorite ? 'star' : project.recent ? 'history' : 'folder_open',
    context: project.key,
    run: { kind: 'notice', key: 'topbar.switchNotice', params: { name: project.name } } as const,
  }));
}

// ── Building the result list ─────────────────────────────────────────────────

/** One row of the result list: an entry, its match in the label, and its position. */
export interface PaletteRow {
  readonly entry: PaletteEntry;
  readonly label: string;
  readonly match: FuzzyMatch | null;
}

export interface PaletteSection {
  readonly group: PaletteGroup;
  readonly rows: PaletteRow[];
  /** More matches than shown (search results are capped). */
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
 * The sections for a query. `label` turns an entry into its visible text (translated, or the data's own text).
 * Empty query: context actions, Recent, Favorites, then the screens. With text: Actions, Navigate, Recent, Favorites
 * and the search results, each ranked by match. A prefix narrows it to one group.
 */
export function buildSections(raw: string, ctx: PaletteContext, label: (entry: PaletteEntry) => string): PaletteSection[] {
  const { mode, rest } = parseQuery(raw);
  const rank = (entries: PaletteEntry[], cap = Infinity): { rows: PaletteRow[]; more: number } => {
    const rows = entries
      .map((entry) => {
        const text = label(entry);
        return { entry, label: text, match: fuzzyMatch(rest, text) };
      })
      .filter((row) => row.match !== null)
      .sort((a, b) => b.match!.score - a.match!.score);
    return { rows: rows.slice(0, cap), more: Math.max(0, rows.length - cap) };
  };
  const section = (group: PaletteGroup, entries: PaletteEntry[], cap?: number): PaletteSection[] => {
    const { rows, more } = rank(entries, cap);
    return rows.length > 0 ? [{ group, rows, more }] : [];
  };
  const pages = (ids: readonly string[], group: 'recent' | 'favorites') =>
    ids.map((id) => entryById(id)).filter((p): p is SampleEntry => !!p).map((p) => pageEntry(group, p, ctx.dev));

  if (mode === 'actions') {
    return section('actions', actionEntries(ctx));
  }
  if (mode === 'settings') {
    return section('settings', settingsEntries(ctx));
  }
  if (mode === 'projects') {
    return section('projects', projectEntries());
  }
  if (rest === '') {
    return [
      ...section('actions', actionEntries(ctx), EMPTY_ACTION_CAP),
      ...section('recent', pages(ctx.recents, 'recent')),
      ...section('favorites', favoriteEntries(ctx.favorites)),
      ...section('navigate', navigateEntries(ctx)),
    ];
  }
  const found = allPages()
    .filter((page) => fuzzyMatch(rest, page.name) !== null)
    .map((page) => pageEntry('search', page, ctx.dev));
  return [
    ...section('actions', actionEntries(ctx)),
    ...section('navigate', [...navigateEntries(ctx), ...settingsEntries(ctx).map((e) => ({ ...e, group: 'navigate' as const }))], NAVIGATE_CAP),
    ...section('recent', pages(ctx.recents, 'recent')),
    ...section('favorites', favoriteEntries(ctx.favorites)),
    ...(rest.trim().length >= 2 ? section('search', found, SEARCH_CAP) : []),
  ];
}

// ── The shortcut sheet ───────────────────────────────────────────────────────

export interface SheetItem {
  /** A `styleguide.sample.keyboard.sheet.items.*` key. */
  readonly id: string;
  readonly keys: string;
}

export interface SheetGroup {
  /** A `styleguide.sample.keyboard.sheet.groups.*` key. */
  readonly id: string;
  readonly items: readonly SheetItem[];
}

const item = (id: string, keys: string): SheetItem => ({ id, keys });

/** The media library's shortcuts (decision 100): the grid, a file's actions, the open drawer, the focal point, the folder tree. */
const MEDIA_SHORTCUTS: readonly SheetGroup[] = [
  {
    id: 'mediaGrid',
    items: [
      item('gridMove', 'ArrowRight'),
      item('gridFirst', 'Home'),
      item('gridLast', 'End'),
      item('rowSelect', 'Space'),
      item('rowAll', 'Mod+A'),
      item('gridOpen', 'Enter'),
      item('fileRename', 'F2'),
      item('fileMenu', 'Shift+F10'),
      item('fileDelete', 'Delete'),
    ],
  },
  {
    id: 'mediaDrawer',
    items: [item('drawerPrevious', 'ArrowLeft'), item('drawerNext', 'ArrowRight'), item('drawerClose', 'Escape')],
  },
  { id: 'mediaFocal', items: [item('focalMove', 'ArrowRight'), item('focalMoveBig', 'Shift+ArrowRight')] },
  {
    id: 'tree',
    items: [item('treeExpand', 'ArrowRight'), item('treeCollapse', 'ArrowLeft'), item('treeRename', 'F2')],
  },
];

/** The shortcuts of what is open (they come first and are labelled as such). */
export function screenShortcuts(view: SampleView): SheetGroup[] {
  if (view === 'editor' || view === 'record' || view === 'template' || view === 'dataset') {
    return [
      {
        id: 'editing',
        items: [
          item('refreshPreview', 'Mod+Enter'),
          item('moveSectionUp', 'Alt+ArrowUp'),
          item('moveSectionDown', 'Alt+ArrowDown'),
        ],
      },
    ];
  }
  if (view === 'media') {
    return [...MEDIA_SHORTCUTS];
  }
  const lists: SheetGroup = {
    id: 'lists',
    items: [
      item('rowMove', 'ArrowUp'),
      item('rowSelect', 'Space'),
      item('rowExtend', 'Shift+ArrowDown'),
      item('rowAll', 'Mod+A'),
      item('rowOpen', 'Enter'),
    ],
  };
  const tree: SheetGroup = {
    id: 'tree',
    items: [item('treeExpand', 'ArrowRight'), item('treeCollapse', 'ArrowLeft'), item('treeRename', 'F2'), item('treeReorder', 'Alt+ArrowUp')],
  };
  return view === 'folder' || view === 'contentfolder' || view === 'recordset' ? [lists, tree] : [lists];
}

/** The shortcuts that work everywhere, grouped. */
export const GLOBAL_SHORTCUTS: readonly SheetGroup[] = [
  {
    id: 'general',
    items: [
      item('palette', 'Mod+K'),
      item('sheet', '?'),
      item('save', 'Mod+S'),
      item('history', 'Alt+H'),
      item('rail', '['),
      item('filter', '/'),
      item('create', 'n'),
      item('close', 'Escape'),
    ],
  },
  {
    id: 'goTo',
    items: [
      item('goHome', 'g h'),
      item('goPages', 'g p'),
      item('goMedia', 'g m'),
      item('goContent', 'g c'),
      item('goNavigation', 'g n'),
      item('goGlobals', 'g l'),
      item('goTemplates', 'g t'),
      item('goChanges', 'g x'),
      item('goPublishing', 'g b'),
      item('goSchedules', 'g s'),
      item('goSettings', 'g ,'),
    ],
  },
  { id: 'publishing', items: [item('release', 'Alt+Shift+R'), item('build', 'Alt+Shift+B')] },
];
