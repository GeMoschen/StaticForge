import type { components } from '../../core/api/generated/schema.d.ts';
import { localeTag } from '../release/release-status.util';
import { describeCron, describeCronText } from './cron-presets.util';
import { zonedToUtc } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];
type ScheduleRequest = components['schemas']['ScheduleRequest'];
type Item = components['schemas']['Item'];

/** The action types of M27 (epic decision 21). */
export type ScheduleType = 'RELEASE' | 'UNPUBLISH' | 'GENERATION' | 'RECURRING_GENERATION';

/**
 * What a person schedules (sample, M35.23): a recurring generation is a *Generation* repeated, not a kind of its own — the
 * backend keeps the separate `RECURRING_GENERATION` type, the screens speak in kinds.
 */
export type ScheduleKind = 'RELEASE' | 'UNPUBLISH' | 'GENERATION';

export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['RELEASE', 'UNPUBLISH', 'GENERATION'];

/** The kind a backend type belongs to. */
export function scheduleKind(type: string | null | undefined): ScheduleKind | null {
  return type === 'RECURRING_GENERATION' ? 'GENERATION' : SCHEDULE_KINDS.find((kind) => kind === type) ?? null;
}

/** The backend types behind a kind (a list filter on Generation matches one-off and recurring). */
export function typesOfKind(kind: string): ScheduleType[] {
  return kind === 'GENERATION' ? ['GENERATION', 'RECURRING_GENERATION'] : [kind as ScheduleType];
}

export const SCHEDULE_TYPES: readonly { value: ScheduleType; label: string }[] = [
  { value: 'RELEASE', label: 'Release' },
  { value: 'UNPUBLISH', label: 'Unpublish' },
  { value: 'GENERATION', label: 'Generation' },
  { value: 'RECURRING_GENERATION', label: 'Recurring generation' },
];

