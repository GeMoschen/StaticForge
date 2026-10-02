import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { formatRevisionTime, injectHistoryActions } from './history-actions';
import { revisionById } from './history-data';

/**
 * The time-travel banner (M35.9 review round 2, M35.12): a calm full-width strip under the top bar for as long as
 * the screen shows an old state — "Viewing revision 86 · 12 Sep 14:03 · by Jonas Weber", a *Read-only* badge,
 * **Back to now** and **Restore this state** (a project roll-back: a danger action with a typed confirmation). The
 * frame around the screens carries a matching accent (`.is-time-travel` on the main region), so the state is obvious
 * even when the banner is scrolled out of mind. Every screen is read-only meanwhile.
 */
@Component({
  selector: 'sf-sample-time-travel-banner',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (revision(); as rev) {
      <div class="tt" role="status">
        <sf-icon class="tt__icon" name="history_toggle_off" />
        <p class="tt__text">
          <strong>{{ t('banner.viewing', { n: rev.id }) }}</strong>
          <span class="tt__meta">{{ when() }} · {{ t('banner.by', { name: rev.by.name }) }}</span>
        </p>
        <sf-badge tone="info" icon="lock" [label]="t('banner.readOnly')" />
        <span class="tt__actions">
          <sf-button variant="secondary" size="sm" icon="arrow_back" (click)="state.travel.set(null)">{{ t('banner.back') }}</sf-button>
          <sf-button variant="secondary" size="sm" icon="restore" (click)="restore()">{{ t('banner.restore') }}</sf-button>
        </span>
      </div>
    }
  `,
  styleUrl: './sample-time-travel-banner.component.scss',
})
export class SampleTimeTravelBannerComponent {
  protected readonly state = inject(SampleState);
  protected readonly t = injectSampleText('styleguide.sample.history');
  private readonly actions = injectHistoryActions();

  protected readonly revision = computed(() => {
    const id = this.state.travel();
    return id === null ? null : revisionById(id);
  });
  protected readonly when = computed(() => formatRevisionTime(this.revision()?.minutes ?? 0));

  protected restore(): void {
    const rev = this.revision();
    if (rev) {
      void this.actions.rollBack(rev);
    }
  }
}
