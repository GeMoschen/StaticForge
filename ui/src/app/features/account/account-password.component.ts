import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { AccountDraftStore } from './account-draft.store';
import { AccountSaveComponent } from './account-save.component';
import { PasswordFieldsComponent } from './password-fields.component';

/**
 * My account › Password: the current password, the new one with its live checklist and the confirmation, with the page's
 * save area. Changing the password signs every other session out; this one stays signed in (the session signs straight
 * back in with the new password).
 */
@Component({
  selector: 'sf-account-password',
  standalone: true,
  imports: [AccountSaveComponent, PasswordFieldsComponent, SfBannerComponent, SfPageHeaderComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-password.component.scss',
  template: `
    <sf-page-header [title]="'account.sections.password' | transloco">
      <sf-account-save sfPageHeaderActions section="password" />
    </sf-page-header>

    <div class="page__scroll">
      <p class="page__note">{{ 'account.password.note' | transloco }}</p>
      <form class="page__form" novalidate (submit)="$event.preventDefault()">
        @if (store.passwordError(); as message) {
          <sf-banner tone="danger" live="assertive">{{ message }}</sf-banner>
        }
        <sf-password-fields
          [policy]="store.policy.policy()"
          [currentError]="store.currentError()"
          [(current)]="store.current"
          [(next)]="store.next"
          [(confirm)]="store.confirm"
        />
      </form>
    </div>
  `,
})
export class AccountPasswordComponent {
  protected readonly store = inject(AccountDraftStore);
}
