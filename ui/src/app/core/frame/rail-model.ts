import type { FrameLocation } from './frame-location';

export interface RailItem {
  id: string;
  icon: string;
  /** Router commands, relative to the project (`['pages']`) or absolute (`['/admin', 'users']`). */
  route: readonly string[];
  /** The item shows the unreleased-changes count. */
  badge?: 'changes';
}

export interface RailGroup {
  id: string;
  items: readonly RailItem[];
}

export interface RailInput {
  location: FrameLocation;
  /** Developer mode is on (which implies developer rights). */
  developerMode: boolean;
}

const HOME: RailGroup = { id: 'home', items: [{ id: 'home', icon: 'home', route: [] }] };

const CONTENT: RailGroup = {
  id: 'content',
  items: [
    { id: 'pages', icon: 'account_tree', route: ['pages'] },
    { id: 'media', icon: 'photo_library', route: ['media'] },
    { id: 'content', icon: 'dataset', route: ['content'] },
    { id: 'navigation', icon: 'menu_open', route: ['navigation'] },
    { id: 'globals', icon: 'tune', route: ['globals'] },
  ],
};

const PUBLISH: RailGroup = {
  id: 'publish',
  items: [
    { id: 'changes', icon: 'difference', route: ['changes'], badge: 'changes' },
    // Publishing is a screen of its own from M35.11; until then it is the Generation page of Settings.
    { id: 'publishing', icon: 'rocket_launch', route: ['settings', 'generation'] },
    { id: 'schedules', icon: 'event_upcoming', route: ['schedules'] },
  ],
};

const DEVELOP: RailGroup = {
  id: 'develop',
  items: [{ id: 'templates', icon: 'code_blocks', route: ['templates'] }],
};

const ADMIN: RailGroup = {
  id: 'admin',
  items: [
    { id: 'users', icon: 'group', route: ['/admin', 'users'] },
    { id: 'projects', icon: 'folder_managed', route: ['/admin', 'projects'] },
    { id: 'jobs', icon: 'work_history', route: ['/admin', 'jobs'] },
    { id: 'audit', icon: 'fact_check', route: ['/admin', 'audit'] },
  ],
};

/** Settings sits in the rail's footer. */
export const SETTINGS_ITEM: RailItem = { id: 'settings', icon: 'settings', route: ['settings'] };

/**
 * The rail's groups for a location — the visibility matrix (M35.10): everyone who can open the project sees Home,
 * Content and Publish (what they may *do* inside is decided by the screens, from the effective permissions); Develop
 * (Templates) needs developer mode, which only developers and admins can have. Administration shows its own sections.
 * Outside a project and administration (project list, account) there is no rail. Pure.
 */
export function railGroups({ location, developerMode }: RailInput): RailGroup[] {
  if (location.kind === 'admin') {
    return [ADMIN];
  }
  if (location.kind !== 'project') {
    return [];
  }
  return [HOME, CONTENT, PUBLISH, ...(developerMode ? [DEVELOP] : [])];
}

/** Whether the rail has a footer item (Settings) for a location. */
export function hasSettings(location: FrameLocation): boolean {
  return location.kind === 'project';
}

/** The rail item a location belongs to (`null` when none, e.g. the project root before it redirects). */
export function activeRailItem(location: FrameLocation): string | null {
  if (location.kind === 'admin') {
    return location.sub;
  }
  if (location.kind !== 'project') {
    return null;
  }
  if (location.section === null) {
    return 'home';
  }
  if (location.section === 'settings' && location.sub === 'generation') {
    return 'publishing';
  }
  // The search page is reached from the top bar and belongs to no rail item.
  return location.section === 'search' ? null : location.section;
}
