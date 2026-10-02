import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { AuthCardComponent } from './auth-card.component';

/**
 * Sign in (M35.16), outside the app frame: the card with the mark, a short lead, Username and Password (with a show/hide
 * toggle), a primary *Sign in* that stays disabled until both are filled, a busy state, and a refused sign-in inline in
 * an assertive banner that clears on the next edit. No implementation text on the page.
 */
@Component({
  selector: 'sf-login',
  standalone: true,
  imports: [AuthCardComponent, SfBannerComponent, SfButtonComponent, SfFieldComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <sf-auth-card>
      <h1 class="title">{{ 'auth.login.title' | transloco }}</h1>
      <p class="lead">{{ 'auth.login.lead' | transloco }}</p>
      <form class="form" novalidate (submit)="submit($event)">
        @if (error()) {
          <sf-banner tone="danger" live="assertive">{{ error() }}</sf-banner>
        }
        <sf-field [label]="'auth.login.username' | transloco">
          <sf-input [value]="username()" autocomplete="username" (valueChange)="edit('username', $event)" />
        </sf-field>
        <sf-field [label]="'auth.login.password' | transloco">
          <div class="password">
            <sf-input
              class="password__input"
              [type]="visible() ? 'text' : 'password'"
              [value]="password()"
              autocomplete="current-password"
              (valueChange)="edit('password', $event)"
            />
            <sf-button
              variant="ghost"
              [icon]="visible() ? 'visibility_off' : 'visibility'"
              [label]="(visible() ? 'auth.login.hide' : 'auth.login.show') | transloco"
              [aria-pressed]="visible()"
              (click)="visible.set(!visible())"
            />
          </div>
        </sf-field>
        <sf-button
          class="submit"
          type="submit"
          [disabled]="!ready()"
          [disabledReason]="ready() || submitting() ? null : ('auth.login.needBoth' | transloco)"
          [loading]="submitting()"
        >
          {{ (submitting() ? 'auth.login.busy' : 'auth.login.submit') | transloco }}
        </sf-button>
      </form>
      <span sfAuthFooter>{{ 'auth.login.forgot' | transloco }}</span>
    </sf-auth-card>
  `,
})
export class LoginComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly authStore = inject(AuthStore);
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);
  private readonly transloco = inject(TranslocoService);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly visible = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ready = computed(() => this.username().trim() !== '' && this.password() !== '' && !this.submitting());

  protected edit(field: 'username' | 'password', value: string): void {
    (field === 'username' ? this.username : this.password).set(value);
    this.error.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.ready()) {
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    this.api.login(this.username().trim(), this.password()).subscribe({
      next: (res) => {
        this.authStore.setSession(res);
        this.authStore.loadUser(this.http).subscribe({
          next: () => this.redirect(),
          error: () => this.redirect(),
        });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(this.messageOf(err));
      },
    });
  }

  private redirect(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    void this.router.navigateByUrl(returnUrl && returnUrl.startsWith('/') ? returnUrl : '/');
  }

  private messageOf(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401) {
        return this.transloco.translate('auth.login.error');
      }
      // A locked or disabled account says why in the server's own words.
      const body = err.error as { detail?: string } | null;
      if (body && typeof body === 'object' && body.detail) {
        return body.detail;
      }
    }
    return this.transloco.translate('auth.login.failed');
  }
}
