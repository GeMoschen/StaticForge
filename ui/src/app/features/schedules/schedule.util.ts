import type { components } from '../../core/api/generated/schema.d.ts';
import { localeTag } from '../release/release-status.util';
import { describeCron } from './cron-presets.util';
import { zonedToUtc } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];
type ScheduleRequest = components['schemas']['ScheduleRequest'];
type Item = components['schemas']['Item'];

/** The action types of M27 (epic decision 21). */
export type ScheduleType = 'RELEASE' | 'UNPUBLISH' | 'GENERATION' | 'RECURRING_GENERATION';

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
