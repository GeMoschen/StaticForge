import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  numberAttribute,
  signal,
} from '@angular/core';

/** The rows to render for a scroll position, and the space the others take above and below. */
export interface VirtualWindow {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
  /** Height of the rows above `start`, in px. */
  before: number;
  /** Height of the rows from `end` on, in px. */
  after: number;
}

/** How many rows render before the viewport has been measured (first paint, a hidden container, jsdom). */
export const UNMEASURED_ROWS = 100;

/**
 * The window of fixed-height rows to render (M35.8). Pure, for tests. With no layout (`viewportHeight` 0: before the
 * first measurement, inside a hidden container, in jsdom) the first {@link UNMEASURED_ROWS} rows render — a list is
 * never empty just because it hasn't been measured, and a huge one doesn't render all its rows at once.
 */
export function computeVirtualWindow(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 8,
): VirtualWindow {
  if (count <= 0) {
    return { start: 0, end: 0, before: 0, after: 0 };
  }
  if (viewportHeight <= 0 || rowHeight <= 0) {
    const end = Math.min(count, UNMEASURED_ROWS);
    return { start: 0, end, before: 0, after: rowHeight > 0 ? (count - end) * rowHeight : 0 };
  }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.min(first - overscan, count - 1));
  const end = Math.min(count, first + visible + overscan);
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}

/**
 * Virtual scrolling for a fixed-row-height list (M35.8; the CDK isn't installed). Put it on the scrolling element and
 * render only `window()`'s rows, with spacers of `window().before` / `window().after` px around them:
 *
 * ```html
 * <div class="list" sfVirtualScroll #v="sfVirtualScroll" [sfVirtualCount]="rows().length">
 *   <div [style.height.px]="v.window().before"></div>
 *   @for (row of rows().slice(v.window().start, v.window().end); track row.id) { … }
 *   <div [style.height.px]="v.window().after"></div>
 * </div>
 * ```
 *
 * The row height is `sfVirtualRowHeight` (px) or, by default, the density token `--sf-row-height` read from the element
 * — it follows a density switch. Scrolling and resizing update the window.
 */
@Directive({
  selector: '[sfVirtualScroll]',
  standalone: true,
  exportAs: 'sfVirtualScroll',
  host: { '(scroll)': 'measure()' },
})
export class SfVirtualScrollDirective {
  readonly count = input.required<number, unknown>({ alias: 'sfVirtualCount', transform: numberAttribute });
  /** Fixed row height in px; `null` reads `--sf-row-height` (or `sfVirtualRowToken`) from the element. */
  readonly rowHeightInput = input<number | null>(null, { alias: 'sfVirtualRowHeight' });
  /** The CSS custom property holding the row height when `sfVirtualRowHeight` isn't set. */
  readonly rowToken = input('--sf-row-height', { alias: 'sfVirtualRowToken' });
  readonly overscan = input(8, { alias: 'sfVirtualOverscan', transform: numberAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly scrollTop = signal(0);
  private readonly viewportHeight = signal(0);
  private readonly tokenHeight = signal(0);

  /** The row height in use, px. */
  readonly rowHeight = computed(() => this.rowHeightInput() ?? this.tokenHeight());
  readonly window = computed(() =>
    computeVirtualWindow(this.count(), this.rowHeight(), this.scrollTop(), this.viewportHeight(), this.overscan()),
  );
  /** The full scroll height of all rows (for `aria-rowcount` maths and tests). */
  readonly totalHeight = computed(() => this.count() * this.rowHeight());

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.measure();
      const view = this.document.defaultView;
      if (view && typeof ResizeObserver !== 'undefined') {
        const resize = new ResizeObserver(() => this.measure());
        resize.observe(this.host);
        destroyRef.onDestroy(() => resize.disconnect());
      }
      // The density (and so --sf-row-height) changes with an attribute on <html>.
      if (typeof MutationObserver !== 'undefined') {
        const density = new MutationObserver(() => this.measure());
        density.observe(this.document.documentElement, { attributes: true, attributeFilter: ['data-density'] });
        destroyRef.onDestroy(() => density.disconnect());
      }
    });
  }

  /** Re-reads the scroll position, viewport height and row height. */
  measure(): void {
    this.scrollTop.set(this.host.scrollTop);
    this.viewportHeight.set(this.host.clientHeight);
    const token = this.document.defaultView?.getComputedStyle(this.host).getPropertyValue(this.rowToken()) ?? '';
    const px = parseFloat(token);
    if (Number.isFinite(px) && px > 0) {
      this.tokenHeight.set(px);
    }
  }

  /** Scrolls so that row `index` is visible (`nearest`: only as far as needed). */
  scrollToIndex(index: number, align: 'nearest' | 'start' = 'nearest'): void {
    const rowHeight = this.rowHeight();
    if (rowHeight <= 0) {
      return;
    }
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    const viewTop = this.host.scrollTop;
    const viewBottom = viewTop + this.host.clientHeight;
    if (align === 'start' || top < viewTop) {
      this.host.scrollTop = top;
    } else if (bottom > viewBottom) {
      this.host.scrollTop = bottom - this.host.clientHeight;
    }
    this.measure();
  }
}
