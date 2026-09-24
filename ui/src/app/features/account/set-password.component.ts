import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService, SET_PASSWORD_URL } from '../../core/auth/session.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { OwnPasswordFormComponent } from './own-password-form.component';

/**
 * "Set a new password" (M26): the only screen an account with a pending password change can reach — the password
 * form and "Sign out", nothing else. Afterwards the user continues to where they were heading (`returnUrl`).
 */
@Component({
  selector: 'sf-set-password',
  standalone: true,
  imports: [SfButtonComponent, OwnPasswordFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="set-password">
      <div class="set-password__card">
        <h1 class="set-password__title">Set a new password</h1>
        <p class="set-password__intro">
          Hello {{ name() }}. Your account uses a temporary password. Choose your own before you continue.
        </p>
        <sf-own-password-form submitLabel="Set password and continue" (changed)="continue()" />
        <div class="set-password__footer">
          <sf-button variant="ghost" (click)="signOut()">Sign out</sf-button>
        </div>
      </div>
    </main>
  `,
  styles: `
    :host {
      display: block;
    }
    .set-password {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--sf-5);
      box-sizing: border-box;
    }
    .set-password__card {
      width: min(30rem, 100%);
      display: flex;
      flex-direction: column;
      gap: var(--sf-4);
      padding: var(--sf-6);
      background: var(--sf-surface);
      border: 1px solid var(--sf-line);
      border-radius: var(--sf-radius-lg);
      box-shadow: var(--sf-shadow-2);
    }
    .set-password__title {
      margin: 0;
      font-family: var(--sf-font-display);
      font-size: var(--sf-text-xl);
      color: var(--sf-ink);
    }
    .set-password__intro {
      margin: 0;
      color: var(--sf-slate);
      font-size: var(--sf-text-sm);
    }
    .set-password__footer {
      display: flex;
      justify-content: flex-start;
      border-top: 1px solid var(--sf-line);
      padding-top: var(--sf-3);
    }
  `,
})
export class SetPasswordComponent {
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected name(): string {
    return this.auth.displayName() ?? this.auth.username() ?? '';
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
