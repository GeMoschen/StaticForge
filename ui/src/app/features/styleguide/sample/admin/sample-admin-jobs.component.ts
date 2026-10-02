import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../../shared/components/menu/sf-menu-item';
import { SfTableIdentityComponent } from '../../../../shared/components/data-table/sf-table-identity.component';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { minutesAgo } from '../changes/sample-area.util';
import { ADMIN_JOBS, AdminJob, OUTCOME_ICONS, OUTCOME_TONES, cronOf } from './admin-data';
import { AdminState } from './admin-state';

/**
 * Administration › Jobs (M35.16): the instance's housekeeping jobs — name and what it does, an enabled switch, the
 * schedule in words (the cron expression only in a tooltip), the next run and the last run's outcome (with a *Dry run*
 * badge). A job whose code is gone is muted and says so. A row opens the job.
 */
@Component({
  selector: 'sf-sample-admin-jobs',
  standalone: true,
  imports: [
    SfMenuComponent,
    SfTableIdentityComponent,
    SfBadgeComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfSwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-jobs.component.html',
  styleUrl: './sample-admin-jobs.component.scss',
})
export class SampleAdminJobsComponent {
  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;
  protected readonly tones = OUTCOME_TONES;
  protected readonly icons = OUTCOME_ICONS;

  protected readonly rows = computed(() => (this.admin.review() !== 'live' ? [] : ADMIN_JOBS.map((job) => this.admin.job(job))));
  protected readonly error = computed(() => (this.admin.review() === 'error' ? this.t('jobs.error') : null));

  protected readonly columns = computed<SfDataTableColumn<AdminJob>[]>(() => {
    const header = (id: string) => this.t(`jobs.columns.${id}`);
    return [
      { id: 'job', header: header('job'), value: (j) => j.name, sortable: true, hideable: false, width: 360 },
      { id: 'enabled', header: header('enabled'), value: (j) => (j.enabled ? 1 : 0), sortable: true, width: 110 },
      { id: 'schedule', header: header('schedule'), value: (j) => this.admin.scheduleText(j.schedule), width: 230 },
      { id: 'next', header: header('next'), value: (j) => (j.enabled ? j.nextMinutes : Number.MAX_SAFE_INTEGER), sortable: true, width: 150 },
      { id: 'last', header: header('last'), value: (j) => j.lastRun?.minutes ?? Number.MAX_SAFE_INTEGER, sortable: true, width: 230 },
      { id: 'actions', header: header('actions'), width: 72, hideable: false },
    ];
  });

  protected readonly rowKey = (job: AdminJob) => job.key;
  protected readonly rowLabel = (job: AdminJob) => job.name;

  protected menuItems(job: AdminJob): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('jobs.menu.edit'), icon: 'edit' },
      { id: 'run', label: this.t('jobs.menu.run'), icon: 'play_arrow', disabled: job.orphaned },
    ];
  }

  protected onMenu(job: AdminJob, item: SfMenuItem): void {
    if (item.id === 'edit') {
      this.open(job);
    } else if (item.id === 'run') {
      this.admin.notice(this.t('jobs.runStarted', { name: job.name }));
    }
  }

  protected open(job: AdminJob): void {
    this.admin.sample.adminDetail.set(job.key);
  }

  protected toggle(job: AdminJob, enabled: boolean): void {
    this.admin.jobEnabled.update((all) => ({ ...all, [job.key]: enabled }));
    this.admin.notice(this.t(enabled ? 'jobs.enabled' : 'jobs.disabled', { name: job.name }));
  }

  protected cron(job: AdminJob): string {
    return cronOf(job.schedule);
  }

  protected ahead(minutes: number): number {
    return this.admin.now + minutes * 60_000;
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.admin.now);
  }
}
