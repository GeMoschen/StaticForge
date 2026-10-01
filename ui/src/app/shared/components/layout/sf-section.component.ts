import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfHeadingLevel, headingLevelAttribute } from './heading-level';

/**
 * A titled card (M35.6): a `<section>` labelled by its heading, with an optional description, header actions and a body.
 *
 * - `heading` renders as a real `h2`–`h6` per `level` (default 2), so the page outline stays correct.
 * - `[sfSectionActions]`: projected header actions (end of the header row); everything else is the body.
 */
@Component({
  selector: 'sf-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sf-section" [attr.aria-labelledby]="headingId">
      <div class="sf-section__header">
        <div class="sf-section__titles">
          @switch (level()) {
            @case (3) {
              <h3 class="sf-section__heading" [id]="headingId">{{ heading() }}</h3>
            }
            @case (4) {
              <h4 class="sf-section__heading" [id]="headingId">{{ heading() }}</h4>
            }
            @case (5) {
              <h5 class="sf-section__heading" [id]="headingId">{{ heading() }}</h5>
            }
            @case (6) {
              <h6 class="sf-section__heading" [id]="headingId">{{ heading() }}</h6>
            }
            @default {
              <h2 class="sf-section__heading" [id]="headingId">{{ heading() }}</h2>
            }
          }
          @if (description()) {
            <p class="sf-section__description">{{ description() }}</p>
          }
        </div>
        <div class="sf-section__actions"><ng-content select="[sfSectionActions]" /></div>
      </div>
      <div class="sf-section__body"><ng-content /></div>
    </section>
  `,
  styleUrl: './sf-section.component.scss',
})
export class SfSectionComponent {
  readonly heading = input.required<string>();
  /** The heading level (2–6). */
  readonly level = input<SfHeadingLevel, unknown>(2, { transform: headingLevelAttribute });
  readonly description = input<string | null>(null);

  protected readonly headingId = sfUniqueId('sf-section-heading');
}
