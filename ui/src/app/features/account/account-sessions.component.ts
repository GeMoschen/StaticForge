import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SessionService } from '../../core/auth/session.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';

/**
 * My account › Sessions: what *Sign out of all sessions* does (every browser and device, this one included) and the
 * button — a secondary one, since it is reversible by signing in again — behind a confirmation. The server can only
 * revoke all sessions at once, so there is no list.
 */
@Component({
  selector: 'sf-account-sessions',
  standalone: true,
  imports: [SfButtonComponent, SfPageHeaderComponent, SfSectionComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-sessions.component.scss',
  template: `
    <sf-page-header [title]="'account.sections.sessions' | transloco" />

    <div class="page__scroll">
      <sf-section class="sessions" [heading]="'account.sessions.heading' | transloco">
        <div class="sessions__row">
          <p class="sessions__text">{{ 'account.sessions.text' | transloco }}</p>
          <sf-button variant="secondary" icon="logout" [loading]="busy()" (click)="signOutAll()">{{
            'account.sessions.button' | transloco
          }}</sf-button>
        </div>
      </sf-section>
    </div>
  `,
})
export class AccountSessionsComponent {
  private readonly confirms = inject(ConfirmService);
  private readonly session = inject(SessionService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly busy = signal(false);

  protected async signOutAll(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: this.transloco.translate('account.sessions.confirmTitle'),
      message: this.transloco.translate('account.sessions.confirmMessage'),
      confirmLabel: this.transloco.translate('account.sessions.confirm'),
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.session.signOutEverywhere().subscribe({
      next: () => this.toasts.show(this.transloco.translate('account.sessions.done'), 'success'),
      error: () => {
        this.busy.set(false);
        this.toasts.show(this.transloco.translate('account.sessions.failed'), 'error');
      },
    });
  }
}
