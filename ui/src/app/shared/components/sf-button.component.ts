import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, computed, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SfTooltipDirective } from '../directives/sf-tooltip.directive';
import { SfIconComponent } from './sf-icon.component';

export type SfButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
export type SfButtonSize = 'sm' | 'md';

/**
 * The one button (M35.6).
 *
 * - Variants `primary | secondary | ghost | danger | danger-ghost`, sizes `sm | md` (heights follow the density).
 * - `icon` (leading) and `iconTrailing`.
 * - Icon-only: set `label` — it becomes the `aria-label` and the tooltip, and projected content is not shown.
 * - `loading`: a spinner, `aria-busy`, and clicks are swallowed (no double submit) while it stays focusable.
 * - `disabled`: native disabled; with `disabledReason` it stays focusable (`aria-disabled`) and the reason is its tooltip.
 * - `link` / `href`: renders an `<a>` (`link` is a `routerLink`), otherwise a `<button>` with `type`.
 * - `aria-label`, `aria-expanded`, `aria-controls`, `aria-haspopup`, `aria-pressed`, `aria-current`,
 *   `aria-describedby` and `aria-keyshortcuts` on `<sf-button>` are forwarded to the inner element.
 *
 * A blocked click never reaches `(click)` handlers on `<sf-button>`: the inner element stops it.
 */
@Component({
  selector: 'sf-button',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, SfIconComponent, SfTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-button.component.html',
  styleUrl: './sf-button.component.scss',
  host: {
    '[attr.aria-label]': 'null',
    '[attr.aria-expanded]': 'null',
    '[attr.aria-controls]': 'null',
    '[attr.aria-haspopup]': 'null',
    '[attr.aria-pressed]': 'null',
    '[attr.aria-current]': 'null',
    '[attr.aria-describedby]': 'null',
    '[attr.aria-keyshortcuts]': 'null',
  },
})
export class SfButtonComponent {
  readonly variant = input<SfButtonVariant>('primary');
  readonly size = input<SfButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Why the button is disabled; keeps it focusable so the reason can be read as its tooltip. */
  readonly disabledReason = input<string | null>(null);
  readonly loading = input(false, { transform: booleanAttribute });
  readonly icon = input<string | null>(null);
  readonly iconTrailing = input<string | null>(null);
  /** Makes the button icon-only: the accessible name and tooltip. */
  readonly label = input<string | null>(null);
  /** A tooltip for a button with visible text (icon-only buttons use `label`). */
  readonly tooltip = input<string | null>(null);
  /** A router link: renders an `<a routerLink>`. */
  readonly link = input<string | unknown[] | null>(null);
  readonly queryParams = input<Record<string, unknown> | null>(null);
  /** A plain URL: renders an `<a href>`. */
  readonly href = input<string | null>(null);
  readonly target = input<string | null>(null);

  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly ariaExpanded = input<boolean | 'true' | 'false' | null>(null, { alias: 'aria-expanded' });
  readonly ariaControls = input<string | null>(null, { alias: 'aria-controls' });
  readonly ariaHaspopup = input<string | boolean | null>(null, { alias: 'aria-haspopup' });
  readonly ariaPressed = input<boolean | 'true' | 'false' | 'mixed' | null>(null, { alias: 'aria-pressed' });
  readonly ariaCurrent = input<string | null>(null, { alias: 'aria-current' });
  readonly ariaDescribedBy = input<string | null>(null, { alias: 'aria-describedby' });
  readonly ariaKeyshortcuts = input<string | null>(null, { alias: 'aria-keyshortcuts' });

  private readonly element = viewChild<ElementRef<HTMLElement>>('element');

  protected readonly iconOnly = computed(() => !!this.label());
  protected readonly isLink = computed(() => this.link() !== null || this.href() !== null);
  /** Disabled but focusable: a reason to show, or a link (which has no native disabled state). */
  protected readonly softDisabled = computed(() => this.disabled() && (!!this.disabledReason() || this.isLink()));
  protected readonly nativeDisabled = computed(() => this.disabled() && !this.softDisabled());
  /** Clicks do nothing: disabled or busy. */
  protected readonly blocked = computed(() => this.disabled() || this.loading());
  protected readonly accessibleLabel = computed(() => this.ariaLabel() ?? this.label());
  protected readonly tooltipText = computed(() => {
    const parts = [this.iconOnly() ? this.label() : this.tooltip()];
    if (this.disabled() && this.disabledReason()) {
      parts.push(this.disabledReason());
    }
    return parts.filter((part) => !!part).join('\n') || null;
  });
  /** Describe the element by its tooltip unless the tooltip only repeats the accessible name. */
  protected readonly tooltipDescribes = computed(() => !this.iconOnly() || (this.disabled() && !!this.disabledReason()));
  protected readonly classes = computed(
    () =>
      `sf-button sf-button--${this.variant()} sf-button--${this.size()}` +
      (this.iconOnly() ? ' sf-button--icon-only' : '') +
      (this.blocked() ? ' sf-button--blocked' : '') +
      (this.disabled() ? ' sf-button--disabled' : ''),
  );

  /** Focuses the inner element (focus restore after a dialog, for example). */
  focus(): void {
    this.element()?.nativeElement.focus();
  }

  protected onClick(event: MouseEvent): void {
    if (this.blocked()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
}
