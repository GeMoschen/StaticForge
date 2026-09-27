import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, forkJoin, repeat, switchMap, takeWhile, timer } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import { viewerZone } from '../schedules/zoned-time.util';
import { AdminJobRunReportComponent } from './admin-job-run-report.component';
import {
  AdminJobRunView,
  AdminJobView,
  JOB_RUN_POLL_MS,
  JobFormErrors,
  NO_JOB_ERRORS,
  SettingField,
  SettingValue,
  cronError,
  durationText,
  jobFormOf,
  jobInstant,
  jobUpdate,
  mapJobErrors,
  outcomeChipClass,
  outcomeLabel,
  runDuration,
  scheduleText,
  settingError,
  settingFields,
  triggerLabel,
  viewerTime,
  zoneOptions,
} from './admin-jobs.util';

type PageMeta = components['schemas']['PageMeta'];

export const JOB_HISTORY_PAGE_SIZE = 20;

/**
 * Administration → one system job (M29.5.1, epic decisions 3–7): schedule and settings form (Save gated on dirty +
 * valid, `If-Match` conflicts reload, reset to the property defaults), *Run now* / *Dry run* with the run polled to
 * its report, and the server-paged run history whose rows expand to their report.
 *
 * The cron is described in words; the next run is the server's `nextRunAt` (shown again after a save) — there is no
 * second cron parser in the client.
 */
