import type { SfStatusTone } from '../../../shared/components/display/sf-status.component';
import type { components } from '../../../core/api/generated/schema.d.ts';

export type GenerationRunView = components['schemas']['GenerationRunView'];

/** A run's status as the screens name it (`publishing.runs.status.*`). */
export type RunStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
export type RunMode = 'full' | 'incremental';
export type RunTrigger = 'manual' | 'schedule' | 'release';

export const RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'success', 'partial', 'failed', 'cancelled'];
export const RUN_MODES: readonly RunMode[] = ['full', 'incremental'];
export const RUN_TRIGGERS: readonly RunTrigger[] = ['manual', 'schedule', 'release'];

export const RUN_STATUS_TONES: Readonly<Record<RunStatus, SfStatusTone>> = {
  queued: 'neutral',
  running: 'info',
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

export const RUN_STATUS_ICONS: Readonly<Record<RunStatus, string>> = {
  queued: 'schedule',
  running: 'progress_activity',
  success: 'check_circle',
  partial: 'warning',
  failed: 'error',
  cancelled: 'block',
};

/** The run's status; anything the server sends that this build does not know reads as failed. */
export function runStatusOf(run: GenerationRunView): RunStatus {
  const status = (run.status ?? '').toLowerCase();
  return (RUN_STATUSES as readonly string[]).includes(status) ? (status as RunStatus) : 'failed';
}

export function runModeOf(run: GenerationRunView): RunMode {
  return run.mode?.toUpperCase() === 'INCREMENTAL' ? 'incremental' : 'full';
}

export function runTriggerOf(run: GenerationRunView): RunTrigger {
  const trigger = (run.trigger ?? 'MANUAL').toLowerCase();
  return (RUN_TRIGGERS as readonly string[]).includes(trigger) ? (trigger as RunTrigger) : 'manual';
}

/** Queued or running: the run can still be cancelled and its log is live. */
export function isActiveRun(run: GenerationRunView): boolean {
  const status = runStatusOf(run);
  return status === 'queued' || status === 'running';
}

/** A finished run with output can be promoted to its target. */
export function isPromotable(run: GenerationRunView): boolean {
  const status = runStatusOf(run);
  return status === 'success' || status === 'partial';
}

/** Run time in seconds; `null` while it has not finished (queued, running). */
export function durationSeconds(run: GenerationRunView): number | null {
  if (!run.startedAt || !run.finishedAt) {
    return null;
  }
  return Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
}

/** "3 min 24 s", "41 s". */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** The quality findings of a run, or `null` when its checks never ran (queued, failed before checking). */
export function findingTotals(run: GenerationRunView): { errors: number; warnings: number } | null {
  const counts = run.findingCounts;
  return counts ? { errors: counts.errors ?? 0, warnings: counts.warnings ?? 0 } : null;
}

const KILOBYTE = 1024;

/** "812 B", "4.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < KILOBYTE) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / KILOBYTE;
  let unit = 0;
  while (value >= KILOBYTE && unit < units.length - 1) {
    value /= KILOBYTE;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}
