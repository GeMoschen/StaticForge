import { Injectable, computed, inject } from '@angular/core';
import { AuthStore } from '../auth/auth.store';
import { roleRank } from '../auth/auth.guard';
import { ProjectAccessStore } from './project-access.store';
import { ProjectContextStore } from './project-context.store';
import type { PublishPermission } from './publish-permissions';

/** The parts of a run the cancel rule reads. */
export interface RunOwnership {
  startedBy?: { id?: number } | null;
}

/** The parts of a schedule the schedule rules read. */
export interface ScheduleOwnership {
  type?: string;
  ownerUserId?: number | null;
  thenGenerate?: unknown;
}

/**
 * What the current user may do in the open project (M28.3.1, epic decisions 12 and 13) — the one place the app asks.
 * Role-based rights come from the effective role (`AuthStore.roleFor`: an instance admin is a project admin, an
 * archived project lowers everyone to viewer); publish rights come from the server's `ProjectDetail.permissions`, never
 * from the role, so the UI and the server can't disagree when the policy changes. Every write capability is `false`
 * while the project is read-only (time travel, archived). The server stays the authority: this only hides controls.
 */
@Injectable({ providedIn: 'root' })
export class ProjectPermissionsStore {
  private readonly auth = inject(AuthStore);
  private readonly access = inject(ProjectAccessStore);
  private readonly context = inject(ProjectContextStore);

  /** The effective role in the open project, `null` outside one. */
  readonly role = computed(() => {
    const key = this.context.activeProjectKey();
    return key ? this.auth.roleFor(key) : null;
  });
  /** The publish permissions the server reports for the caller. */
  readonly permissions = computed<ReadonlySet<string>>(
    () => new Set((this.context.project()?.permissions ?? []) as string[]),
  );
  readonly writable = computed(() => !this.access.readOnly());

  readonly isEditor = computed(() => this.atLeast('EDITOR'));
  readonly isDeveloper = computed(() => this.atLeast('DEVELOPER'));
  readonly isProjectAdmin = computed(() => this.atLeast('PROJECT_ADMIN'));

  /**
   * A project admin by membership, also in an archived project (where {@link isProjectAdmin} is lowered to viewer):
   * may read admin-only settings such as the compaction policy, which the server allows there.
   */
  readonly readsAsProjectAdmin = computed(() => {
    const key = this.context.activeProjectKey();
    return key !== null && roleRank(this.auth.memberRoleFor(key)) >= roleRank('PROJECT_ADMIN');
  });

  readonly canEditContent =computed(() => this.isEditor() && this.writable());
  readonly canEditTemplates = computed(() => this.isDeveloper() && this.writable());
  readonly canAdminProject = computed(() => this.isProjectAdmin() && this.writable());
  readonly canManageMembers = this.canAdminProject;
  /** Creating a target is for developers, changing or deleting one for project admins (as the API). */
  readonly canCreateTargets = computed(() => this.isDeveloper() && this.writable());
  readonly canManageTargets = this.canAdminProject;

  readonly canRelease = computed(() => this.holds('RELEASE') && this.writable());
  readonly canScheduleRelease = computed(() => this.holds('SCHEDULE_RELEASE') && this.writable());
  readonly canIncrementalBuild = computed(() => this.holds('INCREMENTAL_BUILD') && this.writable());
  readonly canFullBuild = computed(() => this.holds('FULL_BUILD') && this.writable());
  /** Promote/rollback and generation schedules stay with developers, whatever the policy. */
  readonly canPromote = computed(() => this.isDeveloper() && this.writable());
  readonly canScheduleGeneration = computed(() => this.isDeveloper() && this.writable());
  /** Manual redirects are the developers' (M30, epic decision 17), like URL registry overrides. */
  readonly canEditRedirects = computed(() => this.isDeveloper() && this.writable());
  /**
   * "Redirect old URL to…" in the unpublish and delete dialogs (M30, epic decision 17): whoever may unpublish
   * (`RELEASE`), and developers.
   */
  readonly canRedirectOldUrls = computed(() => (this.holds('RELEASE') || this.isDeveloper()) && this.writable());
  /** Anything that puts content online — or nothing, for the explanatory empty states. */
  readonly canPublishAnything = computed(() => this.canRelease() || this.canIncrementalBuild());

  /**
   * Cancel a run: developers any run, an editor holding a build permission only one they started. Allowed while
   * read-only: stopping a run started before archiving creates nothing (as the API).
   */
  canCancelRun(run: RunOwnership): boolean {
    if (this.isDeveloper()) {
      return true;
    }
    const userId = this.auth.userId();
    return this.holds('INCREMENTAL_BUILD') && userId != null && run.startedBy?.id === userId;
  }

  /**
   * Whether the caller satisfies what a schedule needs (the server's `requirements`): a scheduled release or unpublish
   * needs `SCHEDULE_RELEASE`, plus the build permission of its "then generate" step — `INCREMENTAL_BUILD` to the
   * default target, `FULL_BUILD` to another; generation schedules need a developer.
   *
   * @param defaultTargetId where a build without a target goes; `null` when unknown or none
   */
  satisfiesSchedule(schedule: ScheduleOwnership, defaultTargetId: number | null): boolean {
    if (!this.writable()) {
      return false;
    }
    if (schedule.type !== 'RELEASE' && schedule.type !== 'UNPUBLISH') {
      return this.isDeveloper();
    }
    if (!this.holds('SCHEDULE_RELEASE')) {
      return false;
    }
    const then = schedule.thenGenerate as { targetId?: number | null } | null | undefined;
    if (!then) {
      return true;
    }
    const toDefault = then.targetId == null || then.targetId === defaultTargetId;
    return this.holds(toDefault ? 'INCREMENTAL_BUILD' : 'FULL_BUILD');
  }

  /** Edit, cancel, run now or re-pin: the schedule's requirements, and a developer for someone else's. */
  canChangeSchedule(schedule: ScheduleOwnership, defaultTargetId: number | null): boolean {
    const own = schedule.ownerUserId != null && schedule.ownerUserId === this.auth.userId();
    return this.satisfiesSchedule(schedule, defaultTargetId) && (own || this.isDeveloper());
  }

  private holds(permission: PublishPermission): boolean {
    return this.permissions().has(permission);
  }

  private atLeast(role: string): boolean {
    return roleRank(this.role()) >= roleRank(role);
  }
}
