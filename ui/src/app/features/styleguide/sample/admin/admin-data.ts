import { oneOf } from '../changes/sample-area.util';

// ── Roles, statuses ──────────────────────────────────────────────────────────

/** The instance role of a user: shown as "Instance admin" / "User", never the enum. */
export type AdminSystemRole = 'admin' | 'user';
export const SYSTEM_ROLES: readonly AdminSystemRole[] = ['admin', 'user'];

/** The role in a project, from the least to the most rights; shown as "Viewer" … "Project admin". */
export type AdminProjectRole = 'viewer' | 'editor' | 'releaser' | 'developer' | 'admin';
export const PROJECT_ROLES: readonly AdminProjectRole[] = ['viewer', 'editor', 'releaser', 'developer', 'admin'];

export type AdminUserStatus = 'active' | 'disabled' | 'locked' | 'deleted';
export const USER_STATUSES: readonly AdminUserStatus[] = ['active', 'disabled', 'locked', 'deleted'];

export const STATUS_TONES = {
  active: 'success',
  disabled: 'neutral',
  locked: 'warning',
  deleted: 'danger',
} as const satisfies Record<AdminUserStatus, string>;

export const STATUS_ICONS: Readonly<Record<AdminUserStatus, string>> = {
  active: 'check_circle',
  disabled: 'block',
  locked: 'lock',
  deleted: 'delete',
};

// ── Users ────────────────────────────────────────────────────────────────────

export interface AdminMembership {
  readonly project: string;
  readonly role: AdminProjectRole;
}

export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: AdminSystemRole;
  readonly status: AdminUserStatus;
  /** Minutes since the last sign-in; `null` = never. */
  readonly lastSignInMinutes: number | null;
  /** Created this many days ago. */
  readonly createdDays: number;
  /** The user must choose a new password at the next sign-in. */
  readonly passwordPending: boolean;
  readonly memberships: readonly AdminMembership[];
}

const DAY = 1440;

function user(
  id: string,
  displayName: string,
  role: AdminSystemRole,
  status: AdminUserStatus,
  lastSignInMinutes: number | null,
  createdDays: number,
  memberships: readonly AdminMembership[],
  passwordPending = false,
): AdminUser {
  const username = id.replace(/^u-/, '');
  return { id, username, displayName, email: `${username}@example.com`, role, status, lastSignInMinutes, createdDays, passwordPending, memberships };
}

export const ADMIN_USERS: readonly AdminUser[] = [
  user('u-ada', 'Ada Lovelace', 'admin', 'active', 12, 640, [{ project: 'lumen', role: 'admin' }, { project: 'harbor', role: 'admin' }, { project: 'atlas', role: 'developer' }]),
  user('u-anna', 'Anna Berger', 'user', 'active', 25, 410, [{ project: 'lumen', role: 'editor' }, { project: 'harbor', role: 'releaser' }]),
  user('u-jonas', 'Jonas Weber', 'user', 'active', 3 * 60, 380, [{ project: 'lumen', role: 'developer' }, { project: 'atlas', role: 'editor' }]),
  user('u-mira', 'Mira Okafor', 'user', 'active', DAY + 90, 300, [{ project: 'lumen', role: 'releaser' }]),
  user('u-lukas', 'Lukas Brandt', 'user', 'active', 4 * DAY, 220, [{ project: 'harbor', role: 'editor' }, { project: 'atlas', role: 'viewer' }]),
  user('u-sofia', 'Sofia Marquez', 'user', 'active', 9 * DAY, 190, [{ project: 'lumen', role: 'editor' }]),
  user('u-noah', 'Noah Fischer', 'user', 'disabled', 41 * DAY, 500, [{ project: 'harbor', role: 'viewer' }]),
  user('u-lena', 'Lena Hoffmann', 'user', 'locked', 2 * DAY, 160, [{ project: 'atlas', role: 'editor' }]),
  user('u-ravi', 'Ravi Patel', 'user', 'active', null, 2, [{ project: 'harbor', role: 'editor' }], true),
  user('u-chloe', 'Chloé Martin', 'user', 'active', 6 * 60, 120, [{ project: 'lumen', role: 'viewer' }, { project: 'harbor', role: 'viewer' }]),
  user('u-omar', 'Omar Haddad', 'admin', 'active', 2 * DAY + 300, 700, [{ project: 'atlas', role: 'admin' }]),
  user('u-ines', 'Inès Costa', 'user', 'active', 15 * DAY, 90, []),
  user('u-tom', 'Tom Becker', 'user', 'deleted', 120 * DAY, 800, []),
  user('u-yuki', 'Yuki Tanaka', 'user', 'active', 5 * DAY, 60, [{ project: 'atlas', role: 'releaser' }]),
];