export const SCHEDULE_STATUSES: readonly { value: string; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'SUCCEEDED', label: 'Succeeded' },
  { value: 'FAILED', label: 'Failed or paused' },
  { value: 'SKIPPED', label: 'Skipped' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const OUTCOMES: Record<string, string> = {
  SUCCEEDED: 'Succeeded',
  PARTIAL: 'Partly done',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

export function typeLabel(type: string | null | undefined): string {
  return SCHEDULE_TYPES.find((t) => t.value === type)?.label ?? type ?? '';
}

export function isRecurring(type: string | null | undefined): boolean {
  return type === 'RECURRING_GENERATION';
}

export function isReleaseState(type: string | null | undefined): type is 'RELEASE' | 'UNPUBLISH' {
  return type === 'RELEASE' || type === 'UNPUBLISH';
}

/** A failed recurring schedule is paused (`nextRunAt` cleared) until someone takes it over. */
export function scheduleStatusLabel(schedule: Pick<ScheduleView, 'status' | 'type'>): string {
  if (schedule.status === 'FAILED' && isRecurring(schedule.type)) {
    return 'Paused';
  }
  return SCHEDULE_STATUSES.find((s) => s.value === schedule.status)?.label.replace(' or paused', '') ?? schedule.status ?? '';
}

export function outcomeLabel(outcome: string | null | undefined): string {
  return outcome ? (OUTCOMES[outcome] ?? outcome) : '';
}

interface GenerationParams {
  mode?: string;
  targetId?: number | null;
  channels?: string[];
  comment?: string;
}

/** What a schedule does, in one line: "3 items", "Full generation · html, amp", "Every day at 09:00 · incremental". */
export function scheduleWhat(schedule: ScheduleView): string {
  if (isReleaseState(schedule.type)) {
    const items = schedule.items ?? [];
    if (items.length === 1) {
      const item = items[0];
      const name = item.displayName || item.uid || 'Untitled';
      return item.locale ? `${name} (${localeTag(item.locale)})` : name;
    }
    const count = schedule.itemCount ?? items.length;
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  }
  const params = (schedule.params ?? {}) as GenerationParams;
  const mode = params.mode === 'INCREMENTAL' ? 'Incremental' : 'Full';
  const channels = params.channels && params.channels.length > 0 ? params.channels.join(', ') : 'all channels';
  const build = `${mode} build · ${channels}`;
  return isRecurring(schedule.type) ? `${describeCron(schedule.cron)} · ${build}` : build;
}

/** A translator (`TranslocoService#translate`) the screen's text helpers take, so this file needs no injection. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** The `schedules.statuses.*` key of a row: a failed recurring schedule reads as paused. */
export function scheduleStatusKey(schedule: Pick<ScheduleView, 'status' | 'type'>): string {
  return schedule.status === 'FAILED' && isRecurring(schedule.type) ? 'PAUSED' : (schedule.status ?? '');
}

/**
 * What a schedule does, in one translated line, by name: "Home (EN)", "3 items", "Full build · all channels". An item without a name shows its UID in developer mode only, else "Untitled" — never a UUID.
 */
export function scheduleWhatText(schedule: ScheduleView, t: Translate, dev: boolean): string {
  if (isReleaseState(schedule.type)) {
    const items = schedule.items ?? [];
    if (items.length === 1) {
      const item = items[0];
      const name = item.displayName || (dev ? item.uid : '') || t('schedules.page.untitled');
      return item.locale ? `${name} (${localeTag(item.locale)})` : name;
    }
    return t('schedules.page.itemCount', { count: schedule.itemCount ?? items.length });
  }
  const params = (schedule.params ?? {}) as GenerationParams;
  const channels = params.channels && params.channels.length > 0 ? params.channels.join(', ') : t('schedules.page.allChannels');
  const build = t('schedules.page.build', { mode: t(`schedules.mode.${params.mode === 'INCREMENTAL' ? 'INCREMENTAL' : 'FULL'}`), channels });
  return build;
}

/** The Repeat column: "Once", or the cron in words ("Every day at 09:00"). */
export function scheduleRepeatText(schedule: ScheduleView, t: Translate): string {
  return isRecurring(schedule.type) ? describeCronText(schedule.cron, t) : t('schedules.repeat.once');
}

/** Whether the list/row actions apply (the server decides in the end; these only hide what it would refuse). */
export function canEditSchedule(schedule: ScheduleView): boolean {
  return schedule.status === 'PENDING';
}

export function canCancelSchedule(schedule: ScheduleView): boolean {
  return schedule.status === 'PENDING' || (schedule.status === 'FAILED' && isRecurring(schedule.type));
}

export function canRunNow(schedule: ScheduleView): boolean {
  return schedule.status === 'PENDING';
}

/** A failed or paused schedule — typically an owner who lost permission (`SF-DOM-0163`) — or another owner's pending one. */
export function canTakeOver(schedule: ScheduleView, currentUserId: number | null): boolean {
  if (schedule.status === 'FAILED') {
    return true;
  }
  return schedule.status === 'PENDING' && currentUserId != null && schedule.ownerUserId !== currentUserId;
}

/** "Draft changed since scheduled" matters only while a pinned release is still to run. */
export function showsDrift(schedule: ScheduleView): boolean {
  return schedule.type === 'RELEASE' && schedule.pinPolicy !== 'LATEST' && schedule.status === 'PENDING' && (schedule.driftCount ?? 0) > 0;
}

export function canRepin(schedule: ScheduleView): boolean {
  return schedule.type === 'RELEASE' && schedule.pinPolicy !== 'LATEST' && schedule.status === 'PENDING' && (schedule.driftCount ?? 0) > 0;
}

// ── The schedule dialog's form ───────────────────────────────────────────

export type LatenessUnit = 'minutes' | 'hours';

export interface ScheduleForm {
  type: ScheduleType;
  /** One-off: wall-clock date and time in the viewer's zone. */
  date: string;
  time: string;
  /** Recurring: the cron expression (from a preset or typed). */
  cron: string;
  /** The viewer's zone — the creator's zone, sent as `zoneId` (epic decision 24). */
  zone: string;
  /** Release/unpublish: the items; release: the kept dependencies. */
  items: Item[];
  includeDependencies: Item[];
  pinPolicy: 'PINNED' | 'LATEST';
  thenGenerate: boolean;
  /** Generation: mode, and for every build step target and channels (empty: every enabled channel). */
  mode: 'FULL' | 'INCREMENTAL';
  targetId: number | null;
  channels: string[];
  missedPolicy: 'RUN_LATE' | 'SKIP_IF_LATER_THAN';
  maxLatenessValue: number;
  maxLatenessUnit: LatenessUnit;
  comment: string;
}

/** `PT15M` / `PT2H` — the ISO duration of "skip if more than N minutes|hours late". */
export function latenessToIso(value: number, unit: LatenessUnit): string {
  const amount = Math.max(1, Math.floor(value || 0));
  return unit === 'hours' ? `PT${amount}H` : `PT${amount}M`;
}

/** The inverse of {@link latenessToIso}; anything else reads as minutes. */
export function latenessFromIso(iso: string | null | undefined): { value: number; unit: LatenessUnit } {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso ?? '');
  const hours = Number(match?.[1] ?? 0);
  const minutes = Number(match?.[2] ?? 0);
  if (hours > 0 && minutes === 0) {
    return { value: hours, unit: 'hours' };
  }
  return { value: hours * 60 + minutes || 15, unit: 'minutes' };
}

/**
 * The request body of a schedule form. `withParams: false` (editing a release or unpublish) leaves `params` out,
 * so the server keeps the resolved, pinned items it stored.
 */
export function scheduleRequest(form: ScheduleForm, withParams = true): ScheduleRequest {
  const comment = form.comment.trim() || undefined;
  const recurring = isRecurring(form.type);
  const request: ScheduleRequest = {
    type: form.type,
    missedPolicy: form.missedPolicy,
    maxLateness: form.missedPolicy === 'SKIP_IF_LATER_THAN' ? latenessToIso(form.maxLatenessValue, form.maxLatenessUnit) : undefined,
  };
  if (recurring) {
    request.cron = form.cron.trim();
    request.zoneId = form.zone;
  } else {
    request.runAt = zonedToUtc(form.date, form.time, form.zone) ?? undefined;
  }
  const build = {
    targetId: form.targetId ?? null,
    ...(form.channels.length > 0 ? { channels: form.channels } : {}),
  };
  if (isReleaseState(form.type)) {
    if (form.type === 'RELEASE') {
      request.pinPolicy = form.pinPolicy;
    }
    request.thenGenerate = (form.thenGenerate ? build : undefined) as ScheduleRequest['thenGenerate'];
    if (withParams) {
      request.params = {
        items: form.items,
        ...(form.type === 'RELEASE' ? { includeDependencies: form.includeDependencies } : {}),
        ...(comment ? { comment } : {}),
      } as unknown as ScheduleRequest['params'];
    }
  } else if (withParams) {
    request.params = { mode: form.mode, ...build, ...(comment ? { comment } : {}) } as unknown as ScheduleRequest['params'];
  }
  return request;
}
