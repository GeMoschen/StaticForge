import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** The z-index layer of an overlay; each maps to a token of the z-index scale. */
export type OverlayLayer = 'drawer' | 'modal' | 'popover';

export interface OverlayOptions {
  layer: OverlayLayer;
  /** Modal: focus is trapped inside, the rest of the page is `inert`, and the page doesn't scroll. */
  modal: boolean;
  /** Called when the overlay should close (`Escape`). Not called for `remove()`. */
  onEscape?: () => void;
  /**
   * Where focus returns when the overlay goes away; by default the element that had focus when it opened. `null`
   * leaves focus alone.
   */
  restoreFocus?: HTMLElement | null;
}

export interface OverlayHandle {
  /** Takes the overlay off the stack; `restoreFocus` (default true) returns focus to where it was before. */
  remove(restoreFocus?: boolean): void;
}

interface Entry {
  pane: HTMLElement;
  options: OverlayOptions;
  restoreTo: HTMLElement | null;
}

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Each layer's token on the z-index scale (spelled out, so the token checks see them). */
const LAYER_Z_INDEX: Record<OverlayLayer, string> = {
  drawer: 'var(--sf-z-drawer)',
  modal: 'var(--sf-z-modal)',
  popover: 'var(--sf-z-popover)',
};

/** Marks the elements this stack made `inert`, so it never undoes an `inert` someone else set. */
const INERT_MARK = 'data-sf-inerted';

/**
 * The overlay layer (M35.7), in-house (no CDK): every dialog, drawer and popover registers its pane here while it is
 * open.
 *
 * - **Stacking:** each pane gets `z-index: calc(var(--sf-z-<layer>) + n)`, so a later overlay sits above an earlier
 *   one of the same layer, and the layers follow the token scale (drawer < modal < popover < toast < tooltip).
 * - **Escape** closes the topmost overlay that has an `onEscape` (components that use Escape themselves — a menu, a
 *   combobox — stop it first).
 * - **Modal** overlays trap `Tab` inside their pane, make everything outside the topmost modal `inert` (except
 *   elements marked `data-sf-no-inert`, such as the toast host, and panels opened later from inside the dialog), and
 *   lock the page scroll.
 * - **Focus restore:** removing an overlay returns focus to the element that had it on open.
 */
@Injectable({ providedIn: 'root' })
export class OverlayStack {
  private readonly document = inject(DOCUMENT);
  private readonly entries: Entry[] = [];
  private savedOverflow: string | null = null;

  private readonly onKeydown = (event: KeyboardEvent) => {
    const top = this.entries.at(-1);
    if (!top || event.defaultPrevented) {
      return;
    }
    if (event.key === 'Escape') {
      // A non-modal overlay (a drawer beside the page) only takes Escape while focus is inside it.
      const active = this.document.activeElement;
      const target = [...this.entries]
        .reverse()
        .find((entry) => entry.options.onEscape && (entry.options.modal || (!!active && entry.pane.contains(active))));
      if (target) {
        event.preventDefault();
        target.options.onEscape!();
      }
    } else if (event.key === 'Tab') {
      const modal = this.topModal();
      // A popover opened from inside the dialog lives above it in <body>: it handles its own Tab.
      const above = modal ? this.entries.slice(this.entries.indexOf(modal) + 1) : [];
      const target = event.target as Node | null;
      if (modal && !above.some((entry) => target && entry.pane.contains(target))) {
        this.trapTab(event, modal.pane);
      }
    }
  };

  /** How many overlays are open (for hosts and tests). */
  get depth(): number {
    return this.entries.length;
  }

  /** Whether a modal overlay is open — the page behind it takes no keyboard shortcuts. */
  get hasModal(): boolean {
    return !!this.topModal();
  }