export function userById(id: string | null): AdminUser | null {
  return id === null ? null : (ADMIN_USERS.find((u) => u.id === id) ?? null);
}

/** `ufilter=q:ada,status:active,role:admin,deleted:1` ⇄ the Users filters. */
export interface UserFilters {
  readonly q: string;
  readonly status: AdminUserStatus | null;
  readonly role: AdminSystemRole | null;
  readonly deleted: boolean;
}

export const NO_USER_FILTERS: UserFilters = { q: '', status: null, role: null, deleted: false };

export function parseUserFilter(value: string | null): UserFilters {
  const f = { ...NO_USER_FILTERS } as { -readonly [K in keyof UserFilters]: UserFilters[K] };
  for (const [key, val] of pairs(value)) {
    if (key === 'q') {
      f.q = val;
    } else if (key === 'status') {
      f.status = oneOf(val, USER_STATUSES);
    } else if (key === 'role') {
      f.role = oneOf(val, SYSTEM_ROLES);
    } else if (key === 'deleted') {
      f.deleted = val === '1';
    }
  }
  return f;
}

export function formatUserFilter(f: UserFilters): string | null {
  const parts = [f.q.trim() ? `q:${clean(f.q)}` : '', f.status ? `status:${f.status}` : '', f.role ? `role:${f.role}` : '', f.deleted ? 'deleted:1' : ''];
  return join(parts);
}

