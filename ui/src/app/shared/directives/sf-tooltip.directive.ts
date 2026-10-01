import { DOCUMENT } from '@angular/common';
import { Directive, ElementRef, OnDestroy, booleanAttribute, effect, inject, input, numberAttribute } from '@angular/core';
import { AnchorSide, anchorPanel } from '../overlay/anchored-position';
import { sfUniqueId } from '../components/forms/sf-field-context';

/** How long the pointer may travel from the element to its tooltip (WCAG 1.4.13: hoverable). */
const HIDE_GRACE_MS = 120;

/**
 * A tooltip (M35.6): shown on hover after a delay and at once on keyboard focus, hidden on leave, blur and `Escape`,
 * and kept open while the pointer is over it. While shown, the element is `aria-describedby` the tooltip — unless
 * `sfTooltipDescribes` is false because the text already is the element's accessible name (icon-only buttons).
 * Never uses `title`. The tooltip is a `role=tooltip` element in `<body>`, styled by `design/_tooltip.scss`.
 *
 * ```html
 * <button sfTooltip="Copies the id" …>
 * ```
 */
@Directive({
  selector: '[sfTooltip]',
  standalone: true,
  host: {
    '(mouseenter)': 'scheduleShow()',
    '(mouseleave)': 'scheduleHide()',
    '(focusin)': 'onFocus()',
    '(focusout)': 'hide()',
    '(click)': 'hide()',
  },
})
export class SfTooltipDirective implements OnDestroy {
  readonly sfTooltip = input<string | null | undefined>('');
  readonly sfTooltipSide = input<AnchorSide>('top');
  /** False when the text already names the element (aria-label), so it isn't announced twice. */
  readonly sfTooltipDescribes = input(true, { transform: booleanAttribute });
  /** Hover delay in ms. */
  readonly sfTooltipDelay = input(500, { transform: numberAttribute });

  private static shown: SfTooltipDirective | null = null;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly id = sfUniqueId('sf-tooltip');
  private tip: HTMLElement | null = null;
  private stopAnchor: (() => void) | null = null;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.hide();
    }
  };

  constructor() {
    // Follow text changes while shown; an emptied text hides the tooltip.
    effect(() => {
      const text = this.sfTooltip();
      if (this.tip) {
        if (text) {
          this.tip.textContent = text;
        } else {
          this.hide();
        }
      }
    });
  }

  /** Whether the tooltip is on screen (for tests and hosts). */
  get visible(): boolean {
    return this.tip !== null;
  }

  protected scheduleShow(): void {
    this.cancelTimers();
    this.showTimer = setTimeout(() => this.show(), this.sfTooltipDelay());
  }

  protected scheduleHide(): void {
    this.cancelTimers();
    this.hideTimer = setTimeout(() => this.hide(), HIDE_GRACE_MS);
  }

  protected onFocus(): void {
    if (isKeyboardFocus(this.host)) {
      this.cancelTimers();
      this.show();
    }
  }

  show(): void {
    const text = this.sfTooltip();
    if (!text || this.tip) {
      return;
    }
    SfTooltipDirective.shown?.hide();
    SfTooltipDirective.shown = this;

    const tip = this.document.createElement('div');
    tip.id = this.id;
    tip.className = 'sf-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    tip.addEventListener('mouseenter', () => this.cancelTimers());
    tip.addEventListener('mouseleave', () => this.scheduleHide());
    this.document.body.appendChild(tip);
    this.tip = tip;
    this.stopAnchor = anchorPanel(this.host, tip, { side: this.sfTooltipSide(), align: 'center', offset: 6 });

    if (this.sfTooltipDescribes()) {
      const ids = (this.host.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      if (!ids.includes(this.id)) {
        this.host.setAttribute('aria-describedby', [...ids, this.id].join(' '));
      }
    }
    this.document.addEventListener('keydown', this.onKeydown, true);
  }

  hide(): void {
    this.cancelTimers();
    if (!this.tip) {
      return;
    }
    this.stopAnchor?.();
    this.stopAnchor = null;
    this.tip.remove();
    this.tip = null;
    if (SfTooltipDirective.shown === this) {
      SfTooltipDirective.shown = null;
    }
    const ids = (this.host.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== this.id);
    if (ids.length) {
      this.host.setAttribute('aria-describedby', ids.join(' '));
    } else {
      this.host.removeAttribute('aria-describedby');
    }
    this.document.removeEventListener('keydown', this.onKeydown, true);
  }

  ngOnDestroy(): void {
    this.hide();
  }

  private cancelTimers(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}

/** Focus from the keyboard (`:focus-visible`); a mouse click focusing a button shows no tooltip. */
function isKeyboardFocus(element: HTMLElement): boolean {
  const focused = element.ownerDocument.activeElement;
  const target = focused instanceof HTMLElement && element.contains(focused) ? focused : element;
  try {
    return target.matches(':focus-visible');
  } catch {
    return true; // engines without :focus-visible
  }
}
