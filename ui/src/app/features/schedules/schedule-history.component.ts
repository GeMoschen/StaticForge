import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { localeTag } from '../release/release-status.util';
import { outcomeLabel, scheduleStatusLabel, scheduleWhat, typeLabel } from './schedule.util';
import { formatDuration, formatInstant, formatInstantWithZone } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];
type ScheduleExecutionView = components['schemas']['ScheduleExecutionView'];

/** One item's result in an execution's `detail.items` (`ReleaseStateActionHandler#itemResult`). */
interface ItemResult {
  assetUuid?: string;
  locale?: string;
  result?: string;
  reason?: string;
}

interface ExecutionRow {
  execution: ScheduleExecutionView;
  items: { name: string; locale: string; result: string; reason: string }[];
  waitingForRun: number | null;
}

const RESULTS: Record<string, string> = { APPLIED: 'Done', UNCHANGED: 'Nothing to do', SKIPPED: 'Skipped' };

/**
 * A schedule's execution history (M27.6.5): when each run was due and started, how late, the outcome with its
 * per-item results, and links to the revision it wrote and the generation run it started.
 */
@Component({
  selector: 'sf-schedule-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfIconComponent, SfSpinnerComponent],
  templateUrl: './schedule-history.component.html',
  styleUrl: './schedule-history.component.scss',
})
export class ScheduleHistoryComponent {
  private readonly api = inject(ApiClient);
  private readonly events = inject(ReleaseEventsStore);
  protected readonly members = inject(ProjectMembersStore);

  readonly projectKey = input.required<string>();
  readonly scheduleId = input.required<number>();
  readonly closed = output<void>();

  protected readonly schedule = signal<ScheduleView | null>(null);
  protected readonly executions = signal<ScheduleExecutionView[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly rows = computed<ExecutionRow[]>(() => {
    const names = new Map((this.schedule()?.items ?? []).map((item) => [item.assetUuid, item.displayName || item.uid || '']));
    return this.executions().map((execution) => {
      const detail = (execution.detail ?? {}) as { items?: ItemResult[]; waitingForRun?: number };
      return {
        execution,
        items: (detail.items ?? []).map((item) => ({
          name: names.get(item.assetUuid) || (item.assetUuid ?? '').slice(0, 8),
          locale: item.locale ? localeTag(item.locale) : '',
          result: RESULTS[item.result ?? ''] ?? item.result ?? '',
          reason: item.reason ?? '',
        })),
        waitingForRun: typeof detail.waitingForRun === 'number' ? detail.waitingForRun : null,
      };
    });
  });

  protected readonly title = computed(() => {
    const schedule = this.schedule();
    return schedule ? `${typeLabel(schedule.type)} — ${scheduleWhat(schedule)}` : 'Schedule';
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const id = this.scheduleId();
      this.events.version();
      untracked(() => this.load(key, id));
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closed.emit();
  }

  protected formatInstant = formatInstant;
  protected formatDuration = formatDuration;
  protected outcomeLabel = outcomeLabel;
  protected statusLabel = scheduleStatusLabel;

  protected nextRun(schedule: ScheduleView): string {
    const when = schedule.nextRunAt ?? (schedule.status === 'PENDING' ? schedule.runAt : null);
    return when ? formatInstantWithZone(when, schedule.zoneId) : '—';
  }

  private load(projectKey: string, id: number): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      schedule: this.api.schedule(projectKey, id),
      executions: this.api.scheduleExecutions(projectKey, id),
    }).subscribe({
      next: ({ schedule, executions }) => {
        this.loading.set(false);
        this.schedule.set(schedule);
        this.executions.set(executions.rows ?? []);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(problemOf(err, 'Could not load the schedule.').detail);
      },
    });
  }
}
