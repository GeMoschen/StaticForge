/**
 * The shape of the user's preference document (M35.3). Plain interfaces by design: the wire format is a free-form JSON
 * object the server only caps and versions, so the client owns the typing.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type DensityPreference = 'compact' | 'comfortable';
export type PreviewViewPreference = 'draft' | 'published';

/** One entry of a project's "recently opened" list. */
export interface RecentEntry {
  kind: string;
  uuid: string;
  title?: string;
  /** ISO-8601 instant of the visit. */
  at: string;
}

/** A favourite, same shape as a recent (without needing a visit time). */
export interface FavoriteEntry {
  kind: string;
  uuid: string;
  title?: string;
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

export interface PreferencesDocument {
  schemaVersion: number;
  theme?: ThemePreference;
  density?: DensityPreference;
  developerMode?: boolean;
  railCollapsed?: boolean;
  /** Pane sizes (px or ratio, as the pane defines) by pane id. */
  paneSizes?: Record<string, number>;
  previewView?: PreviewViewPreference;
  issueScopes?: string[];
  projects?: Record<string, ProjectPreferences>;
}

export const DEFAULT_THEME: ThemePreference = 'system';
export const DEFAULT_DENSITY: DensityPreference = 'comfortable';
export const DEFAULT_PREVIEW_VIEW: PreviewViewPreference = 'draft';
export const RECENTS_CAP = 20;
export const PREFERENCES_SCHEMA_VERSION = 1;

/** A JSON merge patch (RFC 7386): `null` deletes a key, objects merge recursively, anything else replaces. */
export type MergePatch = { [key: string]: unknown };
