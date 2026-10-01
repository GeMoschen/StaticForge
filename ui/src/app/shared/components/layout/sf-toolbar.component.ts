import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input } from '@angular/core';

export type SfToolbarOrientation = 'horizontal' | 'vertical';

/** What counts as a toolbar item. `sf-button` renders its `<button>`/`<a>` inside its host: those are the items. */
const ITEM_SELECTOR = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[contenteditable="true"]',
].join(', ');

/** Input types whose arrow keys belong to the caret, not to the toolbar. */
const NON_TEXT_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'color', 'file', 'range']);

/**
 * A toolbar (M35.6): `role=toolbar` with an accessible name (`label`) and a single tab stop (roving tabindex).
 *
 * Keyboard (WAI-ARIA toolbar): `←`/`→` (`↑`/`↓` when `orientation="vertical"`) move between the items, wrapping;
 * `Home`/`End` go to the first/last. Natively disabled items are skipped; `aria-disabled` ones stay reachable (their
 * tooltip can say why). Text inputs, selects, textareas and editable content keep their own arrow keys. Items inside an
 * open menu are not toolbar items. The items are re-scanned whenever the content changes.
 */
@Component({
  selector: 'sf-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styleUrl: './sf-toolbar.component.scss',
  host: {
    class: 'sf-toolbar',
    role: 'toolbar',
    '[attr.aria-label]': 'label()',
    '[attr.aria-orientation]': 'orientation()',
    '[class.sf-toolbar--vertical]': 'orientation() === "vertical"',
    '(keydown)': 'onKeydown($event)',
    '(focusin)': 'onFocusin($event)',
  },
})
export class SfToolbarComponent implements AfterViewInit, OnDestroy {
  /** The toolbar's accessible name. */
  readonly label = input.required<string>();
  readonly orientation = input<SfToolbarOrientation>('horizontal');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The item that holds the tab stop. */
  private active: HTMLElement | null = null;
  private readonly observer =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => this.syncTabStops());

  constructor() {
    this.observer?.observe(this.host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'tabindex', 'href', 'role'],
    });
  }

  ngAfterViewInit(): void {
    this.syncTabStops();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected onFocusin(event: FocusEvent): void {
    const item = this.itemOf(event.target);
    if (item) {
      this.active = item;
      this.syncTabStops();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || ownsArrowKeys(event.target)) {
      return;
    }
    const items = this.items();
    const current = this.itemOf(event.target);
    if (!current || items.length === 0) {
      return;
    }
    const vertical = this.orientation() === 'vertical';
    const index = items.indexOf(current);
    let next: number;
    switch (event.key) {
      case vertical ? 'ArrowDown' : 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case vertical ? 'ArrowUp' : 'ArrowLeft':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.active = items[next];
    this.syncTabStops();
    items[next].focus();
  }

  /** The current items, in document order. */
  private items(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
      (element) => !isNativelyDisabled(element) && !element.closest('[role="menu"], [role="listbox"]'),
    );
  }

  /** The toolbar item an event target belongs to (the target itself or the item containing it). */
  private itemOf(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) {
      return null;
    }
    const items = this.items();
    return items.find((item) => item === target || item.contains(target)) ?? null;
  }

  /** One tab stop: `tabindex=0` on the active item (or the first one), `-1` on the others. Writes only changes. */
  private syncTabStops(): void {
    const items = this.items();
    if (!this.active || !items.includes(this.active)) {
      this.active = items[0] ?? null;
    }
    for (const item of items) {
      const tabindex = item === this.active ? '0' : '-1';
      if (item.getAttribute('tabindex') !== tabindex) {
        item.setAttribute('tabindex', tabindex);
      }
    }
  }
}

function isNativelyDisabled(element: HTMLElement): boolean {
  return 'disabled' in element && (element as HTMLButtonElement).disabled === true;
}

/** Whether the target edits text (or is a select), so the arrow keys move its caret or value. */
function ownsArrowKeys(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(target.type);
  }
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.getAttribute('contenteditable') === 'true' ||
        target.getAttribute('role') === 'combobox'))
  );
}
