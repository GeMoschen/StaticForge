import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { PROJECT_ROLES } from '../../core/auth/roles';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { PasswordPolicyStore } from '../account/password-policy.store';
import { meetsPolicy, passwordRuleChecks } from '../account/password-rules.util';
import { AdminOneTimePasswordComponent } from './admin-one-time-password.component';
import { AdminPasswordChoiceComponent, PasswordMode } from './admin-password-choice.component';

type AdminUserDetail = components['schemas']['AdminUserDetail'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];
type CreateUserRequest = components['schemas']['CreateUserRequest'];

interface MembershipDraft {
  projectKey: string;
  role: string;
}

type CreateField = 'username' | 'email' | 'displayName' | 'password';

/**
 * Create a user (M26, epic decisions 1–2): the account, its password (generated — then shown once — or typed), the
 * "must change" flag and optional first project memberships.
 */
@Component({
  selector: 'sf-admin-create-user-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfFieldComponent, AdminOneTimePasswordComponent, AdminPasswordChoiceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-create-user-dialog.component.html',
  styleUrl: './admin-create-user-dialog.component.scss',
})
export class AdminCreateUserDialogComponent {
  private readonly api = inject(ApiClient);
  private readonly policyStore = inject(PasswordPolicyStore);

  /** The account exists (after its generated password was shown, if any). */
  readonly created = output<AdminUserDetail>();
  /** Closed without creating anything. */
  readonly closed = output<void>();

  protected readonly roles = PROJECT_ROLES;

  protected readonly username = signal('');
  protected readonly email = signal('');
  protected readonly displayName = signal('');
  protected readonly instanceAdmin = signal(false);
  protected readonly mode = signal<PasswordMode>('generate');
  protected readonly password = signal('');
  protected readonly mustChange = signal(true);
  protected readonly memberships = signal<MembershipDraft[]>([]);

  protected readonly projects = signal<AdminProjectRow[]>([]);
  protected readonly submitting = signal(false);
  protected readonly fieldErrors = signal<Partial<Record<CreateField, string>>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly ruleErrors = signal<string[]>([]);

  /** Set once the account exists with a generated password: the panel that shows it once. */
  protected readonly createdUser = signal<AdminUserDetail | null>(null);
  protected readonly oneTimePassword = signal<string | null>(null);

  protected readonly valid = computed(
    () =>
      this.username().trim() !== '' &&
      this.email().trim() !== '' &&
      (this.mode() === 'generate' ||
        meetsPolicy(passwordRuleChecks(this.policyStore.policy(), this.password()))) &&
      this.memberships().every((m) => m.projectKey !== ''),
  );

  constructor() {
    this.api.adminListProjects({ includeArchived: false }).subscribe({
      next: (projects) => this.projects.set(projects),
      error: () => undefined,
    });
  }

  /** The projects a membership row can pick: those no other row has taken. */
  protected availableProjects(index: number): AdminProjectRow[] {
    const taken = new Set(this.memberships().filter((_, i) => i !== index).map((m) => m.projectKey));
    return this.projects().filter((p) => !taken.has(p.key ?? ''));
  }

  protected addMembership(): void {
    this.memberships.update((rows) => [...rows, { projectKey: '', role: 'EDITOR' }]);
  }

  protected updateMembership(index: number, change: Partial<MembershipDraft>): void {
    this.memberships.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  protected removeMembership(index: number): void {
    this.memberships.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected submit(): void {
    if (!this.valid() || this.submitting()) {
      return;
    }
    const body: CreateUserRequest = {
      username: this.username().trim(),
      email: this.email().trim(),
      displayName: this.displayName().trim() || undefined,
      systemRole: this.instanceAdmin() ? 'INSTANCE_ADMIN' : 'USER',
      mustChangePassword: this.mustChange(),
    };
    if (this.mode() === 'generate') {
      body.generatePassword = true;
    } else {
      body.password = this.password();
    }
    if (this.memberships().length > 0) {
      body.memberships = this.memberships().map((m) => ({ projectKey: m.projectKey, role: m.role }));
    }
    this.submitting.set(true);
    this.fieldErrors.set({});
    this.error.set(null);
    this.ruleErrors.set([]);
    this.api.adminCreateUser(body).subscribe({
      next: (user) => {
        this.submitting.set(false);
        const { generatedPassword, ...withoutPassword } = user;
        if (generatedPassword) {
          this.createdUser.set(withoutPassword);
          this.oneTimePassword.set(generatedPassword);
        } else {
          this.created.emit(withoutPassword);
        }
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, 'The user could not be created.');
        if (problem.errors.length > 0) {
          this.ruleErrors.set(problem.errors);
        } else if (problem.field && ['username', 'email', 'displayName', 'password'].includes(problem.field)) {
          this.fieldErrors.set({ [problem.field as CreateField]: problem.detail });
        } else {
          this.error.set(problem.detail);
        }
      },
    });
  }

  /** The generated password was handed over: forget it and report the new account. */
  protected passwordShown(): void {
    const user = this.createdUser();
    this.oneTimePassword.set(null);
    this.createdUser.set(null);
    if (user) {
      this.created.emit(user);
    }
  }

  protected cancel(): void {
    this.closed.emit();
  }
}
