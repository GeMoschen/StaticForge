import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, untracked } from '@angular/core';
import { injectSampleQuery, oneOf } from '../changes/sample-area.util';
import { ADMIN_SECTIONS, SampleAdminSection, SampleCrumb } from '../sample-state';
import { jobByKey, userById } from './admin-data';
import { ADMIN_REVIEW_STATES, AdminReviewState, AdminState } from './admin-state';
import { SampleAdminAuditComponent } from './sample-admin-audit.component';
import { SampleAdminJobDetailComponent } from './sample-admin-job-detail.component';
import { SampleAdminJobsComponent } from './sample-admin-jobs.component';
import { SampleAdminProjectsComponent } from './sample-admin-projects.component';
import { SampleAdminUserDetailComponent } from './sample-admin-user-detail.component';
import { SampleAdminUsersComponent } from './sample-admin-users.component';

/**
 * The sample's Administration area (M35.16): Users (list and detail), Projects, Jobs (list and detail) and Audit. The
 * rail lists the four sections — there is no second sub-navigation — and names the open one through the sample state's
 * `adminSection`; `adminDetail` is the open user or job (`null` = the list). Each screen has its own page header with the
 * one `h1`; the breadcrumb is Administration › Users › Ada Lovelace.
 *
 * Query parameters (read on load, written back by replacing the history entry, removed when the area closes):
 * `asec=users|projects|jobs|audit`, `adetail=<user id or job key>`, `astate=loading|error|empty` (review states of the
 * lists), and the lists' own filters `ufilter`, `pfilter`, `afilter`.
 */
@Component({
  selector: 'sf-sample-admin-area',
  standalone: true,
  imports: [
    SampleAdminAuditComponent,
    SampleAdminJobDetailComponent,
    SampleAdminJobsComponent,
    SampleAdminProjectsComponent,
    SampleAdminUserDetailComponent,
    SampleAdminUsersComponent,
  ],
  providers: [AdminState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-area.component.html',
  styleUrl: './sample-admin-area.component.scss',
})
export class SampleAdminAreaComponent {
  protected readonly admin = inject(AdminState);
  protected readonly sample = this.admin.sample;
  private readonly query = injectSampleQuery();

  /** The open user or job, when it exists. */
  protected readonly userId = computed(() => (this.sample.adminSection() === 'users' && userById(this.sample.adminDetail()) ? this.sample.adminDetail() : null));
  protected readonly jobKey = computed(() => (this.sample.adminSection() === 'jobs' && jobByKey(this.sample.adminDetail()) ? this.sample.adminDetail() : null));

  constructor() {
    const section = oneOf<SampleAdminSection>(this.query.get('asec'), ADMIN_SECTIONS);
    if (section) {
      this.sample.adminSection.set(section);
    }
    this.sample.adminDetail.set(this.query.get('adetail'));
    const review = oneOf<AdminReviewState>(this.query.get('astate'), ADMIN_REVIEW_STATES);
    if (review) {
      this.admin.review.set(review);
    }

    effect(() =>
      this.query.set({
        asec: this.sample.adminSection(),
        adetail: this.userId() ?? this.jobKey(),
        astate: this.admin.review() === 'live' ? null : this.admin.review(),
      }),
    );

    // The breadcrumb: Administration › <section> › <the open user or job>.
    effect(
      () => {
        const t = this.admin.t;
        const section = this.sample.adminSection();
        const userName = this.userId() !== null ? this.admin.user(this.userId())?.displayName : null;
        const jobName = this.jobKey() !== null ? jobByKey(this.jobKey())?.name : null;
        const detail = userName ?? jobName;
        const crumbs: SampleCrumb[] = detail ? [{ label: t(`sections.${section}`), target: 'list' }, { label: detail }] : [{ label: t(`sections.${section}`) }];
        this.sample.areaPath.set(crumbs);
      },
      { allowSignalWrites: true },
    );
    // A chosen breadcrumb segment: the section's list ("Administration" itself opens the first section).
    effect(() => {
      const chosen = this.sample.areaTarget();
      if (chosen) {
        untracked(() => {
          if (chosen.target === null) {
            this.sample.adminSection.set('users');
          }
          this.sample.adminDetail.set(null);
          this.sample.areaTarget.set(null);
        });
      }
    });

    inject(DestroyRef).onDestroy(() => {
      this.query.set({ asec: null, adetail: null, astate: null, ufilter: null, pfilter: null, afilter: null });
      this.sample.areaPath.set([]);
    });
  }
}
