import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { RouterLink } from '@angular/router';
import { type Subscription, forkJoin } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { SfDrawerComponent } from '../../shared/components/dialog/sf-drawer.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfStatusComponent, type SfStatusTone } from '../../shared/components/display/sf-status.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { localeTag } from '../release/release-status.util';
import { type Translate, latenessFromIso, scheduleStatusKey, scheduleWhatText } from './schedule.util';
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
  /** The run this execution started, deleted since by run retention (M29.3.1, `detail.deletedGenerationRunId`). */
  deletedRun: number | null;
}

const STATUS_TONES: Readonly<Record<string, SfStatusTone>> = {
  PENDING: 'info',
  RUNNING: 'accent',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  PAUSED: 'warning',
  SKIPPED: 'neutral',
  CANCELLED: 'neutral',
};
const OUTCOME_TONES: Readonly<Record<string, SfStatusTone>> = {
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};
const RESULTS = ['APPLIED', 'UNCHANGED', 'SKIPPED'];

/**
 * A schedule's execution history (M27.6.5, an `sf-drawer` since M35.23): the schedule's facts and items by name, then
 * when each run was due and started, how late, the outcome with its per-item results, and links to the revision it wrote
 * and the generation run it started. The drawer's title says which schedule it is ("History: Release “Home (EN)”").
 */
@Component({
  selector: 'sf-schedule-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfBadgeComponent, SfButtonComponent, SfDrawerComponent, SfSkeletonComponent, SfStatusComponent],
  templateUrl: './schedule-history.component.html',
  styleUrl: './schedule-history.component.scss',
})
export class ScheduleHistoryComponent {
  private readonly api = inject(ApiClient);
  private readonly events = inject(ReleaseEventsStore);
  private readonly transloco = inject(TranslocoService);
  private readonly dev = inject(DeveloperModeService).enabled;
  protected readonly members = inject(ProjectMembersStore);

  readonly projectKey = input.required<string>();
  readonly scheduleId = input.required<number>();
  readonly closed = output<void>();

  protected readonly schedule = signal<ScheduleView | null>(null);
  protected readonly executions = signal<ScheduleExecutionView[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private request: Subscription | null = null;

  private readonly translate: Translate = (key, params) => this.transloco.translate(key, params);

  protected readonly rows = computed<ExecutionRow[]>(() => {
    const names = new Map((this.schedule()?.items ?? []).map((item) => [item.assetUuid, this.itemName(item)]));
    return this.executions().map((execution) => {
      const detail = (execution.detail ?? {}) as {
        items?: ItemResult[];
        waitingForRun?: number;
        deletedGenerationRunId?: number;
      };
      return {
        execution,
        items: (detail.items ?? []).map((item) => ({
          name: names.get(item.assetUuid) || this.t('page.untitled'),
          locale: item.locale ? localeTag(item.locale) : '',
          result: this.resultLabel(item.result),
          reason: item.reason ?? '',
        })),
        waitingForRun: typeof detail.waitingForRun === 'number' ? detail.waitingForRun : null,
        deletedRun: typeof detail.deletedGenerationRunId === 'number' ? detail.deletedGenerationRunId : null,
      };
    });
  });

  /** The full title: which kind of schedule and what it does, once the schedule is read. */
  protected readonly title = computed(() => {
    const schedule = this.schedule();
    return schedule
      ? this.t('history.title', {
          kind: this.transloco.translate(`release.schedule.kinds.${schedule.type}`),
          what: scheduleWhatText(schedule, this.translate, this.dev()),
        })
      : this.t('history.titlePending');
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const id = this.scheduleId();
      this.events.version();
      untracked(() => this.load(key, id));
    });
  }

  protected formatInstant = formatInstant;

  protected statusName(schedule: ScheduleView): string {
    return this.t(`statuses.${scheduleStatusKey(schedule)}`);
  }

  protected tone(schedule: ScheduleView): SfStatusTone {
    return STATUS_TONES[scheduleStatusKey(schedule)] ?? 'neutral';
  }

  protected outcomeTone(outcome: string | null | undefined): SfStatusTone {
    return OUTCOME_TONES[outcome ?? ''] ?? 'neutral';
  }

  protected outcomeName(outcome: string | null | undefined): string {
    return outcome ? this.t(`outcomes.${outcome}`) : this.t('history.inProgress');
  }

  /** An item by name; its UID only in developer mode, never its UUID. */
  protected itemName(item: { displayName?: string; uid?: string }): string {
    return item.displayName || (this.dev() ? item.uid : '') || this.t('page.untitled');
  }

  protected nextRun(schedule: ScheduleView): string {
    const when = schedule.nextRunAt ?? (schedule.status === 'PENDING' ? schedule.runAt : null);
    return when ? formatInstantWithZone(when, schedule.zoneId) : '—';
  }

  protected version(schedule: ScheduleView): string {
    return this.t(`history.${schedule.pinPolicy === 'LATEST' ? 'latest' : 'pinned'}`);
  }

  protected ifMissed(schedule: ScheduleView): string {
    if (schedule.missedPolicy !== 'SKIP_IF_LATER_THAN') {
      return this.t('history.runLate');
    }
    const { value, unit } = latenessFromIso(schedule.maxLateness);
    return this.t('history.skipAfter', { late: this.t(`duration.${unit}`, { count: value }) });
  }

  protected late(ms: number | null | undefined): string {
    return formatDuration(ms);
  }

  protected reload(): void {
    this.load(this.projectKey(), this.scheduleId());
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`schedules.${key}`, params);
  }

  private resultLabel(result: string | undefined): string {
    return result && RESULTS.includes(result) ? this.t(`history.results.${result}`) : (result ?? '');
  }

  private load(projectKey: string, id: number): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = forkJoin({
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
        this.error.set(problemOf(err, this.t('history.loadFailed')).detail);
      },
    });
  }
}
