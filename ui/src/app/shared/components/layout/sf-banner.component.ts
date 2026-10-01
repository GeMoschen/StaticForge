import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfButtonComponent } from '../sf-button.component';
import { SfIconComponent } from '../sf-icon.component';

export type SfBannerTone = 'info' | 'success' | 'warning' | 'danger';
export type SfBannerLive = 'off' | 'polite' | 'assertive';

const TONE_ICONS: Record<SfBannerTone, string> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
};

/**
 * An inline message banner (M35.6): a tone icon, an optional bold `title`, the projected message and projected actions
 * (`[sfBannerActions]`).
 *
 * - `tone`: `info | success | warning | danger`. Besides colour and icon, a visually hidden prefix ("Warning") says the
 *   tone to screen readers.
 * - `dismissible`: an icon-only "Dismiss" button; it hides the banner and emits `dismissed` (the host decides whether
 *   it comes back, and where focus goes if it matters).
 * - `live`: not a live region by default (a banner present on load is just content). Use `polite` (`role=status`) or
 *   `assertive` (`role=alert`) when the banner appears in response to an action and must be announced.
 */
@Component({
  selector: 'sf-banner',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isDismissed()) {
      <div [class]="'sf-banner sf-banner--' + tone()" [attr.role]="role()">
        <sf-icon class="sf-banner__icon" [name]="icon()" />
        <div class="sf-banner__content">
          <span class="sf-sr-only">{{ toneKey() | transloco }}: </span>
          @if (title()) {
            <strong class="sf-banner__title">{{ title() }}</strong>
          }
          <div class="sf-banner__message"><ng-content /></div>
        </div>
        <div class="sf-banner__actions"><ng-content select="[sfBannerActions]" /></div>
        @if (dismissible()) {
          <sf-button
            class="sf-banner__dismiss"
            variant="ghost"
            size="sm"
            icon="close"
            [label]="'shared.banner.dismiss' | transloco"
            (click)="dismiss()"
          />
        }
      </div>
    }
  `,
  styleUrl: './sf-banner.component.scss',
  host: {
    '[class.sf-banner-host--dismissed]': 'isDismissed()',
  },
})
export class SfBannerComponent {
  readonly tone = input<SfBannerTone>('info');
  readonly title = input<string | null>(null);
  readonly dismissible = input(false, { transform: booleanAttribute });
  readonly live = input<SfBannerLive>('off');

  readonly dismissed = output<void>();

  protected readonly isDismissed = signal(false);
  protected readonly icon = computed(() => TONE_ICONS[this.tone()]);
  protected readonly toneKey = computed(() => `shared.banner.tone.${this.tone()}`);
  protected readonly role = computed(() => {
    switch (this.live()) {
      case 'polite':
        return 'status';
      case 'assertive':
        return 'alert';
      default:
        return null;
    }
  });

  /** Hides the banner and emits `dismissed`. */
  dismiss(): void {
    this.isDismissed.set(true);
    this.dismissed.emit();
  }
}
