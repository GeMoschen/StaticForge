import type { SfStatusTone } from '../../../../shared/components/display/sf-status.component';
import type { QualityLevel, RedirectState, RunStatus } from './publishing-data';

export const RUN_STATUS_TONES: Readonly<Record<RunStatus, SfStatusTone>> = {
  running: 'info',
  success: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

export const RUN_STATUS_ICONS: Readonly<Record<RunStatus, string>> = {
  running: 'progress_activity',
  success: 'check_circle',
  partial: 'warning',
  failed: 'error',
  cancelled: 'block',
};

export const REDIRECT_STATE_TONES: Readonly<Record<RedirectState, SfStatusTone>> = {
  active: 'success',
  shadowed: 'neutral',
  dangling: 'warning',
  loop: 'danger',
};

export const REDIRECT_STATE_ICONS: Readonly<Record<RedirectState, string>> = {
  active: 'check_circle',
  shadowed: 'visibility_off',
  dangling: 'link_off',
  loop: 'sync_problem',
};

export const LEVEL_ICONS: Readonly<Record<QualityLevel, string>> = {
  off: 'block',
  warning: 'warning',
  error: 'error',
};

/** "3 min 24 s", "41 s". */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}
