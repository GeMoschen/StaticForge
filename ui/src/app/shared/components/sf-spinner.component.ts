import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type SfSpinnerSize = 'sm' | 'md';

/**
 * Small loading indicator (M35.6): a ring plus a visible, announced text (`role=status`). Replaces bare "Loading…"
 * text; for content-shaped placeholders use `sf-skeleton`.
 *
 * - `label`: the text; the shared "Loading…" when omitted.
 * - `size`: `sm | md`.
 * - `inline`: no padding, for use inside a line of text or a control.
 */
@Component({
  selector: 'sf-spinner',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="sf-spinner"
      [class.sf-spinner--sm]="size() === 'sm'"
      [class.sf-spinner--inline]="inline()"
      role="status"
    >
      <span class="sf-spinner__ring" aria-hidden="true"></span>
      <span class="sf-spinner__label">{{ label() ?? ('common.loading' | transloco) }}</span>
    </div>
  `,
  styleUrl: './sf-spinner.component.scss',
})
export class SfSpinnerComponent {
  /** The visible and announced text; the shared "Loading…" when omitted. */
  readonly label = input<string | null>(null);
  readonly size = input<SfSpinnerSize>('md');
  /** No padding: sits inside a line of text or a control. */
  readonly inline = input(false, { transform: booleanAttribute });
}
