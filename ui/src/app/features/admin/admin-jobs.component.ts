import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { problemOf } from '../../core/api/problem.util';
import { ToastService } from '../../core/ui/toast.service';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import {
  AdminJobView,
  JOB_LIST_REFRESH_MS,
  jobInstant,
  outcomeChipClass,
  outcomeLabel,
  runDuration,
  scheduleText,
  viewerTime,
} from './admin-jobs.util';

/**
 * Administration → Jobs (M29.5.1, epic decisions 3–7): the instance's system jobs with their schedule in words (raw
 * cron as a tooltip), next and last run, and an enabled switch. Times are in the viewer's zone, labelled, plus the
 * job's zone where it differs. Orphaned jobs (a row whose code is gone) are listed greyed, read-only. While a job
 * runs the list re-reads itself.
 */
@Component({
  selector: 'sf-admin-jobs',
  standalone: true,
  imports: [RouterLink, SfFileSizePipe, SfSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-jobs.component.html',
  styleUrl: './admin-jobs.component.scss',
})
export class AdminJobsComponent {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly refreshMs = inject(JOB_LIST_REFRESH_MS);

  protected readonly scheduleText = scheduleText;
  protected readonly jobInstant = jobInstant;
  protected readonly viewerTime = viewerTime;
  protected readonly outcomeLabel = outcomeLabel;
  protected readonly outcomeChipClass = outcomeChipClass;
  protected readonly runDuration = runDuration;

  protected readonly jobs = signal<AdminJobView[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Keys of jobs whose enabled switch is being saved. */
  protected readonly saving = signal<ReadonlySet<string>>(new Set());

  private refresh?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.refresh?.unsubscribe());
    this.load();
  }

  protected label(job: AdminJobView): string {
    return job.name ?? job.key ?? '';
  }

  protected toggle(job: AdminJobView, event: Event): void {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    const key = job.key;
    if (!key || job.orphaned || job.version == null || this.saving().has(key)) {
      input.checked = job.enabled === true;
      return;
    }
    this.setSaving(key, true);
    this.api.adminUpdateJob(key, job.version, { enabled }).subscribe({
      next: (updated) => {
        this.setSaving(key, false);
        this.replace(updated);
        this.toasts.show(`${this.label(updated)} ${updated.enabled ? 'enabled' : 'disabled'}.`, 'success');
      },
      error: (err: unknown) => {
        this.setSaving(key, false);
        // The browser already flipped the box; put it back until the list is read again.
        input.checked = job.enabled === true;
        const problem = problemOf(err, 'The job could not be changed.');
        this.toasts.show(
          problem.status === 409 ? 'The job was changed in the meantime; the list was reloaded.' : problem.detail,
          'error',
        );
        this.load();
      },
    });
  }

  private load(): void {
    this.refresh?.unsubscribe();
    this.api.adminJobs().subscribe({
      next: (jobs) => {
        this.jobs.set(jobs);
        this.loadError.set(null);
        if (jobs.some((job) => job.running)) {
          this.refresh = timer(this.refreshMs).subscribe(() => this.load());
        }
      },
      error: (err: unknown) => this.loadError.set(problemOf(err, 'The jobs could not be loaded.').detail),
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
