import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { UnsavedChangesService } from '../../../../shared/components/dialog/unsaved-changes.service';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfDateInputComponent } from '../../../../shared/components/forms/sf-date-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSaveState, SfSaveStatusComponent } from '../../../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../../../shared/components/layout/sf-section.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { minutesAgo } from '../changes/sample-area.util';
import {
  JOB_FREQUENCIES,
  JobFrequency,
  JobRun,
  JobSchedule,
  OUTCOME_ICONS,
  OUTCOME_TONES,
  WEEKDAYS,
  Weekday,
  cronOf,
  jobByKey,
  runsOf,
} from './admin-data';
import { AdminState } from './admin-state';

const ZONES = ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York'] as const;

/**
 * Administration › Jobs › a job (M35.16): the job's name with its state, **Run now** and **Dry run** (secondary — a dry
 * run reports what would change), the schedule as a small form (how often, at what time, which weekday, which time zone,
 * enabled; explicit save with the save status; the cron expression only in developer mode) and the run history in an
 * `sf-data-table` with a pager. A history row opens its report: what was checked, changed and found. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-admin-job-detail',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDateInputComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSaveStatusComponent,
    SfSectionComponent,
    SfSelectComponent,
    SfStatusComponent,
    SfSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-job-detail.component.html',
  styleUrl: './sample-admin-job-detail.component.scss',
})
export class SampleAdminJobDetailComponent {
  readonly jobKey = input.required<string>();

  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly tones = OUTCOME_TONES;
  protected readonly icons = OUTCOME_ICONS;
  protected readonly job = computed(() => this.admin.job(jobByKey(this.jobKey())!));
  protected readonly dev = this.admin.sample.developerMode;

  // ── Settings draft ─────────────────────────────────────────────────────────
  protected readonly frequency = signal<JobFrequency>('daily');
  protected readonly time = signal<string | null>('03:00');
  protected readonly weekday = signal<Weekday>('mon');
  protected readonly zone = signal<string>('UTC');
  protected readonly enabled = signal(true);
  protected readonly attempted = signal(false);
  private readonly loaded = signal(false);

  private readonly draft = computed<JobSchedule>(() => ({ frequency: this.frequency(), time: this.time() ?? '', weekday: this.weekday(), zone: this.zone() }));
  protected readonly dirty = computed(() => {
    const j = this.job();
    const d = this.draft();
    const s = j.schedule;
    return this.loaded() && (d.frequency !== s.frequency || d.time !== s.time || d.weekday !== s.weekday || d.zone !== s.zone || this.enabled() !== j.enabled);
  });
  protected readonly timeError = computed(() => (this.attempted() && this.time() === null ? this.t('job.timeInvalid') : null));
  protected readonly saveState = computed<SfSaveState>(() => (this.timeError() ? 'error' : this.dirty() ? 'dirty' : 'saved'));
  protected readonly cron = computed(() => cronOf(this.time() ? this.draft() : this.job().schedule));
  protected readonly preview = computed(() => this.admin.scheduleText(this.time() ? this.draft() : this.job().schedule));

  protected readonly frequencyOptions = computed<SfSelectOption<JobFrequency>[]>(() => JOB_FREQUENCIES.map((value) => ({ value, label: this.t(`job.frequencies.${value}`) })));
  protected readonly weekdayOptions = computed<SfSelectOption<Weekday>[]>(() => WEEKDAYS.map((value) => ({ value, label: this.t(`weekdays.${value}`) })));
  protected readonly zoneOptions: SfSelectOption<string>[] = ZONES.map((value) => ({ value, label: value }));

  // ── History ────────────────────────────────────────────────────────────────
  private readonly started = signal<readonly JobRun[]>([]);
  protected readonly runs = computed(() => (this.admin.review() !== 'live' ? [] : [...this.started(), ...runsOf(this.job())]));
  protected readonly error = computed(() => (this.admin.review() === 'error' ? this.t('job.historyError') : null));
  protected readonly report = signal<JobRun | null>(null);

  protected readonly columns = computed<SfDataTableColumn<JobRun>[]>(() => {
    const header = (id: string) => this.t(`job.columns.${id}`);
    return [
      { id: 'started', header: header('started'), value: (r) => r.minutes, sortable: true, hideable: false, width: 160 },
      { id: 'trigger', header: header('trigger'), value: (r) => r.trigger, sortable: true, width: 120 },
      { id: 'outcome', header: header('outcome'), value: (r) => r.outcome, sortable: true, width: 190 },
      { id: 'duration', header: header('duration'), value: (r) => r.durationSeconds, sortable: true, align: 'end', width: 110 },
      { id: 'affected', header: header('affected'), value: (r) => r.affected, sortable: true, align: 'end', width: 110 },
      { id: 'freed', header: header('freed'), value: (r) => r.freedMb, sortable: true, align: 'end', width: 100 },
      { id: 'by', header: header('by'), value: (r) => r.by ?? '', width: 150 },
    ];
  });
  protected readonly rowKey = (run: JobRun) => run.id;
  protected readonly rowLabel = (run: JobRun) => this.t('job.runLabel', { outcome: this.t(`outcomes.${run.outcome}`) });

  constructor() {
    effect(() => {
      const j = this.job();
      untracked(() => this.load(j.schedule, j.enabled));
    });
    const unregister = this.admin.sample.registerGuard(async () => {
      if (!this.dirty()) {
        return true;
      }
      return this.unsaved.confirmLeave({
        name: this.job().name,
        save: async () => {
          this.save();
          return this.timeError() ? { ok: false, message: this.t('job.timeInvalid') } : { ok: true };
        },
        discard: () => this.discard(),
      });
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  private load(schedule: JobSchedule, enabled: boolean): void {
    this.frequency.set(schedule.frequency);
    this.time.set(schedule.time);
    this.weekday.set(schedule.weekday);
    this.zone.set(schedule.zone);
    this.enabled.set(enabled);
    this.attempted.set(false);
    this.loaded.set(true);
  }

  protected save(): void {
    this.attempted.set(true);
    if (this.time() === null) {
      return;
    }
    const key = this.jobKey();
    this.admin.jobSchedules.update((all) => ({ ...all, [key]: this.draft() }));
    this.admin.jobEnabled.update((all) => ({ ...all, [key]: this.enabled() }));
    this.admin.notice(this.t('job.saved'));
  }

  protected discard(): void {
    const j = this.job();
    this.load(j.schedule, j.enabled);
  }

  /** *Run now* and *Dry run* add a finished run at the top of the history. */
  protected run(dryRun: boolean): void {
    const job = this.job();
    this.started.update((all) => [
      {
        id: `${job.key}-new-${all.length}`,
        minutes: 0,
        trigger: 'manual',
        dryRun,
        outcome: 'succeeded',
        durationSeconds: 3,
        affected: dryRun ? 0 : 12,
        freedMb: dryRun ? 0 : 4,
        by: 'Ada Lovelace',
        summary: [
          { key: 'checked', count: 312 },
          { key: 'changed', count: dryRun ? 0 : 12 },
          { key: 'problems', count: 0 },
        ],
      },
      ...all,
    ]);
    this.admin.notice(this.t(dryRun ? 'job.dryRunDone' : 'job.runDone', { name: job.name }));
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.admin.now);
  }

  protected duration(seconds: number): string {
    if (seconds === 0) {
      return '—';
    }
    return seconds < 60 ? this.t('job.seconds', { s: seconds }) : this.t('job.minutes', { m: Math.floor(seconds / 60), s: seconds % 60 });
  }
}
