import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { PROJECT_ROLES } from '../../core/auth/roles';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { PasswordPolicyStore } from '../account/password-policy.store';
import { meetsPolicy, passwordRuleChecks } from '../account/password-rules.util';
import { AdminOneTimePasswordComponent } from './admin-one-time-password.component';
import { AdminPasswordChoiceComponent, PasswordMode } from './admin-password-choice.component';
import { statusChipClass, statusLabel, userActionStates } from './admin-user.util';

type AdminUserDetail = components['schemas']['AdminUserDetail'];
type AdminMembership = components['schemas']['AdminMembership'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];
type ProfileField = 'username' | 'email' | 'displayName';

/**
 * Administration → one user (M26): profile, account state, the admin actions with the server's guard rails shown as
 * reasons, and the project memberships. A deleted (anonymized) account opens read-only.
 */
@Component({
  selector: 'sf-admin-user-detail',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    SfButtonComponent,
    SfFieldComponent,
    SfIconComponent,
    SfSpinnerComponent,
    AdminOneTimePasswordComponent,
    AdminPasswordChoiceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-user-detail.component.html',
  styleUrl: './admin-user-detail.component.scss',
})
export class AdminUserDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly policyStore = inject(PasswordPolicyStore);

  /** The `:id` route parameter. */
  readonly id = input.required<string>();

  protected readonly roles = PROJECT_ROLES;
  protected readonly statusLabel = statusLabel;
  protected readonly statusChipClass = statusChipClass;

  protected readonly user = signal<AdminUserDetail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** Unknown until loaded: the guard rails aren't shown before (the server enforces them anyway). */
  private readonly activeAdminCount = signal(Number.POSITIVE_INFINITY);
  protected readonly busy = signal(false);

  protected readonly deleted = computed(() => this.user()?.status === 'DELETED');
  protected readonly isSelf = computed(() => this.user()?.id != null && this.user()?.id === this.auth.userId());
  protected readonly actions = computed(() => {
    const user = this.user();
    return user ? userActionStates(user, this.auth.userId(), this.activeAdminCount()) : null;
  });
  /** Why the guarded actions (disable, delete, demote) are refused, when they are: one reason covers all three. */
  protected readonly guardReason = computed(() => {
    const a = this.actions();
    return a?.delete.reason ?? a?.disable.reason ?? a?.toggleAdmin.reason ?? null;
  });

  // ── profile ──
  protected readonly username = signal('');
  protected readonly email = signal('');
  protected readonly displayName = signal('');
  protected readonly profileDirty = computed(() => {
    const u = this.user();
    return (
      !!u &&
      (this.username().trim() !== (u.username ?? '') ||
        this.email().trim() !== (u.email ?? '') ||
        this.displayName().trim() !== (u.displayName ?? ''))
    );
  });
  protected readonly profileValid = computed(() => this.username().trim() !== '' && this.email().trim() !== '');
  protected readonly savingProfile = signal(false);
  protected readonly fieldErrors = signal<Partial<Record<ProfileField, string>>>({});
  protected readonly profileError = signal<string | null>(null);

  // ── reset password ──
  protected readonly resetting = signal(false);
  protected readonly resetMode = signal<PasswordMode>('generate');
  protected readonly resetPasswordValue = signal('');
  protected readonly resetMustChange = signal(true);
  protected readonly resetErrors = signal<string[]>([]);
  protected readonly resetValid = computed(
    () =>
      this.resetMode() === 'generate' ||
      meetsPolicy(passwordRuleChecks(this.policyStore.policy(), this.resetPasswordValue())),
  );
  /** A generated password, until the one-time panel is done. Never kept anywhere else. */
  protected readonly oneTimePassword = signal<string | null>(null);

  // ── delete ──
  protected readonly deleting = signal(false);
  protected readonly deleteConfirm = signal('');
  protected readonly deleteError = signal<string | null>(null);
  protected readonly deleteMatches = computed(() => this.deleteConfirm() === (this.user()?.username ?? '\u0000'));

  // ── memberships ──
  protected readonly projects = signal<AdminProjectRow[]>([]);
  protected readonly newProjectKey = signal('');
  protected readonly newRole = signal('EDITOR');
  /** Projects the user could still join: not archived (the server refuses writes there) and not a membership yet. */
  protected readonly joinableProjects = computed(() => {
    const member = new Set((this.user()?.memberships ?? []).map((m) => m.projectKey));
    return this.projects().filter((p) => !p.archived && !member.has(p.key));
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => this.load(id));
    });
    this.api.adminListProjects({ includeArchived: false }).subscribe({
      next: (projects) => this.projects.set(projects),
      error: () => undefined,
    });
  }

  // ── profile ──

  protected saveProfile(): void {
    const user = this.user();
    if (!user?.id || !this.profileDirty() || !this.profileValid() || this.savingProfile()) {
      return;
    }
    this.savingProfile.set(true);
    this.fieldErrors.set({});
    this.profileError.set(null);
    this.api
      .adminUpdateUser(user.id, {
        username: this.username().trim(),
        email: this.email().trim(),
        displayName: this.displayName().trim(),
      })
      .subscribe({
        next: (updated) => {
          this.savingProfile.set(false);
          this.show(updated);
          this.toasts.show('Profile saved.', 'success');
        },
        error: (err: unknown) => {
          this.savingProfile.set(false);
          const problem = problemOf(err, 'The profile could not be saved.');
          if (problem.field && ['username', 'email', 'displayName'].includes(problem.field)) {
            this.fieldErrors.set({ [problem.field as ProfileField]: problem.detail });
          } else {
            this.profileError.set(problem.detail);
          }
        },
      });
  }

  protected discardProfile(): void {
    const user = this.user();
    if (user) {
      this.show(user);
    }
  }

  // ── actions ──

  protected setStatus(action: 'disable' | 'enable' | 'unlock'): void {
    const user = this.user();
    if (!user?.id || this.busy()) {
      return;
    }
    if (
      action === 'disable' &&
      !window.confirm(`Disable ${this.name(user)}? They are signed out at once and can't sign in until enabled again.`)
    ) {
      return;
    }
    this.busy.set(true);
    this.api.adminUserAction(user.id, action).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.show(updated);
        this.loadAdminCount();
      },
      error: () => this.busy.set(false),
    });
  }

  protected revokeSessions(): void {
    const user = this.user();
    if (!user?.id || this.busy() || !window.confirm(`Sign ${this.name(user)} out of every session?`)) {
      return;
    }
    this.busy.set(true);
    this.api.adminRevokeSessions(user.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.show(`${this.name(user)} was signed out everywhere.`, 'success');
      },
      error: () => this.busy.set(false),
    });
  }

  protected toggleAdmin(): void {
    const user = this.user();
    if (!user?.id || this.busy()) {
      return;
    }
    const grant = user.systemRole !== 'INSTANCE_ADMIN';
    const question = grant
      ? `Make ${this.name(user)} an instance administrator? They can manage every user and project.`
      : `Revoke instance administration from ${this.name(user)}?`;
    if (!window.confirm(question)) {
      return;
    }
    this.busy.set(true);
    this.api.adminSetSystemRole(user.id, grant ? 'INSTANCE_ADMIN' : 'USER').subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.show(updated);
        this.loadAdminCount();
      },
      error: () => this.busy.set(false),
    });
  }

  protected openReset(): void {
    this.resetMode.set('generate');
    this.resetPasswordValue.set('');
    this.resetMustChange.set(true);
    this.resetErrors.set([]);
    this.resetting.set(true);
  }

  protected submitReset(): void {
    const user = this.user();
    if (!user?.id || !this.resetValid() || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.resetErrors.set([]);
    const body =
      this.resetMode() === 'generate'
        ? { generatePassword: true, mustChangePassword: this.resetMustChange() }
        : { password: this.resetPasswordValue(), mustChangePassword: this.resetMustChange() };
    this.api.adminResetPassword(user.id, body).subscribe({
      next: (updated) => {
        this.busy.set(false);
        const { generatedPassword, ...rest } = updated;
        this.show(rest);
        this.resetPasswordValue.set('');
        if (generatedPassword) {
          this.oneTimePassword.set(generatedPassword);
        } else {
          this.resetting.set(false);
          this.toasts.show('Password reset. The user was signed out everywhere.', 'success');
        }
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const problem = problemOf(err, 'The password could not be reset.');
        this.resetErrors.set(problem.errors.length > 0 ? problem.errors : [problem.detail]);
      },
    });
  }

  protected closeReset(): void {
    this.oneTimePassword.set(null);
    this.resetPasswordValue.set('');
    this.resetting.set(false);
  }

  protected openDelete(): void {
    this.deleteConfirm.set('');
    this.deleteError.set(null);
    this.deleting.set(true);
  }

  protected submitDelete(): void {
    const user = this.user();
    if (!user?.id || !this.deleteMatches() || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.adminDeleteUser(user.id, this.deleteConfirm()).subscribe({
      next: () => {
        this.busy.set(false);
        this.deleting.set(false);
        this.toasts.show(`${user.username} was deleted.`, 'success');
        void this.router.navigate(['/admin/users']);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.deleteError.set(problemOf(err, 'The user could not be deleted.').detail);
      },
    });
  }

  // ── memberships ──

  protected addMembership(): void {
    const user = this.user();
    const key = this.newProjectKey();
    if (!user?.id || !key || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.setMemberRole(key, user.id, this.newRole()).subscribe({
      next: () => {
        this.newProjectKey.set('');
        this.reload();
      },
      error: () => this.busy.set(false),
    });
  }

  protected changeMembershipRole(membership: AdminMembership, role: string): void {
    const user = this.user();
    if (!user?.id || !membership.projectKey || role === membership.role || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.setMemberRole(membership.projectKey, user.id, role).subscribe({
      next: () => this.reload(),
      error: () => this.reload(),
    });
  }

  protected removeMembership(membership: AdminMembership): void {
    const user = this.user();
    if (
      !user?.id ||
      !membership.projectKey ||
      this.busy() ||
      !window.confirm(`Remove ${this.name(user)} from ${membership.projectName ?? membership.projectKey}?`)
    ) {
      return;
    }
    this.busy.set(true);
    this.api.removeMember(membership.projectKey, user.id).subscribe({
      next: () => this.reload(),
      error: () => this.busy.set(false),
    });
  }

  protected name(user: AdminUserDetail): string {
    return user.displayName || user.username || `User #${user.id}`;
  }

  private reload(): void {
    const id = this.user()?.id;
    if (id != null) {
      this.load(id);
    }
  }

  private load(id: number): void {
    this.loadError.set(null);
    this.api.adminGetUser(id).subscribe({
      next: (user) => {
        this.busy.set(false);
        this.show(user);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.loadError.set(problemOf(err, 'The user could not be loaded.').detail);
      },
    });
    this.loadAdminCount();
  }

  private loadAdminCount(): void {
    this.api.adminListUsers({ systemRole: 'INSTANCE_ADMIN', status: 'ACTIVE', size: 1 }).subscribe({
      next: (page) => this.activeAdminCount.set(page.page?.totalElements ?? 0),
      error: () => undefined,
    });
  }

  /** Shows `user` and resets the profile form to it. */
  private show(user: AdminUserDetail): void {
    this.user.set(user);
    this.username.set(user.username ?? '');
    this.email.set(user.email ?? '');
    this.displayName.set(user.displayName ?? '');
    this.fieldErrors.set({});
    this.profileError.set(null);
  }
}
