import { ChangeDetectionStrategy, Component, computed, input, numberAttribute } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type SfSkeletonShape = 'text' | 'row' | 'tree' | 'table' | 'form';

/** Bar widths (%) cycled through, so the placeholder reads like real, ragged content. */
const WIDTHS = [92, 76, 84, 64, 88, 70];
/** Tree indent steps cycled through (a parent, two children, a grandchild, …). */
const INDENTS = [0, 1, 1, 2, 1, 0];
const TABLE_COLUMNS = 4;

/**
 * A loading placeholder in the shape of the content to come (M35.6): `text` (`lines`), `row` / `tree` / `table` / `form`
 * (`rows`). Sizes follow the density tokens, so the layout doesn't jump when the content arrives.
 *
 * The container is `role=status` and `aria-busy=true` with a visually hidden "Loading…" (`label` overrides it); the
 * shapes are hidden from assistive tech. The shimmer stops under reduced motion (global rule).
 */
@Component({
  selector: 'sf-skeleton',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sf-skeleton" [class]="'sf-skeleton--' + shape()" role="status" aria-busy="true">
      <span class="sf-sr-only">{{ label() ?? ('common.loading' | transloco) }}</span>
      <div class="sf-skeleton__shapes" aria-hidden="true">
        @switch (shape()) {
          @case ('row') {
            @for (item of items(); track $index) {
              <div class="sf-skeleton__row">
                <span class="sf-skeleton__block sf-skeleton__icon"></span>
                <span class="sf-skeleton__block sf-skeleton__bar" [style.inline-size.%]="item.width"></span>
              </div>
            }
          }
          @case ('tree') {
            @for (item of items(); track $index) {
              <div class="sf-skeleton__row" [attr.data-indent]="item.indent">
                <span class="sf-skeleton__block sf-skeleton__icon"></span>
                <span class="sf-skeleton__block sf-skeleton__bar" [style.inline-size.%]="item.width / 2"></span>
              </div>
            }
          }
          @case ('table') {
            <div class="sf-skeleton__table-row sf-skeleton__table-row--head">
              @for (column of columns; track $index) {
                <span class="sf-skeleton__block sf-skeleton__bar" [style.inline-size.%]="40"></span>
              }
            </div>
            @for (item of items(); track $index) {
              <div class="sf-skeleton__table-row">
                @for (column of columns; track $index) {
                  <span class="sf-skeleton__block sf-skeleton__bar" [style.inline-size.%]="item.width - column * 8"></span>
                }
              </div>
            }
          }
          @case ('form') {
            @for (item of items(); track $index) {
              <div class="sf-skeleton__field">
                <span class="sf-skeleton__block sf-skeleton__bar" [style.inline-size.%]="item.width / 3"></span>
                <span class="sf-skeleton__block sf-skeleton__control"></span>
              </div>
            }
          }
          @default {
            @for (item of items(); track $index; let last = $last) {
              <span
                class="sf-skeleton__block sf-skeleton__bar sf-skeleton__line"
                [style.inline-size.%]="last && items().length > 1 ? 60 : item.width"
              ></span>
            }
          }
        }
      </div>
    </div>
  `,
  styleUrl: './sf-skeleton.component.scss',
})
export class SfSkeletonComponent {
  readonly shape = input<SfSkeletonShape>('text');
  /** Lines of a `text` skeleton. */
  readonly lines = input(3, { transform: numberAttribute });
  /** Rows of a `row`, `tree`, `table` or `form` skeleton (fields for `form`). */
  readonly rows = input(5, { transform: numberAttribute });
  /** What is loading, read by screen readers; "Loading…" when omitted. */
  readonly label = input<string | null>(null);

  protected readonly columns = Array.from({ length: TABLE_COLUMNS }, (_, index) => index);
  protected readonly items = computed(() => {
    const count = Math.max(1, Math.floor((this.shape() === 'text' ? this.lines() : this.rows()) || 1));
    return Array.from({ length: count }, (_, index) => ({
      width: WIDTHS[index % WIDTHS.length],
      indent: INDENTS[index % INDENTS.length],
    }));
  });
}
