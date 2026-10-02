import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SamplePasswordChecklistComponent } from '../auth/sample-password-checklist.component';
import { AccountState, PasswordForm } from './account-state';
import { SampleAccountSaveComponent } from './sample-account-save.component';

/**
 * My account › Password: the current password, a new one and its confirmation with the same live checklist as Set
 * password (neutral while empty; the length limit in characters, only once exceeded). Changing it signs out every other
 * session — the page says so. Save is enabled while anything is typed; a refusal says how many things are missing.
 */
@Component({
  selector: 'sf-sample-account-password',
  standalone: true,
  imports: [SampleAccountSaveComponent, SamplePasswordChecklistComponent, SfButtonComponent, SfFieldComponent, SfInputComponent, SfPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-password.component.scss',
  template: `
    <sf-page-header [title]="t('sections.password')">
      <sf-sample-account-save
        sfPageHeaderActions
        [dirty]="state.passwordDirty()"
        [errors]="state.passwordErrors()"
        (save)="save()"
        (discard)="state.discardSection('password')"
      />
    </sf-page-header>

    <div class="page__scroll">
      <p class="page__note">{{ t('password.note') }}</p>
      <div class="page__form">
        <sf-field [label]="t('password.current')" required>
          <sf-input type="password" [value]="state.password().current" autocomplete="current-password" (valueChange)="patch({ current: $event })" />
        </sf-field>
        <sf-field [label]="t('password.new')" required>
          <div class="password">
            <sf-input
              class="password__input"
              [type]="visible() ? 'text' : 'password'"
              [value]="state.password().next"
              autocomplete="new-password"
              (valueChange)="patch({ next: $event })"
            />
            <sf-button
              variant="ghost"
              [icon]="visible() ? 'visibility_off' : 'visibility'"
              [label]="t(visible() ? 'password.hide' : 'password.show')"
              [aria-pressed]="visible()"
              (click)="visible.set(!visible())"
            />
          </div>
        </sf-field>
        <sf-field [label]="t('password.confirm')" required>
          <sf-input
            [type]="visible() ? 'text' : 'password'"
            [value]="state.password().confirm"
            autocomplete="new-password"
            (valueChange)="patch({ confirm: $event })"
          />
        </sf-field>
        <sf-sample-password-checklist [check]="state.passwordCheck()" />
      </div>
    </div>
  `,
})
export class SampleAccountPasswordComponent {
  protected readonly state = inject(AccountState);
  protected readonly t = this.state.t;
  protected readonly visible = signal(false);

  protected patch(change: Partial<PasswordForm>): void {
    this.state.password.update((p) => ({ ...p, ...change }));
    this.state.passwordErrors.set(0);
  }

  protected save(): void {
    if (this.state.saveSection('password').ok) {
      this.state.notice('password.saved');
    }
  }
}
