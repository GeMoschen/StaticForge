import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * The StaticForge mark (M35.9 decision 3): three stacked pages — a static site built from layers — with a spark on the
 * front page, plus the wordmark. The back pages take `currentColor`, the front page the accent, so it works on the dark
 * top bar and on light surfaces. Decorative (`aria-hidden`) unless `label` names it; the wordmark is real text.
 * `src/favicon.svg` is the same mark with fixed colours.
 */
@Component({
  selector: 'sf-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-logo.component.scss',
  template: `
    <svg
      class="sf-logo__mark"
      viewBox="0 0 24 24"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label()"
      focusable="false"
    >
      <rect x="8" y="2" width="13" height="13" rx="3" fill="currentColor" opacity="0.3" />
      <rect x="5.5" y="5" width="13" height="13" rx="3" fill="currentColor" opacity="0.55" />
      <rect x="3" y="8" width="13" height="13" rx="3" class="sf-logo__front" />
      <path
        d="M6.5 17.5 9 14.5l2 2 3-4"
        fill="none"
        class="sf-logo__spark"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    @if (wordmark()) {
      <span class="sf-logo__word"><!-- i18n-ignore: the product name -->StaticForge</span>
    }
  `,
})
export class SfLogoComponent {
  /** Shows the name next to the mark. */
  readonly wordmark = input(true, { transform: booleanAttribute });
  /** An accessible name for the mark when it stands alone (a home link); otherwise it is decorative. */
  readonly label = input<string | null>(null);
}