export function filterUsers(users: readonly AdminUser[], f: UserFilters): AdminUser[] {
  const q = f.q.trim().toLowerCase();
  return users.filter(
    (u) =>
      (f.deleted || u.status !== 'deleted' || f.status === 'deleted') &&
      (!f.status || u.status === f.status) &&
      (!f.role || u.role === f.role) &&
      (!q || [u.displayName, u.username, u.email].some((text) => text.toLowerCase().includes(q))),
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface AdminProject {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly lastChangeMinutes: number | null;
  readonly revision: number | null;
  readonly archived: boolean;
}

export const ADMIN_PROJECTS: readonly AdminProject[] = [
  { key: 'lumen', name: 'Lumen Coffee', description: 'Roastery site and shop', lastChangeMinutes: 25, revision: 142, archived: false },
  { key: 'harbor', name: 'Harbor Hotel', description: 'Rooms, restaurant and events', lastChangeMinutes: 3 * 60, revision: 88, archived: false },
  { key: 'atlas', name: 'Atlas Docs', description: 'Product documentation', lastChangeMinutes: 2 * DAY, revision: 310, archived: false },
  { key: 'demo', name: 'Demo site', description: 'Sandbox for trying things out', lastChangeMinutes: 12 * DAY, revision: 17, archived: false },
  { key: 'nordic', name: 'Nordic Bikes', description: 'Campaign microsite', lastChangeMinutes: 95 * DAY, revision: 64, archived: true },
  { key: 'oldblog', name: 'Old blog', description: 'Replaced by the Lumen journal', lastChangeMinutes: 400 * DAY, revision: 9, archived: true },
];

export function projectByKey(key: string): AdminProject | undefined {
  return ADMIN_PROJECTS.find((p) => p.key === key);
}

/** How many users are members of the project. */
export function memberCount(key: string, users: readonly AdminUser[] = ADMIN_USERS): number {
  return users.filter((u) => u.status !== 'deleted' && u.memberships.some((m) => m.project === key)).length;
}

/** `pfilter=q:coffee,archived:1` ⇄ the Projects filters. */
export interface ProjectFilters {
  readonly q: string;
  readonly archived: boolean;
}

export const NO_PROJECT_FILTERS: ProjectFilters = { q: '', archived: false };

export function parseProjectFilter(value: string | null): ProjectFilters {
  const f = { ...NO_PROJECT_FILTERS } as { -readonly [K in keyof ProjectFilters]: ProjectFilters[K] };
  for (const [key, val] of pairs(value)) {
    if (key === 'q') {
      f.q = val;
    } else if (key === 'archived') {
      f.archived = val === '1';
    }
  }
  return f;
}

export function formatProjectFilter(f: ProjectFilters): string | null {
  return join([f.q.trim() ? `q:${clean(f.q)}` : '', f.archived ? 'archived:1' : '']);
}

export function filterProjects(projects: readonly AdminProject[], archivedKeys: ReadonlySet<string>, f: ProjectFilters): AdminProject[] {
  const q = f.q.trim().toLowerCase();
  return projects.filter(
    (p) =>
      (f.archived || !archivedKeys.has(p.key)) && (!q || [p.name, p.key, p.description].some((text) => text.toLowerCase().includes(q))),
  );
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export type JobOutcome = 'succeeded' | 'partly' | 'failed' | 'skipped';
export const JOB_OUTCOMES: readonly JobOutcome[] = ['succeeded', 'partly', 'failed', 'skipped'];
export const OUTCOME_TONES = { succeeded: 'success', partly: 'warning', failed: 'danger', skipped: 'neutral' } as const satisfies Record<JobOutcome, string>;
export const OUTCOME_ICONS: Readonly<Record<JobOutcome, string>> = {
  succeeded: 'check_circle',
  partly: 'warning',
  failed: 'error',
  skipped: 'skip_next',
};

export type JobFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';
export const JOB_FREQUENCIES: readonly JobFrequency[] = ['hourly', 'daily', 'weekly', 'monthly'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A job's schedule as the form edits it; the cron expression is derived. */
export interface JobSchedule {
  readonly frequency: JobFrequency;
  /** `HH:MM` (daily, weekly, monthly); hourly runs at this minute. */
  readonly time: string;
  readonly weekday: Weekday;
  readonly zone: string;
}

export interface AdminJob {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  /** The code of the job is gone: only its history remains. */
  readonly orphaned: boolean;
  readonly schedule: JobSchedule;
  /** Minutes until the next run. */
  readonly nextMinutes: number;
  readonly lastRun: { readonly outcome: JobOutcome; readonly minutes: number; readonly dryRun: boolean } | null;
}

export const ADMIN_JOBS: readonly AdminJob[] = [
  {
    key: 'blob-sweep',
    name: 'Clean up unused files',
    description: 'Removes uploaded files that no page or record uses any more.',
    enabled: true,
    orphaned: false,
    schedule: { frequency: 'daily', time: '03:00', weekday: 'mon', zone: 'Europe/Berlin' },
    nextMinutes: 9 * 60 + 12,
    lastRun: { outcome: 'succeeded', minutes: 14 * 60 + 48, dryRun: false },
  },
  {
    key: 'history-compaction',
    name: 'Compact old history',
    description: 'Merges old revisions of an asset so the history stays small.',
    enabled: true,
    orphaned: false,
    schedule: { frequency: 'weekly', time: '02:30', weekday: 'sun', zone: 'Europe/Berlin' },
    nextMinutes: 2 * DAY + 4 * 60,
    lastRun: { outcome: 'partly', minutes: 5 * DAY + 3 * 60, dryRun: false },
  },
  {
    key: 'search-reindex',
    name: 'Rebuild the search index',
    description: 'Reads every page, record and file again so search finds the latest text.',
    enabled: false,
    orphaned: false,
    schedule: { frequency: 'weekly', time: '04:00', weekday: 'sat', zone: 'UTC' },
    nextMinutes: 0,
    lastRun: { outcome: 'skipped', minutes: 8 * DAY, dryRun: false },
  },
  {
    key: 'link-check',
    name: 'Check links of released pages',
    description: 'Follows every link of the last build and lists the ones that no longer work.',
    enabled: true,
    orphaned: false,
    schedule: { frequency: 'monthly', time: '05:00', weekday: 'mon', zone: 'Europe/Berlin' },
    nextMinutes: 11 * DAY,
    lastRun: { outcome: 'failed', minutes: 19 * DAY, dryRun: true },
  },
  {
    key: 'session-expiry',
    name: 'Remove expired sessions',
    description: 'Deletes sign-in sessions that ran out.',
    enabled: true,
    orphaned: false,
    schedule: { frequency: 'hourly', time: '00:15', weekday: 'mon', zone: 'UTC' },
    nextMinutes: 41,
    lastRun: { outcome: 'succeeded', minutes: 19, dryRun: false },
  },
  {
    key: 'legacy-export',
    name: 'Nightly export (legacy)',
    description: 'Exported every project to a folder.',
    enabled: false,
    orphaned: true,
    schedule: { frequency: 'daily', time: '01:00', weekday: 'mon', zone: 'Europe/Berlin' },
    nextMinutes: 0,
    lastRun: { outcome: 'succeeded', minutes: 62 * DAY, dryRun: false },
  },
];

export function jobByKey(key: string | null): AdminJob | null {
  return key === null ? null : (ADMIN_JOBS.find((j) => j.key === key) ?? null);
}

/** The cron expression of a schedule (a tooltip and a developer-mode detail; people read the human text). */
export function cronOf(s: JobSchedule): string {
  const [hour, minute] = s.time.split(':').map(Number);
  switch (s.frequency) {
    case 'hourly':
      return `${minute ?? 0} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${WEEKDAYS.indexOf(s.weekday) + 1}`;
    default:
      return `${minute} ${hour} 1 * *`;
  }
}

export interface JobRun {
  readonly id: string;
  readonly minutes: number;
  readonly trigger: 'schedule' | 'manual';
  readonly dryRun: boolean;
  readonly outcome: JobOutcome;
  readonly durationSeconds: number;
  readonly affected: number;
  readonly freedMb: number;
  /** The user who started a manual run. */
  readonly by: string | null;
  readonly summary: readonly { readonly key: string; readonly count: number }[];
}

/** A deterministic run history for a job (newest first). */
export function runsOf(job: AdminJob): JobRun[] {
  const seed = [...job.key].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const outcomes: JobOutcome[] = ['succeeded', 'succeeded', 'partly', 'succeeded', 'failed', 'succeeded', 'skipped', 'succeeded'];
  const step = job.schedule.frequency === 'hourly' ? 60 : job.schedule.frequency === 'daily' ? DAY : job.schedule.frequency === 'weekly' ? 7 * DAY : 30 * DAY;
  const first = job.lastRun?.minutes ?? step;
  return Array.from({ length: 14 }, (_, i) => {
    const manual = i % 5 === 3;
    const outcome = i === 0 && job.lastRun ? job.lastRun.outcome : outcomes[(i + seed) % outcomes.length];
    return {
      id: `${job.key}-${i}`,
      minutes: first + i * step + (i % 3) * 7,
      trigger: manual ? 'manual' : 'schedule',
      dryRun: i === 0 && job.lastRun ? job.lastRun.dryRun : i % 7 === 4,
      outcome,
      durationSeconds: outcome === 'skipped' ? 0 : 4 + ((seed + i * 13) % 190),
      affected: outcome === 'skipped' ? 0 : (seed * (i + 3)) % 480,
      freedMb: outcome === 'succeeded' ? (seed + i * 7) % 90 : 0,
      by: manual ? 'Ada Lovelace' : null,
      summary: [
        { key: 'checked', count: 120 + ((seed + i * 17) % 900) },
        { key: 'changed', count: (seed * (i + 3)) % 480 },
        { key: 'problems', count: outcome === 'failed' ? 3 : outcome === 'partly' ? 1 : 0 },
      ],
    } satisfies JobRun;
  });
}

// ── Audit ────────────────────────────────────────────────────────────────────

/** The action labels of the audit log (`audit.actions.<id>`): human text, never the enum constants. */
export const AUDIT_ACTIONS = [
  'signedIn',
  'signInFailed',
  'passwordChanged',
  'userCreated',
  'userDisabled',
  'userEnabled',
  'passwordReset',
  'memberAdded',
  'projectCreated',
  'projectArchived',
  'pageReleased',
  'buildStarted',
  'jobRun',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  readonly id: string;
  readonly minutes: number;
  /** The user id (or `null` for the system). */
  readonly by: string | null;
  readonly action: AuditAction;
  readonly target: string;
  readonly project: string | null;
  readonly details: string;
}

const AUDIT_SEED: readonly { action: AuditAction; by: string | null; target: string; project: string | null; details: string }[] = [
  { action: 'signedIn', by: 'u-ada', target: 'Ada Lovelace', project: null, details: 'Browser on Windows' },
  { action: 'pageReleased', by: 'u-anna', target: 'Spring harvest arrives', project: 'lumen', details: 'English' },
  { action: 'buildStarted', by: 'u-mira', target: 'Build #412', project: 'lumen', details: 'Incremental, default target' },
  { action: 'signInFailed', by: null, target: 'lena', project: null, details: 'Wrong password (3rd time)' },
  { action: 'userCreated', by: 'u-ada', target: 'Ravi Patel', project: null, details: 'One-time password issued' },
  { action: 'memberAdded', by: 'u-ada', target: 'Ravi Patel', project: 'harbor', details: 'Role: Editor' },
  { action: 'passwordReset', by: 'u-omar', target: 'Lena Hoffmann', project: null, details: 'One-time password issued' },
  { action: 'userDisabled', by: 'u-ada', target: 'Noah Fischer', project: null, details: 'Left the company' },
  { action: 'projectArchived', by: 'u-ada', target: 'Nordic Bikes', project: 'nordic', details: 'Campaign ended' },
  { action: 'jobRun', by: null, target: 'Clean up unused files', project: null, details: '14 files removed' },
  { action: 'pageReleased', by: 'u-sofia', target: 'Holiday opening hours', project: 'lumen', details: 'German, English' },
  { action: 'passwordChanged', by: 'u-jonas', target: 'Jonas Weber', project: null, details: 'Other sessions signed out' },
  { action: 'projectCreated', by: 'u-omar', target: 'Atlas Docs', project: 'atlas', details: '' },
  { action: 'userEnabled', by: 'u-ada', target: 'Chloé Martin', project: null, details: '' },
];

/** ~70 events, newest first, spread over the last weeks (deterministic). */
export const AUDIT_EVENTS: readonly AuditEvent[] = Array.from({ length: 70 }, (_, i) => {
  const seed = AUDIT_SEED[(i * 5) % AUDIT_SEED.length];
  return { id: `e-${i}`, minutes: 4 + i * 640 + (i % 4) * 41, ...seed } satisfies AuditEvent;
});

/** `afilter=act:signedIn.userCreated,by:u-ada,project:lumen,from:2026-09-01,to:2026-09-30` ⇄ the Audit filters. */
export interface AuditFilters {
  readonly actions: readonly AuditAction[];
  readonly by: string | null;
  readonly project: string | null;
  readonly from: string | null;
  readonly to: string | null;
}

export const NO_AUDIT_FILTERS: AuditFilters = { actions: [], by: null, project: null, from: null, to: null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditFilter(value: string | null): AuditFilters {
  const f = { ...NO_AUDIT_FILTERS } as { -readonly [K in keyof AuditFilters]: AuditFilters[K] };
  for (const [key, val] of pairs(value)) {
    if (key === 'act') {
      f.actions = val.split('.').filter((a): a is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(a));
    } else if (key === 'by' && userById(val)) {
      f.by = val;
    } else if (key === 'project' && projectByKey(val)) {
      f.project = val;
    } else if (key === 'from' && ISO_DAY.test(val)) {
      f.from = val;
    } else if (key === 'to' && ISO_DAY.test(val)) {
      f.to = val;
    }
  }
  return f;
}

export function formatAuditFilter(f: AuditFilters): string | null {
  return join([
    f.actions.length ? `act:${f.actions.join('.')}` : '',
    f.by ? `by:${f.by}` : '',
    f.project ? `project:${f.project}` : '',
    f.from ? `from:${f.from}` : '',
    f.to ? `to:${f.to}` : '',
  ]);
}

/** The local day (`YYYY-MM-DD`) of an event `minutes` before `now`. */
export function dayOf(minutes: number, now: number): string {
  const date = new Date(now - minutes * 60_000);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function filterAudit(f: AuditFilters, now: number): AuditEvent[] {
  return AUDIT_EVENTS.filter((e) => {
    const day = dayOf(e.minutes, now);
    return (
      (f.actions.length === 0 || f.actions.includes(e.action)) &&
      (!f.by || e.by === f.by) &&
      (!f.project || e.project === f.project) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to)
    );
  });
}

// ── URL helpers ──────────────────────────────────────────────────────────────

function* pairs(value: string | null): Generator<[string, string]> {
  for (const part of (value ?? '').split(',')) {
    const at = part.indexOf(':');
    if (at > 0) {
      yield [part.slice(0, at), part.slice(at + 1)];
    }
  }
}

const clean = (text: string): string => text.trim().replace(/,/g, ' ');
const join = (parts: readonly string[]): string | null => {
  const used = parts.filter(Boolean);
  return used.length ? used.join(',') : null;
};
