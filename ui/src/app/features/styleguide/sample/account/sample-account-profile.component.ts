import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { ProfileForm } from './account-data';
import { AccountState } from './account-state';
import { SampleAccountSaveComponent } from './sample-account-save.component';

/**
 * My account › Profile: display name, username and email with the page's save area. Changing the username or the
 * email reveals a *Current password* field (hint: needed to change them); a refused save names what is missing.
 */
@Component({
  selector: 'sf-sample-account-profile',
  standalone: true,
  imports: [SampleAccountSaveComponent, SfFieldComponent, SfInputComponent, SfPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-profile.component.scss',
  template: `
    <sf-page-header [title]="t('sections.profile')">
      <sf-sample-account-save
        sfPageHeaderActions
        [dirty]="state.profileDirty()"
        [errors]="errorCount()"
        (save)="save()"
        (discard)="state.discardSection('profile')"
      />
    </sf-page-header>

    <div class="page__scroll">
      <div class="page__form">
        <sf-field [label]="t('profile.displayName')" required [error]="state.profileErrors().displayName ?? null">
          <sf-input [value]="state.profile().displayName" autocomplete="name" (valueChange)="patch({ displayName: $event })" />
        </sf-field>
        <sf-field [label]="t('profile.username')">
          <sf-input [value]="state.profile().username" autocomplete="username" (valueChange)="patch({ username: $event })" />
        </sf-field>
        <sf-field [label]="t('profile.email')" required [error]="state.profileErrors().email ?? null">
          <sf-input type="email" [value]="state.profile().email" autocomplete="email" (valueChange)="patch({ email: $event })" />
        </sf-field>
        @if (state.needsCurrentPassword()) {
          <sf-field [label]="t('profile.current')" required [hint]="t('profile.currentHint')" [error]="state.profileErrors().currentPassword ?? null">
            <sf-input type="password" [value]="state.profilePassword()" autocomplete="current-password" (valueChange)="state.profilePassword.set($event)" />
          </sf-field>
        }
      </div>
    </div>
  `,
})
export class SampleAccountProfileComponent {
  protected readonly state = inject(AccountState);
  protected readonly t = this.state.t;

  protected errorCount(): number {
    return Object.keys(this.state.profileErrors()).length;
  }

  protected patch(change: Partial<ProfileForm>): void {
    this.state.profile.update((p) => ({ ...p, ...change }));
    this.state.profileErrors.set({});
  }

  protected save(): void {
    if (this.state.saveSection('profile').ok) {
      this.state.notice('profile.saved');
    }
  }
}
