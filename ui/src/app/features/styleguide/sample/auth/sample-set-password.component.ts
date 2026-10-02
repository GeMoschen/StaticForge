import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { injectSampleQuery, injectSampleText, oneOf } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { checkPassword } from './auth-password.util';
import { SampleAuthCardComponent } from './sample-auth-card.component';
import { SamplePasswordChecklistComponent } from './sample-password-checklist.component';

/**
 * The Set password screen (M35.16), outside the frame and in the card style of Sign in: a new password and its
 * confirmation with the live checklist (neutral while empty; the length limit, in characters, only once exceeded).
 * *Set password* stays disabled until every rule is met; it opens Pages and says so in a toast.
 *
 * Query parameter `pstate=filled|toolong` opens the screen with a good or an over-long password.
 */
@Component({
  selector: 'sf-sample-set-password',
  standalone: true,
  imports: [SampleAuthCardComponent, SamplePasswordChecklistComponent, SfButtonComponent, SfFieldComponent, SfInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-login.component.scss',
  template: `
    <sf-sample-auth-card>
      <h1 class="title">{{ t('setPassword.title') }}</h1>
      <p class="lead">{{ t('setPassword.lead') }}</p>
      <form class="form" novalidate (submit)="submit($event)">
        <sf-field [label]="t('setPassword.new')">
          <div class="password">
            <sf-input
              class="password__input"
              [type]="visible() ? 'text' : 'password'"
              [value]="password()"
              autocomplete="new-password"
              (valueChange)="password.set($event)"
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
        <sf-field [label]="t('setPassword.confirm')">
          <sf-input [type]="visible() ? 'text' : 'password'" [value]="confirm()" autocomplete="new-password" (valueChange)="confirm.set($event)" />
        </sf-field>
        <sf-sample-password-checklist [check]="check()" />
        <sf-button
          class="submit"
          type="submit"
          [disabled]="!check().valid"
          [disabledReason]="check().valid ? null : t('setPassword.needRules')"
        >
          {{ t('setPassword.submit') }}
        </sf-button>
      </form>
    </sf-sample-auth-card>
  `,
})
export class SampleSetPasswordComponent {
  private readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);
  protected readonly t = injectSampleText('styleguide.sample.auth');

  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly visible = signal(false);
  protected readonly check = computed(() => checkPassword(this.password(), this.confirm()));

  constructor() {
    const start = oneOf(injectSampleQuery().get('pstate'), ['filled', 'toolong'] as const);
    if (start === 'filled') {
      this.password.set('Correct-horse-42');
      this.confirm.set('Correct-horse-42');
    } else if (start === 'toolong') {
      const long = 'Correct-horse-42'.repeat(5);
      this.password.set(long);
      this.confirm.set(long);
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.check().valid) {
      this.toasts.show(this.t('setPassword.done'), 'success');
      this.state.openArea('pages');
    }
  }
}
