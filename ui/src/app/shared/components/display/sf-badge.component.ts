import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SfIconComponent } from '../sf-icon.component';

export type SfBadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

/**
 * A small count or label badge (M35.6), e.g. a count next to a tab or a "Draft" label.
 *
 * - `tone`: `neutral | accent | info | success | warning | danger` — colour only; when the tone carries meaning, the
 *   text must say it too (or use `sf-status`, which adds an icon).
 * - `icon`: an optional leading icon (decorative).
 * - The text is `label` or projected content.
 */
@Component({
  selector: 'sf-badge',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (icon()) {
      <sf-icon class="sf-badge__icon" [name]="icon()!" />
    }
    @if (label()) {
      <span class="sf-badge__label">{{ label() }}</span>
    }
    <ng-content />
  `,
  styleUrl: './sf-badge.component.scss',
  host: {
    '[class]': 'classes()',
  },
})
export class SfBadgeComponent {
  readonly tone = input<SfBadgeTone>('neutral');
  readonly icon = input<string | null>(null);
  readonly label = input<string | null>(null);

  protected readonly classes = computed(() => `sf-badge sf-badge--${this.tone()}`);
}
