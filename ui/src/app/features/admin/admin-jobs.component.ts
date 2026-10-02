import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { Subscription, timer } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { problemOf } from '../../core/api/problem.util';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfTableIdentityComponent } from '../../shared/components/data-table/sf-table-identity.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import {
  AdminJobView,
  JOB_LIST_REFRESH_MS,
  OUTCOME_ICONS,
  OUTCOME_TONES,
  jobInstant,
  scheduleText,
} from './admin-jobs.util';

/**
 * Administration → Jobs (M29.5.1, M35.16; epic decisions 3–7): the instance's system jobs as an `sf-data-table` — the job
 * (name over its description), an enabled switch, the schedule in words (the raw cron only as a tooltip), the next and the
 * last run with a human outcome. A row opens the job; its ⋮ menu has *Edit schedule* (the same) and *Run now*. A job whose
 * code is gone is muted and read-only. While a job runs the list re-reads itself.
 */
@Component({
  selector: 'sf-admin-jobs',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfSwitchComponent,
    SfTableIdentityComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-jobs.component.html',
  styleUrl: './admin-jobs.component.scss',
})
export class AdminJobsComponent {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly refreshMs = inject(JOB_LIST_REFRESH_MS);

  protected readonly scheduleText = scheduleText;
  protected readonly tones = OUTCOME_TONES;
  protected readonly icons = OUTCOME_ICONS;

  protected readonly jobs = signal<readonly AdminJobView[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Keys of jobs whose enabled switch is being saved. */
  protected readonly saving = signal<ReadonlySet<string>>(new Set());

  protected readonly rows = computed(() => this.jobs() ?? []);
  protected readonly loading = computed(() => this.jobs() === null && this.loadError() === null);

  protected readonly columns = computed<SfDataTableColumn<AdminJobView>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      { id: 'job', header: header('job'), value: (j) => this.label(j), sortable: true, hideable: false, width: 360 },
      { id: 'enabled', header: header('enabled'), value: (j) => (j.enabled ? 1 : 0), sortable: true, width: 110 },
      { id: 'schedule', header: header('schedule'), value: (j) => scheduleText(j.cron, j.zone), width: 250 },
      { id: 'next', header: header('next'), value: (j) => (j.enabled ? (j.nextRunAt ?? '') : ''), sortable: true, width: 150 },
      { id: 'last', header: header('last'), value: (j) => j.lastRun?.finishedAt ?? j.lastRun?.startedAt ?? '', sortable: true, width: 260 },
      { id: 'actions', header: header('actions'), width: 72, hideable: false },
    ];
  });

  protected readonly rowKey = (job: AdminJobView) => job.key ?? '';
  protected readonly rowLabel = (job: AdminJobView) => this.label(job);

  private refresh?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.refresh?.unsubscribe());
    this.load();
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`admin.jobs.${key}`, params);
  }

  protected outcome(outcome: string | null | undefined): string {
    return this.transloco.translate(`enum.jobState.${outcome ?? 'RUNNING'}`);
  }

  protected label(job: AdminJobView): string {
    return job.name ?? job.key ?? '';
  }

  /** The next run as a tooltip: the viewer's time, plus the job's zone where it differs. */
  protected nextTitle(job: AdminJobView): string {
    const next = jobInstant(job.nextRunAt, job.zone);
    return next.job ? `${next.viewer} · ${next.job}` : next.viewer;
  }

  protected menuItems(job: AdminJobView): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('menu.edit'), icon: 'edit' },
      { id: 'run', label: this.t('menu.run'), icon: 'play_arrow', disabled: job.orphaned === true || job.running === true },
    ];
  }

  protected open(job: AdminJobView): void {
    if (job.key) {
      void this.router.navigate(['/admin/jobs', job.key]);
    }
  }

  protected onMenu(job: AdminJobView, item: SfMenuItem): void {
    if (item.id === 'edit') {
      this.open(job);
    } else if (item.id === 'run' && job.key) {
      this.api.adminRunJob(job.key, false).subscribe({
        next: () => {
          this.toasts.show(this.t('runStarted', { name: this.label(job) }), 'success');
          this.load();
        },
        // Already running (409) or no longer installed (404): the error interceptor says so.
        error: () => this.load(),
      });
    }
  }

  protected toggle(job: AdminJobView, enabled: boolean): void {
    const key = job.key;
    if (!key || job.orphaned || job.version == null || this.saving().has(key)) {
      return;
    }
    this.setSaving(key, true);
    this.api.adminUpdateJob(key, job.version, { enabled }).subscribe({
      next: (updated) => {
        this.setSaving(key, false);
        this.replace(updated);
        this.toasts.show(this.t(updated.enabled ? 'enabled' : 'disabled', { name: this.label(updated) }), 'success');
      },
      error: (err: unknown) => {
        this.setSaving(key, false);
        const problem = problemOf(err, this.t('changeFailed'));
        this.toasts.show(problem.status === 409 ? this.t('changedMeanwhile') : problem.detail, 'error');
        // The list is read again, which also puts the switch back.
        this.load();
      },
    });
  }

  protected load(): void {
    this.refresh?.unsubscribe();
    this.loadError.set(null);
    this.api.adminJobs().subscribe({
      next: (jobs) => {
        this.jobs.set(jobs);
        if (jobs.some((job) => job.running)) {
          this.refresh = timer(this.refreshMs).subscribe(() => this.load());
        }
      },
      error: (err: unknown) => this.loadError.set(problemOf(err, this.t('error')).detail),
    });
  }

  private replace(updated: AdminJobView): void {
    this.jobs.update((jobs) => (jobs ?? []).map((job) => (job.key === updated.key ? updated : job)));
  }

  private setSaving(key: string, on: boolean): void {
    const next = new Set(this.saving());
    if (on) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.saving.set(next);
  }
}
