import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../../shared/components/layout/sf-section.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { AccountState } from './account-state';

/**
 * My account › Sessions: what *Sign out of all sessions* does (every browser and device, this one included) and the
 * button, a secondary one (it is reversible by signing in again), behind a confirmation. The server can only revoke all
 * sessions at once, so there is no list.
 */
@Component({
  selector: 'sf-sample-account-sessions',
  standalone: true,
  imports: [SfButtonComponent, SfPageHeaderComponent, SfSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-sessions.component.scss',
  template: `
    <sf-page-header [title]="t('sections.sessions')" />

    <div class="page__scroll">
      <sf-section class="sessions" [heading]="t('sessions.heading')">
        <div class="sessions__row">
          <p class="sessions__text">{{ t('sessions.text') }}</p>
          <sf-button variant="secondary" icon="logout" (click)="signOutAll()">{{ t('sessions.button') }}</sf-button>
        </div>
      </sf-section>
    </div>
  `,
})
export class SampleAccountSessionsComponent {
  private readonly confirms = inject(ConfirmService);
  private readonly account = inject(AccountState);
  protected readonly t = this.account.t;

  protected async signOutAll(): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('sessions.confirmTitle'),
      message: this.t('sessions.confirmMessage'),
      confirmLabel: this.t('sessions.confirm'),
    });
    if (confirmed) {
      this.account.notice('sessions.done');
    }
  }
}
