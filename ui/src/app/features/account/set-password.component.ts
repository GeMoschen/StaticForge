import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService, SET_PASSWORD_URL } from '../../core/auth/session.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { AuthCardComponent } from '../auth/auth-card.component';
import { PasswordFieldsComponent } from './password-fields.component';
import { PasswordPolicyStore } from './password-policy.store';
import { checkPassword } from './password-rules.util';

/**
 * "Set a new password" (M26, M35.16): the only screen an account with a pending password change can reach — the
 * password fields (the temporary password, the new one with its live checklist, the confirmation) and "Sign out".
 * Afterwards the user continues to where they were heading (`returnUrl`). The server revokes every session on success;
 * `SessionService` signs straight back in with the new password.
 */
@Component({
  selector: 'sf-set-password',
  standalone: true,
  imports: [AuthCardComponent, PasswordFieldsComponent, SfBannerComponent, SfButtonComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../auth/auth-form.scss',
  template: `
    <sf-auth-card>
      <h1 class="title">{{ 'auth.setpassword.title' | transloco }}</h1>
      <p class="lead">{{ 'auth.setpassword.lead' | transloco: { name: name() } }}</p>
      <form class="form" novalidate (submit)="submit($event)">
        @if (error()) {
          <sf-banner tone="danger" live="assertive">{{ error() }}</sf-banner>
        }
        <sf-password-fields
          currentLabel="auth.setpassword.current"
          [policy]="policyStore.policy()"
          [currentError]="currentError()"
          [(current)]="current"
          [(next)]="next"
          [(confirm)]="confirm"
        />
        <sf-button
          class="submit"
          type="submit"
          [disabled]="!canSubmit()"
          [disabledReason]="canSubmit() || submitting() ? null : ('auth.setpassword.needRules' | transloco)"
          [loading]="submitting()"
        >
          {{ (submitting() ? 'auth.setpassword.busy' : 'auth.setpassword.submit') | transloco }}
        </sf-button>
      </form>
      <span sfAuthFooter>
        <sf-button variant="ghost" size="sm" (click)="signOut()">{{ 'auth.setpassword.signOut' | transloco }}</sf-button>
      </span>
    </sf-auth-card>
  `,
})
export class SetPasswordComponent {
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly policyStore = inject(PasswordPolicyStore);

  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly confirm = signal('');
  protected readonly submitting = signal(false);
  protected readonly currentError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly name = computed(() => this.auth.displayName() ?? this.auth.username() ?? '');
  protected readonly canSubmit = computed(
    () => !this.submitting() && this.current() !== '' && checkPassword(this.policyStore.policy(), this.next(), this.confirm()).valid,
  );

  constructor() {
    this.policyStore.load();
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) {
      return;
    }
    this.submitting.set(true);
    this.currentError.set(null);
    this.error.set(null);
    this.session.changeOwnPassword(this.current(), this.next()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.toasts.show(this.transloco.translate('auth.setpassword.done'), 'success');
        this.continue();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, this.transloco.translate('account.password.saveFailed'));
        if (problem.field === 'currentPassword') {
          this.currentError.set(problem.detail);
        } else {
          this.error.set(problem.errors.length > 0 ? problem.errors.join(' ') : problem.detail);
        }
      },
    });
  }

  protected continue(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const safe = returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith(SET_PASSWORD_URL) ? returnUrl : '/';
    void this.router.navigateByUrl(safe);
  }

  protected signOut(): void {
    this.session.signOut();
  }
}
