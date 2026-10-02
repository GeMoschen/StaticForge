/**
 * The shape of the user's preference document (M35.3). Plain interfaces by design: the wire format is a free-form JSON
 * object the server only caps and versions, so the client owns the typing.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type DensityPreference = 'compact' | 'comfortable';
export type PreviewViewPreference = 'draft' | 'published';

/** One entry of a project's "recently opened" list. */
export interface RecentEntry {
  /** The asset type (`PAGE`, `RECORD`, `FOLDER`, …). */
  kind: string;
  uuid: string;
  title?: string;
  /** Where it lives in its store (`/pages_root/news/`); tells a folder which store to open in. */
  folderPath?: string;
  /** ISO-8601 instant of the visit. */
  at: string;
}

/** A favourite, same shape as a recent (without needing a visit time). */
export interface FavoriteEntry {
  kind: string;
  uuid: string;
  title?: string;
  folderPath?: string;
}

/** What is remembered per project (keyed by project key under `projects`). */
export interface ProjectPreferences {
  /** Expanded node ids per tree id. */
  treeExpansion?: Record<string, string[]>;
  recents?: RecentEntry[];
  favorites?: FavoriteEntry[];
  editingLocale?: string;
  /** Hidden record-grid columns per dataset uuid. */
  gridColumns?: Record<string, string[]>;
}

/** The column layout of one data table (`sf-data-table` with a `tableId`); every part is optional. */
export interface TableColumnsPreference {
  /** Column ids in display order (columns missing here follow in their definition order). */
  order?: string[];
  /** Ids of the hidden columns. */
  hidden?: string[];
  /** Column widths in px by column id. */
  widths?: Record<string, number>;
}

export interface PreferencesDocument {
  schemaVersion: number;
  theme?: ThemePreference;
  density?: DensityPreference;
  developerMode?: boolean;
  railCollapsed?: boolean;
  /** Project keys the user starred in the project switcher. */
  favoriteProjects?: string[];
  /** Project keys opened last, newest first. */
  recentProjects?: string[];
  /** Pane sizes (px or ratio, as the pane defines) by pane id. */
  paneSizes?: Record<string, number>;
  previewView?: PreviewViewPreference;
  issueScopes?: string[];
  /** Column layouts by table id (instance-wide: a table looks the same in every project). */
  tableColumns?: Record<string, TableColumnsPreference>;
  projects?: Record<string, ProjectPreferences>;
}

export const DEFAULT_THEME: ThemePreference = 'system';
export const DEFAULT_DENSITY: DensityPreference = 'compact';
export const DEFAULT_PREVIEW_VIEW: PreviewViewPreference = 'draft';
export const RECENTS_CAP = 20;
export const RECENT_PROJECTS_CAP = 5;
export const PREFERENCES_SCHEMA_VERSION = 1;

/** A JSON merge patch (RFC 7386): `null` deletes a key, objects merge recursively, anything else replaces. */
export type MergePatch = { [key: string]: unknown };
