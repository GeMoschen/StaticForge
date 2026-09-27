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
 * Readable names of audit actions, shown next to the code in the audit view. Actions are free strings read from the
 * log (`GET /admin/audit/actions`); one without an entry is shown by its code alone.
 */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  // System jobs (M29, epic decision 5): instance-level entries.
  JOB_SETTINGS_SET: 'Job schedule or settings changed',
  JOB_RUN: 'Job run started manually',
  // Revision compaction (M29): project-level entries.
  COMPACTION_POLICY_SET: 'Revision compaction policy changed',
  REVISIONS_COMPACTED: 'Revisions compacted',
};

/** The readable name of an audit action, or `null` when it has none (then the code is shown alone). */
export function auditActionLabel(action: string | null | undefined): string | null {
  return action ? (AUDIT_ACTION_LABELS[action] ?? null) : null;
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
