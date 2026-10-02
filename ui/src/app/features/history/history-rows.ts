import { HistoryKind, kindOf } from './history-model';

/** `RevisionView` as the History screens read it (the generated type keeps `summary` opaque). */
export interface RevisionApi {
  revisionId?: number;
  createdAt?: string;
  createdBy?: number | null;
  createdByName?: string | null;
  changeType?: string;
  comment?: string | null;
  summary?: unknown;
  compacted?: boolean;
}

/** One item a revision touched, with the name people know it by. */
export interface HistoryAssetRef {
  readonly uuid: string | null;
  readonly uid: string | null;
  readonly name: string;
  readonly type: string;
  readonly action: string;
  /** The language codes whose content changed; empty = the item as a whole. */
  readonly locales: readonly string[];
}

/** A revision as the drawer, the page and the banner show it. */
export interface HistoryRow {
  readonly id: number;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly byId: number | null;
  readonly byName: string;
  readonly kind: HistoryKind;
  readonly changeType: string;
  readonly comment: string | null;
  readonly assets: readonly HistoryAssetRef[];
  /** The languages touched by any item, upper case, in first-seen order. */
  readonly locales: readonly string[];
  readonly compacted: boolean;
}

interface SummaryAssetApi {
  uuid?: string;
  uid?: string;
  type?: string;
  name?: string;
  action?: string;
  locales?: string[];
}

/** Turns an API revision into a row. `unknownAuthor` names a person the server could not name (a removed account). */
export function toHistoryRow(rev: RevisionApi, unknownAuthor: string): HistoryRow {
  const summary = (rev.summary ?? {}) as { assets?: SummaryAssetApi[] };
  const assets = (summary.assets ?? []).map<HistoryAssetRef>((a) => ({
    uuid: a.uuid ?? null,
    uid: a.uid ?? null,
    name: a.name?.trim() || a.uid || a.uuid?.slice(0, 8) || '',
    type: a.type ?? '',
    action: (a.action ?? '').toLowerCase(),
    locales: a.locales ?? [],
  }));
  const locales = [...new Set(assets.flatMap((a) => a.locales.map((l) => l.toUpperCase())))];
  const changeType = rev.changeType ?? '';
  return {
    id: rev.revisionId ?? 0,
    at: rev.createdAt ? Date.parse(rev.createdAt) : 0,
    byId: rev.createdBy ?? null,
    byName: rev.createdByName?.trim() || unknownAuthor,
    kind: kindOf(changeType),
    changeType,
    comment: rev.comment?.trim() || null,
    assets,
    locales,
    compacted: rev.compacted === true,
  };
}

/** The change types `history.verb.*` has a verb for. */
const CHANGE_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'MOVE', 'RENAME', 'UID_CHANGE', 'BULK', 'IMPORT', 'RELEASE', 'UNPUBLISH', 'DISCARD'];

/** A translator for `history.*` keys. */
export type HistoryTranslate = (key: string, params?: Record<string, unknown>) => string;

/**
 * The one-line human summary of a revision: "Changed Spring harvest arrives", "Released Spring harvest arrives and 2
 * more". A revision without items says its comment, or what kind of change it was.
 */
export function summaryOf(row: HistoryRow, t: HistoryTranslate): string {
  const type = row.changeType.toUpperCase();
  const resolved = t(`verb.${CHANGE_TYPES.includes(type) ? type : 'UPDATE'}`);
  const [first, ...rest] = row.assets;
  if (!first) {
    return row.comment ?? resolved;
  }
  return rest.length === 0 ? t('summary.one', { verb: resolved, name: first.name }) : t('summary.many', { verb: resolved, name: first.name, count: rest.length });
}

/** The first two item names and how many more, for a table cell. */
export function assetNamesOf(row: HistoryRow): { names: string; more: number } {
  const [first, second, ...rest] = row.assets;
  return { names: [first, second].filter((a) => a !== undefined).map((a) => a!.name).join(', '), more: rest.length };
}

/** "12 Sep, 14:03" — a revision's time in the time-travel banner and the detail pane. */
export function formatRevisionTime(at: number): string {
  return new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
