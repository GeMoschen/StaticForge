/**
 * Fake data of the sample's Settings area (M35.9 decision 31): the project, its languages and channels, the stores
 * offered for export and the conflicts of a fake import archive. Names and paths are content, so they live here as
 * TypeScript data; the chrome texts are `styleguide.sample.settings.*` keys.
 */

/** The Settings sub-pages (the side nav; query parameter `ssec`). */
export type SettingsSection =
  | 'general'
  | 'languages'
  | 'channels'
  | 'media'
  | 'highlighting'
  | 'compaction'
  | 'importexport'
  | 'members';
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'general',
  'languages',
  'channels',
  'media',
  'highlighting',
  'compaction',
  'importexport',
  'members',
];
/** The side nav's groups (decision 32). */
export type SettingsGroup = 'project' | 'maintenance' | 'people';
export const SECTION_GROUPS: Readonly<Record<SettingsSection, SettingsGroup>> = {
  general: 'project',
  languages: 'project',
  channels: 'project',
  media: 'project',
  highlighting: 'project',
  compaction: 'maintenance',
  importexport: 'maintenance',
  members: 'people',
};
export const SECTION_ICONS: Readonly<Record<SettingsSection, string>> = {
  general: 'tune',
  languages: 'translate',
  channels: 'output',
  media: 'perm_media',
  highlighting: 'code',
  compaction: 'compress',
  importexport: 'import_export',
  members: 'group',
};
/** Listed in the menu but not built in the sample (decision 31). */
export const UNBUILT_SECTIONS: readonly SettingsSection[] = ['media', 'highlighting', 'compaction', 'members'];
/** Developer mode only (README decision 7). */
export const DEV_ONLY_SECTIONS: readonly SettingsSection[] = ['channels'];

/** The export steps (query parameter `istep`). */
export type ExportStep = 'select' | 'options' | 'run' | 'result';
export const EXPORT_STEPS: readonly ExportStep[] = ['select', 'options', 'run', 'result'];
export type TransferTab = 'export' | 'import';
export const TRANSFER_TABS: readonly TransferTab[] = ['export', 'import'];

// ── General ──────────────────────────────────────────────────────────────────

export const PROJECT_KEY = 'nordlicht-roastery';

export interface GeneralForm {
  readonly name: string;
  readonly description: string;
  readonly defaultEditingLanguage: string;
}

export const GENERAL: GeneralForm = {
  name: 'Nordlicht Roastery',
  description: 'Website of the Nordlicht coffee roastery: shop pages, the coffee journal and the café menu.',
  defaultEditingLanguage: 'en',
};

// ── Languages ────────────────────────────────────────────────────────────────

export interface SettingsLanguage {
  readonly code: string;
  readonly label: string;
  /** Language codes, in order. */
  readonly fallbacks: readonly string[];
  readonly isDefault: boolean;
  /** Pages of this language are served without the `/code` prefix. */
  readonly withoutPrefix: boolean;
  readonly pages: number;
}

export const LANGUAGES: readonly SettingsLanguage[] = [
  { code: 'en', label: 'English', fallbacks: [], isDefault: true, withoutPrefix: true, pages: 48 },
  { code: 'de', label: 'Deutsch', fallbacks: ['en'], isDefault: false, withoutPrefix: false, pages: 46 },
  { code: 'fr', label: 'Français', fallbacks: ['en', 'de'], isDefault: false, withoutPrefix: false, pages: 12 },
];

/** The codes offered by the language picker (the real list is the backend's ISO table). */
export const LANGUAGE_CHOICES: readonly { readonly code: string; readonly label: string }[] = [
  { code: 'da', label: 'Dansk' },
  { code: 'de', label: 'Deutsch' },
  { code: 'de-CH', label: 'Deutsch (Schweiz)' },
  { code: 'en', label: 'English' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'sv', label: 'Svenska' },
];

// ── Channels ─────────────────────────────────────────────────────────────────

export type HighlightLanguage = 'html' | 'xml' | 'json' | 'css' | 'text';
export const HIGHLIGHT_LANGUAGES: readonly HighlightLanguage[] = ['html', 'xml', 'json', 'css', 'text'];

export interface SettingsChannel {
  readonly key: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly outputFolder: string;
  readonly extension: string;
  readonly highlightAs: HighlightLanguage;
}

export const CHANNELS: readonly SettingsChannel[] = [
  { key: 'html', name: 'Website', enabled: true, outputFolder: '/', extension: 'html', highlightAs: 'html' },
  { key: 'rss', name: 'Journal feed', enabled: true, outputFolder: '/feeds', extension: 'xml', highlightAs: 'xml' },
  { key: 'json', name: 'Shop API', enabled: false, outputFolder: '/api', extension: 'json', highlightAs: 'json' },
];

// ── Export ───────────────────────────────────────────────────────────────────

