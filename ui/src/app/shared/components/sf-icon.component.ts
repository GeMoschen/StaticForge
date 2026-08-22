import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Wraps a single Material Symbols Outlined ligature. `size` defaults to
 * `1em` so the icon inherits whatever font-size it's placed inside
 * (buttons, table cells, nav items) without per-callsite sizing.
 */
@Component({
  selector: 'sf-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="material-symbols-outlined sf-icon" [style.font-size]="size()" aria-hidden="true">{{
      name()
    }}</span>
  `,
  styles: [
    `
      .sf-icon {
        display: inline-block;
      }
    `,
  ],
})
export class SfIconComponent {
  readonly name = input.required<string>();
  readonly size = input<string>('1em');
}
