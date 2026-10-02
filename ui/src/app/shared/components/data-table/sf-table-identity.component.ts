import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { SfAvatarComponent } from '../display/sf-avatar.component';

/**
 * The two-line cell of a data table (M35.16): what a row is *called* on the first line (medium weight, with optional
 * badges set apart from it) and a muted line below it — an identifier (`@username`, a project key, in monospace with
 * `mono`) or a short description. An optional avatar leads it. Use it in every column that would otherwise stack two
 * lines, together with `twoLine` on the table, which gives the rows the height those two lines need.
 *
 * ```html
 * <sf-table-identity [name]="row.name" [sub]="row.key" mono>
 *   <sf-badge sfTableIdentityBadge … />
 * </sf-table-identity>
 * ```
 */
@Component({
  selector: 'sf-table-identity',
  standalone: true,
  imports: [SfAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-table-identity.component.scss',
  host: { class: 'sf-table-identity' },
  template: `
    @if (avatar(); as person) {
      <sf-avatar size="md" [name]="person" />
    }
    <span class="sf-table-identity__text">
      <span class="sf-table-identity__title">
        <span class="sf-table-identity__name">{{ name() }}</span>
        <ng-content />
      </span>
      @if (sub()) {
        <span class="sf-table-identity__sub" [class.is-mono]="mono()">{{ sub() }}</span>
      }
    </span>
  `,
})
export class SfTableIdentityComponent {
  /** The first line. */
  readonly name = input.required<string>();
  /** The muted second line. */
  readonly sub = input<string | null | undefined>(null);
  /** The second line is an identifier: monospace. */
  readonly mono = input(false, { transform: booleanAttribute });
  /** A person's name: shows their avatar before the text. */
  readonly avatar = input<string | null | undefined>(null);
}
