import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SfHeadingLevel, headingLevelAttribute } from './layout/heading-level';
import { SfButtonComponent } from './sf-button.component';
import { SfIconComponent } from './sf-icon.component';

/**
 * An empty state (M35.6): a muted illustration icon, a heading, a description, up to two actions and projected content.
 *
 * - `title`: the heading; the shared "Nothing here yet" when omitted. A real `h2`–`h6` per `level` (default 2).
 * - `icon`: a large, muted illustration (decorative).
 * - `primaryLabel` (+ `primaryIcon`) / `secondaryLabel`: render a primary / secondary `sf-button` that emit `primary` /
 *   `secondary`.
 */
@Component({
  selector: 'sf-empty-state',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-empty-state.component.html',
  styleUrl: './sf-empty-state.component.scss',
})
export class SfEmptyStateComponent {
  /** The heading; the shared "Nothing here yet" when omitted. */
  readonly title = input<string | null>(null);
  readonly description = input<string>();
  /** A decorative illustration icon. */
  readonly icon = input<string>();
  /** The heading level (2–6). */
  readonly level = input<SfHeadingLevel, unknown>(2, { transform: headingLevelAttribute });
  readonly primaryLabel = input<string | null>(null);
  readonly primaryIcon = input<string | null>(null);
  readonly secondaryLabel = input<string | null>(null);

  readonly primary = output<void>();
  readonly secondary = output<void>();
}
