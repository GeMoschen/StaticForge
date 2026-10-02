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
import { TranslocoService } from '@jsverse/transloco';
import { Subscription, firstValueFrom, forkJoin, repeat, switchMap, takeWhile, timer } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { EditorError, EditorStateService, saveStateOf } from '../../core/editor/editor-state';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { type SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfComboboxComponent, SfComboboxOption } from '../../shared/components/forms/sf-combobox.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfTooltipDirective } from '../../shared/directives/sf-tooltip.directive';
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
  OUTCOME_ICONS,
  OUTCOME_TONES,
  runDuration,
  scheduleText,
  settingError,
  settingFields,
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
    AdminJobRunReportComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfComboboxComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfFileSizePipe,
    SfInputComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSaveStatusComponent,
    SfSectionComponent,
    SfSkeletonComponent,
    SfSpinnerComponent,
    SfStatusComponent,
    SfSwitchComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-job-detail.component.html',
  styleUrl: './admin-job-detail.component.scss',
})
export class AdminJobDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly confirms = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pollMs = inject(JOB_RUN_POLL_MS);

  /** The `:key` route parameter. */
  readonly key = input.required<string>();

  protected readonly scheduleText = scheduleText;
  protected readonly jobInstant = jobInstant;
  protected readonly viewerTime = viewerTime;
  protected readonly durationText = durationText;
  protected readonly runDuration = runDuration;
  protected readonly tones = OUTCOME_TONES;
  protected readonly icons = OUTCOME_ICONS;
  /** The viewer's zone, named wherever the page shows a time. */
  protected readonly viewerZone = viewerZone();

  protected readonly job = signal<AdminJobView | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly orphaned = computed(() => this.job()?.orphaned === true);
  protected readonly fields = computed<SettingField[]>(() => settingFields(this.job()));
  protected readonly zoneChoices = computed<SfComboboxOption<string>[]>(() =>
    zoneOptions(this.job()?.zone, this.job()?.defaults?.zone, this.viewerZone).map((zone) => ({ value: zone, label: zone })),
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
  /** The clock time of the last save from this page ("12:04"). */
  protected readonly savedAt = signal<string | null>(null);

  protected readonly cronProblem = computed(() => cronError(this.cron()));
  protected readonly zoneProblem = computed(() => (this.zone().trim() === '' ? this.t('detail.pickZone') : null));
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
  /** Why the last save was refused (the editor contract's `error`). */
  private readonly saveError = signal<EditorError | null>(null);
  protected readonly saveState = computed(() => saveStateOf({ dirty: this.dirty, saving: this.saving, error: this.saveError }));
  /** The problems the form shows right now, counted for the save status. */
  protected readonly problemCount = computed(
    () =>
      (this.cronProblem() ? 1 : 0) +
      (this.zoneProblem() ? 1 : 0) +
      Object.values(this.settingProblems()).filter((problem) => problem !== null).length,
  );

  protected readonly moreActions = computed<SfMenuItem[]>(() =>
    this.orphaned() ? [] : [{ id: 'reset', label: this.t('detail.reset'), icon: 'restart_alt', disabled: this.resetting() || this.saving() }],
  );

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
  protected readonly runsFailed = signal(false);
  /** The run whose report is open in the dialog. */
  protected readonly report = signal<AdminJobRunView | null>(null);

  protected readonly historyColumns = computed<SfDataTableColumn<AdminJobRunView>[]>(() => {
    const header = (id: string) => this.t(`detail.columns.${id}`);
    return [
      { id: 'started', header: header('started'), value: (r) => r.startedAt ?? '', width: 150, hideable: false },
      { id: 'trigger', header: header('trigger'), value: (r) => r.trigger ?? '', width: 120 },
      { id: 'outcome', header: header('outcome'), value: (r) => r.outcome ?? '', width: 200 },
      { id: 'duration', header: header('duration'), value: (r) => r.durationMs ?? 0, width: 110 },
      { id: 'affected', header: header('affected'), value: (r) => r.itemsAffected ?? 0, align: 'end', width: 110 },
      { id: 'freed', header: header('freed'), value: (r) => r.bytesFreed ?? 0, align: 'end', width: 110 },
      { id: 'by', header: header('by'), value: (r) => r.startedBy?.username ?? '', width: 160 },
    ];
  });
  protected readonly runKey = (run: AdminJobRunView) => String(run.id ?? '');
  protected readonly runLabel = (run: AdminJobRunView) => viewerTime(run.startedAt);

  constructor() {
    this.destroyRef.onDestroy(() => this.poll?.unsubscribe());
    // The open job is an editor for the frame (M35.13): Ctrl+S saves it, and leaving it with unsaved edits asks first.
    const unregister = inject(ActiveEditorService).register(this.editorState());
    this.destroyRef.onDestroy(unregister);
    // The breadcrumb ends with the open job.
    useFrameItem(() => {
      const job = this.job();
      return job ? { label: job.name ?? job.key ?? '' } : null;
    });
    effect(() => {
      const key = this.key();
      untracked(() => this.open(key));
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`admin.jobs.${key}`, params);
  }

  protected outcome(outcome: string | null | undefined): string {
    return this.transloco.translate(`enum.jobState.${outcome ?? 'RUNNING'}`);
  }

  protected trigger(trigger: string | null | undefined): string {
    return trigger ? this.transloco.translate(`enum.jobTrigger.${trigger}`) : '';
  }

  protected who(run: AdminJobRunView): string {
    return run.startedBy
      ? (run.startedBy.username ?? this.t('detail.userNumber', { id: run.startedBy.id }))
      : this.t('detail.bySchedule');
  }

  protected settingLabelOf(field: SettingField): string {
    return field.label;
  }

  protected defaultNote(field: SettingField): string | null {
    if (field.defaultText === null) {
      return null;
    }
    const value = field.kind === 'boolean' ? this.t(field.defaultText === 'true' ? 'detail.defaultOn' : 'detail.defaultOff') : field.defaultText;
    return this.t('detail.defaultHint', { value });
  }

  protected fieldHint(field: SettingField): string | undefined {
    const parts = [field.kind === 'duration' ? this.t('detail.durationHint') : '', this.defaultNote(field) ?? ''].filter((p) => p !== '');
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  protected fieldError(field: SettingField): string | null {
    return this.settingProblems()[field.key] ?? this.settingServerErrors(field.key)[0] ?? null;
  }

  // ── form ──

  protected setCron(value: string): void {
    this.cron.set(value);
    this.serverErrors.update((errors) => ({ ...errors, cron: [] }));
  }

  protected setZone(value: string | string[] | null): void {
    this.zone.set(typeof value === 'string' ? value : '');
    this.serverErrors.update((errors) => ({ ...errors, zone: [] }));
  }

  protected setSetting(key: string, value: SettingValue): void {
    this.settings.update((values) => ({ ...values, [key]: value }));
    this.serverErrors.update((errors) => ({ ...errors, settings: { ...errors.settings, [key]: [] } }));
  }

  protected settingServerErrors(key: string): string[] {
    return this.serverErrors().settings[key] ?? [];
  }

  protected cronError(): string | null {
    return this.cronProblem() ?? this.serverErrors().cron[0] ?? null;
  }

  protected zoneError(): string | null {
    return this.zoneProblem() ?? this.serverErrors().zone[0] ?? null;
  }

  protected save(): void {
    void this.doSave();
  }

  /** Saves the form; the result says whether it was written (the unsaved-changes dialog and Ctrl+S read it). */
  private doSave(): Promise<SaveResult> {
    const job = this.job();
    const body = this.update();
    if (!job?.key || job.version == null || !body || this.saving() || this.orphaned()) {
      return Promise.resolve({ ok: true });
    }
    if (!this.valid()) {
      const message = this.t('detail.problems');
      this.saveError.set({ message, count: this.problemCount() });
      return Promise.resolve({ ok: false, message });
    }
    this.saving.set(true);
    this.conflict.set(false);
    this.saveError.set(null);
    this.serverErrors.set(NO_JOB_ERRORS);
    return firstValueFrom(this.api.adminUpdateJob(job.key, job.version, body)).then(
      (updated): SaveResult => {
        this.saving.set(false);
        this.show(updated, true);
        this.savedAt.set(clockTime());
        this.toasts.show(
          updated.enabled && updated.nextRunAt
            ? this.t('detail.savedNext', { time: viewerTime(updated.nextRunAt) })
            : this.t('detail.saved'),
          'success',
        );
        return { ok: true };
      },
      (err: unknown): SaveResult => {
        this.saving.set(false);
        const problem = problemOf(err, this.t('detail.saveFailed'));
        let message = problem.detail;
        if (problem.status === 409 && problem.code !== 'SF-DOM-0181') {
          // Stale If-Match: someone else saved first. Show theirs; the edits here are gone.
          this.conflict.set(true);
          message = this.t('detail.conflict');
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
        this.saveError.set({ message });
        return { ok: false, message };
      },
    );
  }

  protected discard(): void {
    const job = this.job();
    if (job) {
      this.show(job, true);
      this.saveError.set(null);
    }
  }

  protected async onMenu(item: SfMenuItem): Promise<void> {
    if (item.id === 'reset') {
      await this.resetToDefaults();
    }
  }

  protected async resetToDefaults(): Promise<void> {
    const job = this.job();
    if (!job?.key || this.orphaned() || this.resetting()) {
      return;
    }
    const name = job.name ?? job.key;
    const confirmed = await this.confirms.confirm({
      title: this.t('detail.resetTitle', { name }),
      message: this.t('detail.resetMessage') + (this.dirty() ? ' ' + this.t('detail.resetLost') : ''),
      confirmLabel: this.t('detail.reset'),
    });
    if (!confirmed) {
      return;
    }
    this.resetting.set(true);
    this.api.adminResetJob(job.key).subscribe({
      next: (updated) => {
        this.resetting.set(false);
        this.conflict.set(false);
        this.saveError.set(null);
        this.show(updated, true);
        this.toasts.show(this.t('detail.resetDone'), 'success');
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

  protected retryRuns(): void {
    this.loadRuns(this.job()?.key ?? this.key(), this.runsMeta()?.number ?? 0);
  }

  protected retry(): void {
    this.open(this.key());
  }

  // ── loading ──

  private editorState(): EditorStateService {
    return {
      name: computed(() => this.job()?.name ?? this.job()?.key ?? ''),
      dirty: this.dirty,
      saving: this.saving,
      lastSaved: this.savedAt,
      error: this.saveError,
      autosave: false,
      save: () => this.doSave(),
      discard: async () => this.discard(),
    };
  }

  private open(key: string): void {
    this.poll?.unsubscribe();
    this.watching.set(false);
    this.activeRun.set(null);
    this.job.set(null);
    this.loadError.set(null);
    this.conflict.set(false);
    this.saveError.set(null);
    this.serverErrors.set(NO_JOB_ERRORS);
    this.api.adminJob(key).subscribe({
      next: (job) => {
        this.show(job, true);
        if (job.running && job.currentRunId != null) {
          this.watch(key, job.currentRunId);
        }
      },
      error: (err: unknown) => this.loadError.set(problemOf(err, this.t('detail.loadFailed')).detail),
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
    this.runsFailed.set(false);
    this.api.adminJobRuns(key, page, JOB_HISTORY_PAGE_SIZE).subscribe({
      next: (result) => {
        this.runs.set(result.content ?? []);
        this.runsMeta.set(result.page ?? null);
        this.runsLoading.set(false);
      },
      error: () => {
        this.runsFailed.set(true);
        this.runsLoading.set(false);
      },
    });
  }
}

/** "12:04": the clock time of a save. */
function clockTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
