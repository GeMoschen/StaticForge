/** One entry of an area's side menu (`sf-side-nav`); the label is `frame.sub.<area>.<id>`. */
export interface AreaNavEntry {
  id: string;
  icon: string;
  /** The heading it is listed under (`frame.sidenav.group.<group>`); consecutive entries share one. */
  group?: 'project' | 'maintenance' | 'people' | 'checks';
}

/** The areas that have a side menu; the id after the area in the URL is the entry. */
export type NavArea = 'publishing' | 'settings';

/** What decides which entries show. */
export interface AreaNavInput {
  /** Developer mode is on in this project (which implies developer rights). */
  developerMode: boolean;
  /** The user administers the project (reads the compaction policy). */
  projectAdmin: boolean;
}

/** Publishing (M35.9 decisions 27–30): the runs, where they go and how, and the checks on what they produce. */
const PUBLISHING: readonly AreaNavEntry[] = [
  { id: 'runs', icon: 'history' },
  { id: 'targets', icon: 'dns' },
  { id: 'policy', icon: 'admin_panel_settings' },
  { id: 'quality', icon: 'rule', group: 'checks' },
  { id: 'redirects', icon: 'alt_route', group: 'checks' },
  { id: 'urls', icon: 'link', group: 'checks' },
];

/** Settings (M35.9 decision 32): PROJECT, MAINTENANCE, PEOPLE. */
const SETTINGS: readonly AreaNavEntry[] = [
  { id: 'general', icon: 'tune', group: 'project' },
  { id: 'languages', icon: 'translate', group: 'project' },
  { id: 'channels', icon: 'output', group: 'project' },
  { id: 'media', icon: 'perm_media', group: 'project' },
  { id: 'code-highlighting', icon: 'code', group: 'project' },
  { id: 'compaction', icon: 'compress', group: 'maintenance' },
  { id: 'import-export', icon: 'import_export', group: 'maintenance' },
  { id: 'members', icon: 'group', group: 'people' },
];

/** Settings pages shown in developer mode only (README decision 7, M35.9 decision 31). */
export const DEVELOPER_ONLY_SETTINGS: readonly string[] = ['channels'];

/** Settings pages only project admins can use. */
export const ADMIN_ONLY_SETTINGS: readonly string[] = ['compaction'];

/** The entries of an area's side menu for what the user may see. Pure. */
export function areaNav(area: NavArea, { developerMode, projectAdmin }: AreaNavInput): AreaNavEntry[] {
  if (area === 'publishing') {
    return [...PUBLISHING];
  }
  return SETTINGS.filter(
    (entry) =>
      (developerMode || !DEVELOPER_ONLY_SETTINGS.includes(entry.id)) && (projectAdmin || !ADMIN_ONLY_SETTINGS.includes(entry.id)),
  );
}