/** A store of the export tree; `unit` names what its leaves count as (pages, files, records, …). */
export type ExportStore = 'pages' | 'media' | 'content' | 'templates' | 'globals';

/** One node of the export selection tree: stores at the top, then folders; `count` = the items a leaf stands for. */
export interface ExportNode {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly store: ExportStore;
  readonly count?: number;
  readonly children?: readonly ExportNode[];
}

const leaf = (store: ExportStore, id: string, name: string, count: number, icon = 'folder'): ExportNode => ({
  id,
  name,
  icon,
  store,
  count,
});

/** The store names (never "/ ROOT", M35.25) come from the chrome keys; the folders are content. */
export const EXPORT_TREE: readonly ExportNode[] = [
  {
    id: 'pages',
    name: '',
    icon: 'description',
    store: 'pages',
    children: [
      leaf('pages', 'pages/shop', 'Shop', 18),
      leaf('pages', 'pages/journal', 'Journal', 21),
      leaf('pages', 'pages/cafe', 'Café', 6),
      leaf('pages', 'pages/about', 'About us', 3),
    ],
  },
  {
    id: 'media',
    name: '',
    icon: 'perm_media',
    store: 'media',
    children: [
      leaf('media', 'media/products', 'Products', 64),
      leaf('media', 'media/journal', 'Journal', 41),
      leaf('media', 'media/brand', 'Brand', 13),
    ],
  },
  {
    id: 'content',
    name: '',
    icon: 'dataset',
    store: 'content',
    children: [leaf('content', 'content/coffees', 'Coffees', 24), leaf('content', 'content/events', 'Events', 9)],
  },
  {
    id: 'templates',
    name: '',
    icon: 'code_blocks',
    store: 'templates',
    children: [
      leaf('templates', 'templates/pages', 'Page templates', 5),
      leaf('templates', 'templates/sections', 'Section templates', 11),
      leaf('templates', 'templates/datasets', 'Datasets', 3),
    ],
  },
  {
    id: 'globals',
    name: '',
    icon: 'public',
    store: 'globals',
    children: [leaf('globals', 'globals/site', 'Site settings', 1, 'settings'), leaf('globals', 'globals/shop', 'Shop settings', 1, 'settings')],
  },
];

/** Pre-ticked in the sample: the whole Pages store and the product images. */
export const INITIAL_EXPORT_SELECTION: readonly string[] = [
  'pages/shop',
  'pages/journal',
  'pages/cafe',
  'pages/about',
  'media/products',
];

export function exportLeaves(node: ExportNode): readonly ExportNode[] {
  return node.children ? node.children.flatMap(exportLeaves) : [node];
}

/** Items per store of the ticked leaves. */
export function exportCounts(selected: ReadonlySet<string>): ReadonlyMap<ExportStore, number> {
  const counts = new Map<ExportStore, number>();
  for (const store of EXPORT_TREE) {
    const n = exportLeaves(store)
      .filter((l) => selected.has(l.id))
      .reduce((sum, l) => sum + (l.count ?? 0), 0);
    if (n > 0) {
      counts.set(store.store, n);
    }
  }
  return counts;
}

/** The scripted export run (`istep=run`) and its result. */
export const EXPORT_RUN_PROGRESS = 58;
export const EXPORT_ARCHIVE_NAME = 'nordlicht-roastery-export-2026-10-01.zip';
export const EXPORT_ARCHIVE_SIZE = 18_400_000;

// ── Import ───────────────────────────────────────────────────────────────────

export const IMPORT_ARCHIVE_NAME = 'nordlicht-roastery-export-2026-09-28.zip';
export const IMPORT_ARCHIVE_ITEMS = 164;

export type ConflictChoice = 'keep' | 'replace' | 'skip';
export const CONFLICT_CHOICES: readonly ConflictChoice[] = ['keep', 'replace', 'skip'];
export type ConflictReason = 'newer' | 'older' | 'changed' | 'type';
export type ReleaseMode = 'keep' | 'draft';

export interface ImportConflict {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly store: ExportStore;
  readonly reason: ConflictReason;
  readonly choice: ConflictChoice;
}

export const IMPORT_CONFLICTS: readonly ImportConflict[] = [
  { id: 'c1', name: 'Spring harvest arrives', path: 'Journal › 2026', store: 'pages', reason: 'newer', choice: 'keep' },
  { id: 'c2', name: 'Ethiopia Yirgacheffe', path: 'Shop › Coffees', store: 'pages', reason: 'older', choice: 'replace' },
  { id: 'c3', name: 'hero-spring.jpg', path: 'Journal', store: 'media', reason: 'changed', choice: 'keep' },
  { id: 'c4', name: 'Product teaser', path: 'Section templates', store: 'templates', reason: 'changed', choice: 'replace' },
  { id: 'c5', name: 'Site settings', path: '', store: 'globals', reason: 'type', choice: 'skip' },
];
