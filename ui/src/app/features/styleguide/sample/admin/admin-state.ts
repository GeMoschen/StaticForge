import { Injectable, computed, inject, signal } from '@angular/core';
import { SfMenuItem } from '../../../../shared/components/menu/sf-menu-item';
import { injectSampleNotice, injectSampleText, SampleText } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import {
  ADMIN_JOBS,
  ADMIN_PROJECTS,
  ADMIN_USERS,
  AdminJob,
  AdminMembership,
  AdminProject,
  AdminProjectRole,
  AdminUser,
  JobSchedule,
} from './admin-data';

/** The review states of the lists (`astate`): live data, the skeleton, the error with Retry, or no rows at all. */
export type AdminReviewState = 'live' | 'loading' | 'error' | 'empty';
export const ADMIN_REVIEW_STATES: readonly AdminReviewState[] = ['live', 'loading', 'error', 'empty'];

/** A single-choice filter menu: the chosen entry is named in the trigger and marked with a check in the list. */
export interface AdminFilterMenu {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly items: SfMenuItem[];
}

/**
 * State shared by the sample's Administration screens (M35.16), provided by {@link SampleAdminAreaComponent}: the
 * review state of the lists, and what the prototype changes in memory — users (status, role, profile, memberships),
 * archived projects, and the jobs' schedules. Nothing leaves the browser.
 */
@Injectable()
export class AdminState {
  readonly sample = inject(SampleState);
  /** A `styleguide.sample.admin.*` text. */
  readonly t: SampleText = injectSampleText('styleguide.sample.admin');
  readonly notice = injectSampleNotice();
  /** One "now" for the relative times. */
  readonly now = Date.now();

  readonly review = signal<AdminReviewState>('live');

  readonly users = signal<readonly AdminUser[]>(ADMIN_USERS);
  /** The instance's projects; *New project* adds one in memory. */
  readonly projects = signal<readonly AdminProject[]>(ADMIN_PROJECTS);
  readonly archivedProjects = signal<ReadonlySet<string>>(new Set(ADMIN_PROJECTS.filter((p) => p.archived).map((p) => p.key)));
  readonly jobEnabled = signal<Readonly<Record<string, boolean>>>(Object.fromEntries(ADMIN_JOBS.map((j) => [j.key, j.enabled])));
  readonly jobSchedules = signal<Readonly<Record<string, JobSchedule>>>(Object.fromEntries(ADMIN_JOBS.map((j) => [j.key, j.schedule])));

  /** The member count of each project, from the memberships of the users that are not deleted. */
  readonly memberCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const user of this.users()) {
      if (user.status === 'deleted') {
        continue;
      }
      for (const m of user.memberships) {
        counts.set(m.project, (counts.get(m.project) ?? 0) + 1);
      }
    }
    return counts;
  });

  user(id: string | null): AdminUser | null {
    return this.users().find((u) => u.id === id) ?? null;
  }

  patchUser(id: string, patch: Partial<AdminUser>): void {
    this.users.update((all) => all.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  setMembershipRole(userId: string, project: string, role: AdminProjectRole): void {
    this.setMemberships(userId, (all) => all.map((m) => (m.project === project ? { ...m, role } : m)));
  }

  setMemberships(userId: string, change: (all: readonly AdminMembership[]) => readonly AdminMembership[]): void {
    const user = this.user(userId);
    if (user) {
      this.patchUser(userId, { memberships: change(user.memberships) });
    }
  }

  projectByKey(key: string): AdminProject | undefined {
    return this.projects().find((p) => p.key === key);
  }

  /** A project's name (the key when the project is not known). */
  projectName(key: string): string {
    return this.projectByKey(key)?.name ?? key;
  }

  isArchived(key: string): boolean {
    return this.archivedProjects().has(key);
  }

  setArchived(key: string, archived: boolean): void {
    this.archivedProjects.update((all) => {
      const next = new Set(all);
      if (archived) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  job(job: AdminJob): AdminJob {
    return { ...job, enabled: this.jobEnabled()[job.key] ?? job.enabled, schedule: this.jobSchedules()[job.key] ?? job.schedule };
  }

  /** A schedule in words ("Every day at 03:00"); the cron expression is only a tooltip. */
  scheduleText(schedule: JobSchedule): string {
    const [, minute = '00'] = schedule.time.split(':');
    return this.t(`schedule.${schedule.frequency}`, {
      time: schedule.time,
      minute,
      day: this.t(`weekdays.${schedule.weekday}`),
      zone: schedule.zone,
    });
  }

  roleLabel(role: AdminProjectRole): string {
    return this.t(`roles.${role}`);
  }

  /** A single-choice filter menu with an "Any" entry first. */
  menu<V extends string>(id: string, options: readonly V[], value: V | null, label: (option: V) => string, set: (value: V | null) => void): AdminFilterMenu {
    const name = this.t(`filters.${id}`);
    const picked = options.find((o) => o === value);
    return {
      id,
      name,
      text: picked ? this.t('filters.picked', { filter: name, value: label(picked) }) : name,
      items: [
        { id: '', label: this.t('filters.any'), icon: picked === undefined ? 'check' : undefined, action: () => set(null) },
        ...options.map((o, i) => ({
          id: o,
          label: label(o),
          icon: o === value ? 'check' : undefined,
          separatorBefore: i === 0,
          action: () => set(o),
        })),
      ],
    };
  }
}
