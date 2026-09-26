import type { components } from '../../core/api/generated/schema.d.ts';

type LocaleReleaseView = components['schemas']['LocaleReleaseView'];
type ScheduledRefView = components['schemas']['ScheduledRefView'];

/** The release status of one (asset, locale) pair (M27.1.1, epic decision 6). */
export type ReleaseStatus = 'NEW' | 'PUBLISHED' | 'CHANGED' | 'UNPUBLISHED' | 'DELETION_PENDING';

/**
 * The `release` block every releasable asset DTO carries: status per locale key. A project without languages, and
 * non-localized media, use the one key `""` ("every language"). `null`/absent for assets without a release state.
 */
export type ReleaseBlock = Record<string, LocaleReleaseView> | null | undefined;

export const RELEASE_STATUSES: readonly ReleaseStatus[] = ['NEW', 'CHANGED', 'DELETION_PENDING', 'UNPUBLISHED', 'PUBLISHED'];

const LABELS: Record<ReleaseStatus, string> = {
  NEW: 'New',
  PUBLISHED: 'Published',
  CHANGED: 'Changed',
  UNPUBLISHED: 'Unpublished',
  DELETION_PENDING: 'Deletion pending',
};

/** A Material Symbols ligature per status: the badge never tells statuses apart by colour alone (§24.7). */
const ICONS: Record<ReleaseStatus, string> = {
  NEW: 'fiber_new',
  PUBLISHED: 'check_circle',
  CHANGED: 'edit_note',
  UNPUBLISHED: 'cloud_off',
  DELETION_PENDING: 'delete_forever',
};

export function isReleaseStatus(value: unknown): value is ReleaseStatus {
  return typeof value === 'string' && value in LABELS;
}

export function statusLabel(status: string | null | undefined): string {
  return isReleaseStatus(status) ? LABELS[status] : (status ?? '');
}

export function statusIcon(status: string | null | undefined): string {
  return isReleaseStatus(status) ? ICONS[status] : 'help';
}

/** The css modifier of a status (`changed`, `deletion-pending`, …). */
export function statusTone(status: string | null | undefined): string {
  return (status ?? 'unknown').toLowerCase().replace(/_/g, '-');
}

/**
 * The key of `block` that describes `locale`: the locale itself, else the shared key `""` (a project without
 * languages, non-localized media). `null` when the block says nothing about it — no badge then.
 */
export function releaseKeyFor(block: ReleaseBlock, locale: string | null | undefined): string | null {
  if (!block) {
    return null;
  }
  if (locale && block[locale]) {
    return locale;
  }
  if (block['']) {
    return '';
  }
  // A project without languages whose block is keyed anyway: take the first key.
  return locale ? null : (Object.keys(block)[0] ?? null);
}

/** The status for the editing locale (see {@link releaseKeyFor}). */
export function statusFor(block: ReleaseBlock, locale: string | null | undefined): ReleaseStatus | null {
  const key = releaseKeyFor(block, locale);
  const status = key === null ? null : block?.[key]?.status;
  return isReleaseStatus(status) ? status : null;
}

export interface LocaleStatus {
  /** The locale key; `""` means every language. */
  key: string;
  status: ReleaseStatus;
  releasedRevision?: number;
}

/** Every locale key of a block with its status, in the server's (project locale) order. */
export function localeStatuses(block: ReleaseBlock): LocaleStatus[] {
  if (!block) {
    return [];
  }
  return Object.entries(block)
    .filter(([, view]) => isReleaseStatus(view?.status))
    .map(([key, view]) => ({ key, status: view.status as ReleaseStatus, releasedRevision: view.releasedRevision }));
}

/** How a locale key reads in compact lists: `DE`, or "All languages" for the shared key. */
export function localeTag(key: string | null | undefined): string {
  return key ? key.toUpperCase() : 'All languages';
}

/** "DE published · EN changed" — or just "Published" for a block with the shared key only. */
export function statusSummary(block: ReleaseBlock): string {
  const entries = localeStatuses(block);
  if (entries.length === 1 && entries[0].key === '') {
    return statusLabel(entries[0].status);
  }
  return entries.map((entry) => `${localeTag(entry.key)} ${statusLabel(entry.status).toLowerCase()}`).join(' · ');
}

/** Statuses that have something to release: a draft that differs from what is online, or isn't online. */
export function canReleaseStatus(status: string | null | undefined): boolean {
  return status === 'NEW' || status === 'CHANGED' || status === 'UNPUBLISHED' || status === 'DELETION_PENDING';
}

/** Statuses with a released version that an unpublish takes offline. */
export function canUnpublishStatus(status: string | null | undefined): boolean {
  return status === 'PUBLISHED' || status === 'CHANGED' || status === 'DELETION_PENDING';
}

/** Statuses whose draft differs from a released version that a discard can write back. */
export function canDiscardStatus(status: string | null | undefined): boolean {
  return status === 'CHANGED' || status === 'DELETION_PENDING';
}

/** Whether deleting the asset leaves something online until the deletion is released (epic decision 8). */
export function isOnline(block: ReleaseBlock): boolean {
  return localeStatuses(block).some((entry) => entry.status === 'PUBLISHED' || entry.status === 'CHANGED');
}

/** The note a delete confirmation adds for an asset that is online (epic decision 8). */
export const STAYS_ONLINE_NOTE = 'It stays online until you release the deletion.';

/**
 * A delete confirmation for an asset with a release state: a published asset "stays online until you release the
 * deletion", so the permanent-sounding "This cannot be undone." gives way to that note; a never-released asset keeps
 * the question as it is.
 */
export function deleteQuestion(question: string, block: ReleaseBlock): string {
  if (!isOnline(block)) {
    return question;
  }
  const base = question.replace(/\s*This cannot be undone\.?\s*$/, '').trim();
  return `${base} ${STAYS_ONLINE_NOTE}`;
}

/** What a scheduled action does, for badges and the release bar ("Release", "Unpublish", …). */
export function scheduledTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'RELEASE':
      return 'Release';
    case 'UNPUBLISH':
      return 'Unpublish';
    case 'GENERATION':
      return 'Generation';
    case 'RECURRING_GENERATION':
      return 'Recurring generation';
    default:
      return type ?? 'Action';
  }
}

/** The pending schedules of an asset that touch `locale` (or every locale). */
export function scheduledFor(scheduled: ScheduledRefView[] | null | undefined, locale: string | null | undefined): ScheduledRefView[] {
  return (scheduled ?? []).filter((ref) => !ref.locale || !locale || ref.locale === locale);
}
