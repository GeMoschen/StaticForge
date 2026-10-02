import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { AccountDraftStore } from './account-draft.store';
import { AccountSaveComponent } from './account-save.component';

/**
 * My account › Profile: display name, username and email with the page's save area. Changing the username or the email
 * reveals a *Current password* field (hint: needed to change them); a refused save names what is wrong, on the field.
 */
@Component({
  selector: 'sf-account-profile',
  standalone: true,
  imports: [AccountSaveComponent, SfBannerComponent, SfFieldComponent, SfInputComponent, SfPageHeaderComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-profile.component.scss',
  template: `
    <sf-page-header [title]="'account.sections.profile' | transloco">
      <sf-account-save sfPageHeaderActions section="profile" />
    </sf-page-header>

    <div class="page__scroll">
      <form class="page__form" novalidate (submit)="$event.preventDefault()">
        @if (store.profileError(); as message) {
          <sf-banner tone="danger" live="assertive">{{ message }}</sf-banner>
        }
        <sf-field [label]="'account.profile.displayName' | transloco" required [error]="store.profileErrors().displayName ?? null">
          <sf-input [value]="store.displayName()" autocomplete="name" (valueChange)="edit(store.displayName, $event)" />
        </sf-field>
        <sf-field [label]="'account.profile.username' | transloco" required [error]="store.profileErrors().username ?? null">
          <sf-input [value]="store.username()" autocomplete="username" (valueChange)="edit(store.username, $event)" />
        </sf-field>
        <sf-field [label]="'account.profile.email' | transloco" required [error]="store.profileErrors().email ?? null">
          <sf-input type="email" [value]="store.email()" autocomplete="email" (valueChange)="edit(store.email, $event)" />
        </sf-field>
        @if (store.needsCurrentPassword()) {
          <sf-field
            [label]="'account.profile.current' | transloco"
            required
            [hint]="'account.profile.currentHint' | transloco"
            [error]="store.profileErrors().currentPassword ?? null"
          >
            <sf-input type="password" [value]="store.currentPassword()" autocomplete="current-password" (valueChange)="edit(store.currentPassword, $event)" />
          </sf-field>
        }
      </form>
    </div>
  `,
})
export class AccountProfileComponent {
  protected readonly store = inject(AccountDraftStore);

  /** An edit clears what the last refused save said. */
  protected edit(field: { set(value: string): void }, value: string): void {
    field.set(value);
    this.store.profileErrors.set({});
    this.store.profileError.set(null);
  }
}
