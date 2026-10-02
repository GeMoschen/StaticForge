/** What the app frame is wrapped around: the project list, one project, administration or the user's account. */
export type FrameKind = 'dashboard' | 'project' | 'admin' | 'account' | 'other';

export interface FrameLocation {
  kind: FrameKind;
  /** The open project's key (`kind === 'project'`). */
  projectKey: string | null;
  /** The area: a project's `pages`, `media`, `settings`, … (`null` at the project root and outside a project). */
  section: string | null;
  /** The part of `publishing`, `settings` or `admin` that is open (`runs`, `general`, `users`, …). */
  sub: string | null;
}

/** The project areas that have a label (`frame.section.<id>`). */
export const PROJECT_SECTIONS: readonly string[] = [
  'pages',
  'content',
  'media',
  'navigation',
  'globals',
  'templates',
  'search',
  'changes',
  'schedules',
  'publishing',
  'history',
  'settings',
];

/** Project areas with a sub-page of their own; the other areas treat what follows as the open item. */
const SECTIONS_WITH_SUB = new Set(['publishing', 'settings']);

/** The sub-pages that have a label (and so a breadcrumb segment). */
export const KNOWN_SUBS: Readonly<Record<string, readonly string[]>> = {
  publishing: ['runs', 'targets', 'policy', 'quality', 'redirects', 'urls'],
  settings: ['general', 'languages', 'channels', 'media', 'code-highlighting', 'compaction', 'import-export', 'members'],
  admin: ['users', 'projects', 'jobs', 'audit'],
};

const NONE: FrameLocation = { kind: 'other', projectKey: null, section: null, sub: null };

/** Reads the frame's location from a router URL (query and fragment are ignored). Pure. */
export function parseFrameLocation(url: string): FrameLocation {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const [first, second, third, fourth] = segments;
  if (first === undefined) {
    return { kind: 'dashboard', projectKey: null, section: null, sub: null };
  }
  if (first === 'p' && second !== undefined) {
    const section = third ?? null;
    const sub = section !== null && SECTIONS_WITH_SUB.has(section) ? (fourth ?? null) : null;
    return { kind: 'project', projectKey: second, section, sub };
  }
  if (first === 'admin') {
    return { kind: 'admin', projectKey: null, section: 'admin', sub: second ?? null };
  }
  if (first === 'account') {
    return { kind: 'account', projectKey: null, section: 'account', sub: null };
  }
  return NONE;
}
