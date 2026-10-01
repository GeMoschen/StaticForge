import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { I18nFormatService, toDate } from '../../../core/i18n/i18n-format.service';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
import { formatRelativeTime } from '../../pipes/sf-relative-time.pipe';

/** How often the wording is refreshed; its finest unit is a minute. */
export const RELATIVE_TIME_REFRESH_MS = 30_000;

/**
 * A relative time ("5 min ago") in a `<time datetime>` (M35.6), with the absolute date and time as its tooltip.
 *
 * - The wording is the `sfRelativeTime` pipe's and refreshes every 30 s while shown.
 * - Invalid or missing input renders an em dash (no tooltip, no `datetime`).
 * - A valid time is a tab stop (`tabindex=0`): the absolute time lives only in the tooltip, and keyboard users must be
 *   able to bring it up (WCAG 2.1.1); on focus the tooltip also describes the element for screen readers.
 */
@Component({
  selector: 'sf-relative-time',
  standalone: true,
  imports: [SfTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<time
    class="sf-relative-time"
    [attr.datetime]="iso()"
    [attr.tabindex]="iso() ? 0 : null"
    [sfTooltip]="absolute()"
    >{{ relative() }}</time
  >`,
  styleUrl: './sf-relative-time.component.scss',
})
export class SfRelativeTimeComponent {
  readonly value = input<Date | string | number | null | undefined>(null);

  private readonly format = inject(I18nFormatService);
  private readonly now = signal(new Date());

  private readonly date = computed(() => toDate(this.value()));
  protected readonly iso = computed(() => this.date()?.toISOString() ?? null);
  protected readonly relative = computed(() => formatRelativeTime(this.format, this.date(), this.now()));
  protected readonly absolute = computed(() => (this.date() ? this.format.dateTime(this.date()) : null));

  constructor() {
    const timer = setInterval(() => this.now.set(new Date()), RELATIVE_TIME_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