@Component({
  selector: 'sf-admin-job-detail',
  standalone: true,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfFieldComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfFileSizePipe,
    AdminJobRunReportComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-job-detail.component.html',
  styleUrl: './admin-job-detail.component.scss',
})
export class AdminJobDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pollMs = inject(JOB_RUN_POLL_MS);

  /** The `:key` route parameter. */
  readonly key = input.required<string>();

  protected readonly scheduleText = scheduleText;
  protected readonly jobInstant = jobInstant;
  protected readonly viewerTime = viewerTime;
  protected readonly durationText = durationText;
  protected readonly outcomeLabel = outcomeLabel;
  protected readonly outcomeChipClass = outcomeChipClass;
  protected readonly triggerLabel = triggerLabel;
  protected readonly runDuration = runDuration;
  /** The viewer's zone, named wherever the page shows a time. */
  protected readonly viewerZone = viewerZone();

  protected readonly job = signal<AdminJobView | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly orphaned = computed(() => this.job()?.orphaned === true);
  protected readonly fields = computed<SettingField[]>(() => settingFields(this.job()));
  protected readonly zones = computed(() =>
    zoneOptions(this.job()?.zone, this.job()?.defaults?.zone, this.viewerZone),
  );

  // ── form ──
  protected readonly enabled = signal(false);
  protected readonly cron = signal('');
  protected readonly zone = signal('');
  protected readonly settings = signal<Record<string, SettingValue>>({});
  protected readonly serverErrors = signal<JobFormErrors>(NO_JOB_ERRORS);
  protected readonly conflict = signal(false);
  protected readonly saving = signal(false);
  protected readonly resetting = signal(false);

  protected readonly cronProblem = computed(() => cronError(this.cron()));
  protected readonly zoneProblem = computed(() => (this.zone().trim() === '' ? 'Pick a time zone.' : null));
  protected readonly settingProblems = computed(() => {
    const values = this.settings();
    return Object.fromEntries(this.fields().map((field) => [field.key, settingError(field, values[field.key])]));
  });
  protected readonly valid = computed(
    () =>
      this.cronProblem() === null &&
      this.zoneProblem() === null &&
      Object.values(this.settingProblems()).every((problem) => problem === null),
  );
  private readonly update = computed(() =>
    jobUpdate(this.job(), this.fields(), {
      enabled: this.enabled(),
      cron: this.cron(),
      zone: this.zone(),
      settings: this.settings(),
    }),
  );
  protected readonly dirty = computed(() => this.update() !== null);
  protected readonly cronPreview = computed(() => scheduleText(this.cron(), this.zone()));

  // ── runs ──
  /** The run this page started, or found running, polled until it has finished. */
  protected readonly activeRun = signal<AdminJobRunView | null>(null);
  protected readonly watching = signal(false);
  protected readonly starting = signal(false);
  protected readonly canRun = computed(
    () => !this.orphaned() && this.job()?.running !== true && !this.watching() && !this.starting(),
  );
  private poll?: Subscription;

  // ── history ──
  protected readonly runs = signal<AdminJobRunView[]>([]);
  protected readonly runsMeta = signal<PageMeta | null>(null);
  protected readonly runsLoading = signal(true);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
    effect(() => {
      const key = this.key();
      untracked(() => this.open(key));
    });
  }

  // ── form ──

  protected setEnabled(value: boolean): void {
    this.enabled.set(value);
  }

  protected setCron(value: string): void {
    this.cron.set(value);
    this.serverErrors.update((errors) => ({ ...errors, cron: [] }));
  }

  protected setZone(value: string): void {
    this.zone.set(value);
    this.serverErrors.update((errors) => ({ ...errors, zone: [] }));
  }

  protected setSetting(key: string, value: SettingValue): void {
    this.settings.update((values) => ({ ...values, [key]: value }));
    this.serverErrors.update((errors) => ({ ...errors, settings: { ...errors.settings, [key]: [] } }));
  }

  protected settingServerErrors(key: string): string[] {
    return this.serverErrors().settings[key] ?? [];
  }

  protected save(): void {
    const job = this.job();
    const body = this.update();
    if (!job?.key || job.version == null || !body || !this.valid() || this.saving() || this.orphaned()) {
      return;
    }
    this.saving.set(true);
    this.conflict.set(false);
    this.serverErrors.set(NO_JOB_ERRORS);
    this.api.adminUpdateJob(job.key, job.version, body).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.show(updated, true);
        const next = updated.enabled && updated.nextRunAt ? ` Next run: ${viewerTime(updated.nextRunAt)}.` : '';
        this.toasts.show(`Saved.${next}`, 'success');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, 'The job could not be saved.');
        if (problem.status === 409 && problem.code !== 'SF-DOM-0181') {
          // Stale If-Match: someone else saved first. Show theirs; the edits here are gone.
          this.conflict.set(true);
          this.reload(true);
        } else if (problem.status === 422) {
          this.serverErrors.set(
            mapJobErrors(
              problem.errors.length > 0 ? problem.errors : [problem.detail],
              this.fields().map((field) => field.key),
            ),
          );
        } else {
          this.serverErrors.set({ ...NO_JOB_ERRORS, general: [problem.detail] });
        }
      },
    });
  }

  protected discard(): void {
    const job = this.job();
    if (job) {
      this.show(job, true);
    }
  }

  protected resetToDefaults(): void {
    const job = this.job();
    if (!job?.key || this.orphaned() || this.resetting()) {
      return;
    }
    const lost = this.dirty() ? ' Your unsaved edits are discarded too.' : '';
    if (!window.confirm(`Reset “${job.name ?? job.key}” to its default schedule and settings?${lost}`)) {
      return;
    }
    this.resetting.set(true);
    this.api.adminResetJob(job.key).subscribe({
      next: (updated) => {
        this.resetting.set(false);
        this.conflict.set(false);
        this.show(updated, true);
        this.toasts.show('Reset to the defaults.', 'success');
      },
      error: () => this.resetting.set(false),
    });
  }

  // ── runs ──

  protected runNow(dryRun: boolean): void {
    const job = this.job();
    if (!job?.key || !this.canRun() || (dryRun && !job.supportsDryRun)) {
      return;
    }
    const key = job.key;
    this.starting.set(true);
    this.api.adminRunJob(key, dryRun).subscribe({
      next: (run) => {
        this.starting.set(false);
        this.activeRun.set(run);
        if (run.id != null) {
          this.watch(key, run.id);
        }
      },
      error: () => {
        // Already running (409) or no longer installed (404): the interceptor says so; show the current state.
        this.starting.set(false);
        this.reload(false);
      },
    });
  }

  // ── history ──

  protected goTo(page: number): void {
    const key = this.job()?.key;
    if (key) {
      this.loadRuns(key, page);
    }
  }

  protected toggle(id: number | undefined): void {
    if (id == null) {
      return;
    }
    const next = new Set(this.expanded());
    if (!next.delete(id)) {
      next.add(id);
    }
    this.expanded.set(next);
  }

  // ── loading ──

  private open(key: string): void {
    this.poll?.unsubscribe();
    this.watching.set(false);
    this.activeRun.set(null);
    this.job.set(null);
    this.loadError.set(null);
    this.conflict.set(false);
    this.serverErrors.set(NO_JOB_ERRORS);
    this.expanded.set(new Set());
    this.api.adminJob(key).subscribe({
      next: (job) => {
        this.show(job, true);
        if (job.running && job.currentRunId != null) {
          this.watch(key, job.currentRunId);
        }
      },
      error: (err: unknown) => this.loadError.set(problemOf(err, 'The job could not be loaded.').detail),
    });
    this.loadRuns(key, 0);
  }

  /** Re-reads the job; the form follows only when asked to, or when it holds no edits. */
  private reload(resetForm: boolean): void {
    const key = this.job()?.key ?? this.key();
    this.api.adminJob(key).subscribe({
      next: (job) => this.show(job, resetForm || !this.dirty()),
      error: () => undefined,
    });
  }

  private show(job: AdminJobView, resetForm: boolean): void {
    this.job.set(job);
    if (resetForm) {
      const form = jobFormOf(job, settingFields(job));
      this.enabled.set(form.enabled);
      this.cron.set(form.cron);
      this.zone.set(form.zone);
      this.settings.set(form.settings);
      this.serverErrors.set(NO_JOB_ERRORS);
    }
  }

  /** Polls the run (and the job, for its progress line) until the run has finished; stops when the page goes. */
  private watch(key: string, runId: number): void {
    this.poll?.unsubscribe();
    this.watching.set(true);
    this.poll = timer(this.pollMs)
      .pipe(
        switchMap(() => forkJoin({ run: this.api.adminJobRun(key, runId), job: this.api.adminJob(key) })),
        repeat(),
        takeWhile(({ run }) => !run.finishedAt, true),
      )
      .subscribe({
        next: ({ run, job }) => {
          this.activeRun.set(run);
          if (!run.finishedAt) {
            this.show(job, !this.dirty());
            return;
          }
          this.watching.set(false);
          this.reload(false);
          this.loadRuns(key, 0);
        },
        error: () => {
          this.watching.set(false);
          this.reload(false);
        },
      });
  }

  private loadRuns(key: string, page: number): void {
    this.runsLoading.set(true);
    this.api.adminJobRuns(key, page, JOB_HISTORY_PAGE_SIZE).subscribe({
      next: (result) => {
        this.runs.set(result.content ?? []);
        this.runsMeta.set(result.page ?? null);
        this.runsLoading.set(false);
      },
      error: () => this.runsLoading.set(false),
    });
  }
}
