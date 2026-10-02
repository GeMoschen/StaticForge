import type { Params } from '@angular/router';

/** The audit view's filters as they live in the URL query (M26): shareable and kept on reload. */
export interface AuditFilterState {
  actions: string[];
  userId: number | null;
  /** A project key, `_instance` for entries without a project, or `null` for any. */
  project: string | null;
  /** `yyyy-mm-dd`, inclusive, in the viewer's time zone. */
  from: string | null;
  /** `yyyy-mm-dd`, inclusive, in the viewer's time zone. */
  to: string | null;
  page: number;
}

export const INSTANCE_ONLY = '_instance';

/**
 * The audit actions the server writes (M35.16): each has a human label under `admin.audit.actions.<CODE>`. Actions are
 * free strings read from the log (`GET /admin/audit/actions`); one that is not listed here is shown with its code made
 * readable ({@link humanizeAuditAction}).
 */
export const KNOWN_AUDIT_ACTIONS: readonly string[] = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_RENAMED',
  'USER_ENABLED',
  'USER_DISABLED',
  'USER_UNLOCKED',
  'USER_DELETED',
  'USER_PASSWORD_CHANGED',
  'USER_PASSWORD_RESET',
  'USER_SESSIONS_REVOKED',
  'USER_SYSTEM_ROLE_SET',
  'MEMBER_ROLE_SET',
  'MEMBER_REMOVED',
  'PROJECT_ARCHIVED',
  'PROJECT_UNARCHIVED',
  'REDIRECT_CREATED',
  'REDIRECT_UPDATED',
  'REDIRECT_DELETED',
  'TARGET_CREATE',
  'TARGET_UPDATE',
  'TARGET_DELETE',
  'GENERATION_STARTED',
  'GENERATION_CANCELLED',
  'GENERATION_PROMOTED',
  'JOB_SETTINGS_SET',
  'JOB_RUN',
  'COMPACTION_POLICY_SET',
  'REVISIONS_COMPACTED',
];

/** A code made readable: `USER_PASSWORD_RESET` → `User password reset`. */
export function humanizeAuditAction(code: string): string {
  const words = code.toLowerCase().replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Whether both ends of the day range are set and the end is before the start. */
export function auditRangeInvalid(state: Pick<AuditFilterState, 'from' | 'to'>): boolean {
  return state.from !== null && state.to !== null && state.to < state.from;
}

/** A short one-line summary of an entry's detail (`userId: 5, role: EDITOR`), cut at `max` characters. */
export function summarizeAuditDetail(detail: unknown, max = 80): string {
  if (detail == null || detail === '') {
    return '';
  }
  const text =
    typeof detail === 'object' && !Array.isArray(detail)
      ? Object.entries(detail as Record<string, unknown>)
          .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
          .join(', ')
      : typeof detail === 'string'
        ? detail
        : JSON.stringify(detail);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const AUDIT_PAGE_SIZE = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the filters from query parameters; anything malformed is dropped rather than sent. */
export function auditFilterFromParams(params: Params): AuditFilterState {
  const list = (value: unknown): string[] =>
    (Array.isArray(value) ? value : value == null ? [] : [value]).map(String).filter((v) => v !== '');
  const userId = Number(params['user']);
  const page = Number(params['page']);
  const date = (value: unknown): string | null => (typeof value === 'string' && DATE.test(value) ? value : null);
  return {
    actions: list(params['action']),
    userId: Number.isInteger(userId) && userId > 0 ? userId : null,
    project: typeof params['project'] === 'string' && params['project'] !== '' ? params['project'] : null,
    from: date(params['from']),
    to: date(params['to']),
    page: Number.isInteger(page) && page > 0 ? page : 0,
  };
}

/** The query parameters for `state`; empty filters are left out so the URL stays short. */
export function paramsFromAuditFilter(state: AuditFilterState): Params {
  return {
    action: state.actions.length > 0 ? state.actions : null,
    user: state.userId,
    project: state.project,
    from: state.from,
    to: state.to,
    page: state.page > 0 ? state.page : null,
  };
}

/**
 * The `GET /admin/audit` query for `state`. The day range is the viewer's: `from` starts at local midnight and `to`
 * includes its whole day (the API's `to` is exclusive, so it becomes the next local midnight).
 */
export function auditApiQuery(state: AuditFilterState): {
  action?: string[];
  userId?: number;
  project?: string;
  from?: string;
  to?: string;
  page: number;
  size: number;
} {
  return {
    action: state.actions.length > 0 ? state.actions : undefined,
    userId: state.userId ?? undefined,
    project: state.project ?? undefined,
    from: state.from ? localMidnight(state.from, 0) : undefined,
    to: state.to ? localMidnight(state.to, 1) : undefined,
    page: state.page,
    size: AUDIT_PAGE_SIZE,
  };
}

function localMidnight(day: string, addDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}
