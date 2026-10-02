import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { injectSampleQuery, injectSampleText, oneOf } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { SampleAuthCardComponent } from './sample-auth-card.component';

/** How long the sample pretends to sign in. */
const SIGN_IN_MS = 900;
/** The password that makes the sample refuse (any other signs in). */
export const WRONG_PASSWORD = 'wrong';

/**
 * The Sign in screen (M35.16), outside the frame: the card with the mark, a short lead, Username and Password (with a
 * show/hide toggle), a primary *Sign in* that stays disabled until both are filled, a busy state, and errors inline
 * in a banner. The password `wrong` is refused; anything else opens Pages. No implementation text on the page.
 *
 * Query parameter `lstate=filled|error|busy` opens the screen in that state.
 */
@Component({
  selector: 'sf-sample-login',
  standalone: true,
  imports: [SampleAuthCardComponent, SfBannerComponent, SfButtonComponent, SfFieldComponent, SfInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-login.component.scss',
  template: `
    <sf-sample-auth-card>
      <h1 class="title">{{ t('login.title') }}</h1>
      <p class="lead">{{ t('login.lead') }}</p>
      <form class="form" novalidate (submit)="submit($event)">
        @if (error()) {
          <sf-banner tone="danger" live="assertive">{{ error() }}</sf-banner>
        }
        <sf-field [label]="t('login.username')">
          <sf-input [value]="username()" autocomplete="username" (valueChange)="edit('username', $event)" />
        </sf-field>
        <sf-field [label]="t('login.password')">
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
              [label]="t(visible() ? 'login.hide' : 'login.show')"
              [aria-pressed]="visible()"
              (click)="visible.set(!visible())"
            />
          </div>
        </sf-field>
        <sf-button
          class="submit"
          type="submit"
          [disabled]="!ready()"
          [disabledReason]="ready() ? null : t('login.needBoth')"
          [loading]="busy()"
        >
          {{ busy() ? t('login.busy') : t('login.submit') }}
        </sf-button>
      </form>
      <span sfAuthFooter>{{ t('login.forgot') }}</span>
    </sf-sample-auth-card>
  `,
})
export class SampleLoginComponent {
  private readonly state = inject(SampleState);
  protected readonly t = injectSampleText('styleguide.sample.auth');

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly visible = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ready = computed(() => this.username().trim() !== '' && this.password() !== '' && !this.busy());

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
    const start = oneOf(injectSampleQuery().get('lstate'), ['filled', 'error', 'busy'] as const);
    if (start) {
      this.username.set('ada');
      this.password.set(start === 'error' ? WRONG_PASSWORD : 'demo-password');
      this.error.set(start === 'error' ? this.t('login.error') : null);
      this.busy.set(start === 'busy');
    }
  }

  protected edit(field: 'username' | 'password', value: string): void {
    (field === 'username' ? this.username : this.password).set(value);
    this.error.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.ready()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.password() === WRONG_PASSWORD) {
        this.busy.set(false);
        this.error.set(this.t('login.error'));
      } else {
        this.state.openArea('pages');
      }
    }, SIGN_IN_MS);
  }
}
