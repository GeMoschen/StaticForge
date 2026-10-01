import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfMenuComponent, SfMenuItem } from '../menu/sf-menu.component';

/**
 * A page's header (M35.6): breadcrumb, the page's one `h1`, a subtitle, a status and the page actions.
 *
 * Slots (attribute selectors on the projected element):
 * - `[sfPageHeaderBreadcrumb]`: above the title (e.g. a `<nav aria-label>` breadcrumb);
 * - `[sfPageHeaderStatus]`: beside the title (e.g. an `sf-status`);
 * - `[sfPageHeaderActions]`: the primary actions, at the end of the title row.
 *
 * `secondaryActions` go into a "More actions" menu after the primary actions; choosing one emits `secondaryAction`.
 * At narrow widths the title wraps (never truncated) and the actions wrap below it.
 */
@Component({
  selector: 'sf-page-header',
  standalone: true,
  imports: [SfMenuComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[sfPageHeaderBreadcrumb]" />
    <div class="sf-page-header__main">
      <div class="sf-page-header__heading">
        <div class="sf-page-header__title-row">
          <h1 class="sf-page-header__title">{{ title() }}</h1>
          <ng-content select="[sfPageHeaderStatus]" />
        </div>
        @if (subtitle()) {
          <p class="sf-page-header__subtitle">{{ subtitle() }}</p>
        }
      </div>
      <div class="sf-page-header__actions">
        <ng-content select="[sfPageHeaderActions]" />
        @if (secondaryActions().length) {
          <sf-menu
            variant="secondary"
            [items]="secondaryActions()"
            [label]="'shared.pageHeader.moreActions' | transloco"
            (itemSelected)="secondaryAction.emit($event)"
          />
        }
      </div>
    </div>
  `,
  styleUrl: './sf-page-header.component.scss',
  host: {
    class: 'sf-page-header',
  },
})
export class SfPageHeaderComponent {
  /** The page title, rendered as the page's `h1`. */
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  /** Less frequent page actions, in a "More actions" menu. */
  readonly secondaryActions = input<readonly SfMenuItem[]>([]);

  readonly secondaryAction = output<SfMenuItem>();
}
