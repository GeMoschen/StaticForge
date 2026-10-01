import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
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
 * - Compact forms for tight places (a table cell per language, a tree row), M35.9: `detail` keeps a short visible label
 *   ("DE") and adds the state ("Released") as tooltip and screen-reader text; `iconOnly` shows just the icon, the label
 *   as tooltip and screen-reader text. Both keep the tone's icon, so the shape still tells the state apart.
 */
@Component({
  selector: 'sf-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent, SfTooltipDirective],
  template: `
    <span class="sf-status__body" [sfTooltip]="tooltipText()" [sfTooltipDescribes]="false">
      <sf-icon class="sf-status__icon" [name]="iconName()" />
      <span class="sf-status__label" [class.sf-sr-only]="iconOnly()">{{ label() }}</span>
      @if (detail()) {
        <span class="sf-sr-only">: {{ detail() }}</span>
      }
    </span>
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
  /** The state behind a short `label` ("Released" for "DE"): tooltip and screen-reader text. */
  readonly detail = input<string | null>(null);
  /** Only the icon shows; the label becomes tooltip and screen-reader text. */
  readonly iconOnly = input(false, { transform: booleanAttribute });

  protected readonly iconName = computed(() => this.icon() ?? TONE_ICONS[this.tone()]);
  protected readonly classes = computed(
    () => `sf-status sf-status--${this.tone()} sf-status--${this.size()}` + (this.iconOnly() ? ' sf-status--icon-only' : ''),
  );
  /**
   * What the tooltip shows for a compact form (none for the full pill, which says it all). It repeats what screen
   * readers already get from the text, so it never describes the pill.
   */
  protected readonly tooltipText = computed(() => {
    if (this.detail()) {
      return `${this.label()}: ${this.detail()}`;
    }
    return this.iconOnly() ? this.label() : null;
  });
}
