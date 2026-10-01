import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SfIconComponent } from '../sf-icon.component';

export type SfStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
export type SfStatusSize = 'sm' | 'md';

/** The icon each tone shows unless `icon` overrides it: the shape is a second cue next to the colour. */
const TONE_ICONS: Record<SfStatusTone, string> = {
  neutral: 'radio_button_unchecked',
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
  accent: 'fiber_manual_record',
};

/**
 * A status pill (M35.6): an icon plus text, so colour is never the only cue ("Published", "Failed", "Running").
 *
 * - `tone`: `neutral | info | success | warning | danger | accent`; each has a default icon (`icon` overrides it).
 * - `label`: the status text — always visible, it is what screen readers read (the icon is decorative).
 * - `size`: `sm | md`.
 */
@Component({
  selector: 'sf-status',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-icon class="sf-status__icon" [name]="iconName()" />
    <span class="sf-status__label">{{ label() }}</span>
  `,
  styleUrl: './sf-status.component.scss',
  host: {
    '[class]': 'classes()',
  },
})
export class SfStatusComponent {
  readonly tone = input<SfStatusTone>('neutral');
  readonly label = input.required<string>();
  readonly icon = input<string | null>(null);
  readonly size = input<SfStatusSize>('md');

  protected readonly iconName = computed(() => this.icon() ?? TONE_ICONS[this.tone()]);
  protected readonly classes = computed(() => `sf-status sf-status--${this.tone()} sf-status--${this.size()}`);
}
