import type { GenerationRunView } from '../publishing/runs/runs.util';

/** What the top bar says about the project's last build. */
export type BuildState = 'none' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

/** How many past builds the popover lists. */
export const RECENT_BUILDS = 5;

const FINISHED: Readonly<Record<string, BuildState>> = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/** The state of one run: a run with a final status is that state, anything else (queued, running) is "running". */
export function stateOfRun(run: GenerationRunView): BuildState {
  return FINISHED[run.status ?? ''] ?? 'running';
}

/** The state of the newest run (`runs` is newest first); `none` before the first build. */
export function buildStateOf(runs: readonly GenerationRunView[]): BuildState {
  return runs.length === 0 ? 'none' : stateOfRun(runs[0]);
}

/** The status tone of a state (`sf-status`); red only for a failure. */
export function toneOf(state: BuildState): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (state) {
    case 'success':
      return 'success';
    case 'partial':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'running':
      return 'info';
    default:
      return 'neutral';
  }
}

export function iconOf(state: BuildState): string {
  switch (state) {
    case 'success':
      return 'check_circle';
    case 'partial':
      return 'warning';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancel';
    default:
      return 'rocket_launch';
  }
}
