import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { problemOf } from '../../core/api/problem.util';
import { SessionService } from '../../core/auth/session.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { PasswordPolicyStore } from './password-policy.store';
import { PasswordRulesComponent } from './password-rules.component';
import { meetsPolicy, passwordRuleChecks } from './password-rules.util';

/**
 * Changes the signed-in user's own password (M26): current password, new password with the policy as live checks,
 * confirmation. The server revokes every session on success; `SessionService` signs straight back in with the new
 * password, so the user stays signed in here and nowhere else.
 */
@Component({
  selector: 'sf-own-password-form',
  standalone: true,
  imports: [ReactiveFormsModule, SfButtonComponent, SfFieldComponent, PasswordRulesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './own-password-form.component.html',
  styleUrl: './own-password-form.component.scss',
})
export class OwnPasswordFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(SessionService);
  protected readonly policyStore = inject(PasswordPolicyStore);

  readonly submitLabel = input('Change password');
  /** Emitted after the change, once the new session is in place. */
  readonly changed = output<void>();

  protected readonly form = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', Validators.required],
    confirmPassword: ['', Validators.required],
  });

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly newPassword = computed(() => this.value().newPassword ?? '');
  protected readonly mismatch = computed(() => {
    const { newPassword, confirmPassword } = this.value();
    return !!confirmPassword && newPassword !== confirmPassword;
  });
  private readonly policyMet = computed(() =>
    meetsPolicy(passwordRuleChecks(this.policyStore.policy(), this.newPassword())),
  );
  protected readonly canSubmit = computed(() => {
    const { currentPassword, newPassword, confirmPassword } = this.value();
    return (
      !this.submitting() &&
      !!currentPassword &&
      !!newPassword &&
      newPassword === confirmPassword &&
      this.policyMet()
    );
  });

  protected readonly submitting = signal(false);
  protected readonly currentPasswordError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly ruleErrors = signal<string[]>([]);

  constructor() {
    this.policyStore.load();
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.submitting.set(true);
    this.currentPasswordError.set(null);
    this.error.set(null);
    this.ruleErrors.set([]);
    this.session.changeOwnPassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.submitting.set(false);
        this.form.reset();
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, 'The password could not be changed.');
        if (problem.field === 'currentPassword') {
          this.currentPasswordError.set(problem.detail);
        } else if (problem.errors.length > 0) {
          this.ruleErrors.set(problem.errors);
        } else {
          this.error.set(problem.detail);
        }
      },
    });
  }
}