  push(pane: HTMLElement, options: OverlayOptions): OverlayHandle {
    const active = this.document.activeElement;
    const entry: Entry = {
      pane,
      options,
      restoreTo: options.restoreFocus !== undefined ? options.restoreFocus : active instanceof HTMLElement ? active : null,
    };
    this.entries.push(entry);
    const level = this.entries.filter((other) => other.options.layer === options.layer).length - 1;
    pane.style.zIndex = `calc(${LAYER_Z_INDEX[options.layer]} + ${level})`;
    if (this.entries.length === 1) {
      this.document.addEventListener('keydown', this.onKeydown);
    }
    this.applyModality();

    let removed = false;
    return {
      remove: (restoreFocus = true) => {
        if (removed) {
          return;
        }
        removed = true;
        const index = this.entries.indexOf(entry);
        if (index >= 0) {
          this.entries.splice(index, 1);
        }
        if (!this.entries.length) {
          this.document.removeEventListener('keydown', this.onKeydown);
        }
        // Only take focus back when it was inside the overlay (or was lost with it): if the user has moved on in the
        // live page — typing beside a non-modal drawer — leave it there.
        const active = this.document.activeElement;
        const focusWasHere = !active || active === this.document.body || entry.pane.contains(active);
        this.applyModality();
        if (restoreFocus && focusWasHere && entry.restoreTo?.isConnected) {
          entry.restoreTo.focus();
        }
      },
    };
  }

  /** Focuses `[autofocus]` / `[sfAutofocus]` in `pane`, else its first tabbable element, else the pane itself. */
  focusInitial(pane: HTMLElement): void {
    // A marked component host (e.g. <sf-button data-sf-autofocus>) isn't focusable itself: take its first tabbable.
    const preferred = pane.querySelector<HTMLElement>('[autofocus], [sfAutofocus], [data-sf-autofocus]');
    const target = (preferred && (preferred.matches(TABBABLE) ? preferred : tabbables(preferred)[0])) ?? tabbables(pane)[0];
    if (target) {
      target.focus();
    } else {
      if (!pane.hasAttribute('tabindex')) {
        pane.setAttribute('tabindex', '-1');
      }
      pane.focus();
    }
  }

  private topModal(): Entry | undefined {
    return [...this.entries].reverse().find((entry) => entry.options.modal);
  }

  private trapTab(event: KeyboardEvent, pane: HTMLElement): void {
    const stops = tabbables(pane);
    if (!stops.length) {
      event.preventDefault();
      return;
    }
    const active = this.document.activeElement as HTMLElement | null;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const inside = !!active && pane.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Re-applies `inert` and the scroll lock for the current topmost modal (or clears them). */
  private applyModality(): void {
    for (const element of Array.from(this.document.querySelectorAll(`[${INERT_MARK}]`))) {
      element.removeAttribute('inert');
      element.removeAttribute(INERT_MARK);
    }
    const modal = this.topModal();
    const root = this.document.documentElement;
    if (!modal) {
      if (this.savedOverflow !== null) {
        root.style.overflow = this.savedOverflow;
        this.savedOverflow = null;
      }
      return;
    }
    if (this.savedOverflow === null) {
      this.savedOverflow = root.style.overflow;
      root.style.overflow = 'hidden';
    }
    // Keep live: the topmost modal, every overlay above it, and anything marked data-sf-no-inert.
    const above = this.entries.slice(this.entries.indexOf(modal)).map((entry) => entry.pane);
    const keep = [...above, ...Array.from(this.document.querySelectorAll<HTMLElement>('[data-sf-no-inert]'))];
    this.inertOutside(this.document.body, keep);
  }

  /** Makes every element under `parent` inert unless it is kept or contains something kept (then recurses). */
  private inertOutside(parent: Element, keep: HTMLElement[]): void {
    for (const child of Array.from(parent.children)) {
      if (keep.includes(child as HTMLElement) || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') {
        continue;
      }
      if (keep.some((element) => child.contains(element))) {
        this.inertOutside(child, keep);
      } else if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        child.setAttribute(INERT_MARK, '');
      }
    }
  }
}

/** The elements of `container` that `Tab` reaches, in DOM order. */
export function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) => !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.tabIndex >= 0,
  );
}
