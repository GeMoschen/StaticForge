import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AnchorAlign, AnchorSide, anchorPanel } from '../../overlay/anchored-position';
import { OverlayHandle, OverlayStack, tabbables } from '../../overlay/overlay-stack';
import { sfUniqueId } from '../forms/sf-field-context';

/**
 * An anchored, non-modal popup (M35.7) — a share panel, a filter form, a details card. Open it with
 * `[sfPopoverTrigger]` on a button (click), or with `trigger="focus"` on the trigger for content that should appear
 * while the trigger has focus (and the pointer hovers it).
 *
 * - A click-opened popover moves focus to its first control; `Escape` closes it and returns focus to the trigger.
 * - A click outside, or the trigger again, closes it; so does a route change.
 * - It is `role=dialog` (non-modal) named by `label`, and lives in `<body>` while open (`anchorPanel`).
 *
 * ```html
 * <sf-button [sfPopoverTrigger]="share">Share</sf-button>
 * <sf-popover #share label="Share preview"> … </sf-popover>
 * ```
 */
@Component({
  selector: 'sf-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-popover.component.scss',
  template: `
    @if (open()) {
      <div
        #panel
        class="sf-popover"
        role="dialog"
        [id]="panelId"
        [attr.aria-label]="label()"
        (keydown)="onKeydown($event)"
      >
        <ng-content />
      </div>
    }
  `,
})
export class SfPopoverComponent implements OnDestroy {
  /** The popover's accessible name. */
  readonly label = input.required<string>();
  readonly side = input<AnchorSide>('bottom');
  readonly align = input<AnchorAlign>('start');

  readonly panelId = sfUniqueId('sf-popover');
  /** Whether the popover is open (read-only for hosts). */
  readonly open = signal(false);

  private readonly document = inject(DOCUMENT);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly stack = inject(OverlayStack);
  private anchor: HTMLElement | null = null;
  private stopAnchor: (() => void) | null = null;
  /** On the overlay stack while open: its z-index, and a surrounding dialog leaves Tab inside it alone. */
  private overlay: OverlayHandle | null = null;

  private readonly onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    if (target && !this.panel()?.nativeElement.contains(target) && !this.anchor?.contains(target)) {
      this.close(false);
    }
  };

  constructor() {
    const router = inject(Router, { optional: true });
    // Only a change of page closes it: a list that keeps its filters in the query string navigates on every pick.
    const pathOf = (url: string) => url.split(/[?#]/)[0];
    router?.events
      .pipe(
        filter((event): event is NavigationStart => event instanceof NavigationStart),
        filter((event) => pathOf(event.url) !== pathOf(router.url)),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => this.close(false));
  }

  /** Opens next to `anchor`; `moveFocus` puts focus on the first control inside. */
  show(anchor: HTMLElement, moveFocus = true): void {
    if (this.open()) {
      return;
    }
    this.anchor = anchor;
    this.open.set(true);
    this.changeDetector.detectChanges();
    const panel = this.panel()?.nativeElement;
    if (panel) {
      this.stopAnchor = anchorPanel(anchor, panel, { side: this.side(), align: this.align(), offset: 6 });
      this.overlay = this.stack.push(panel, { layer: 'popover', modal: false, restoreFocus: null });
      if (moveFocus) {
        const first = tabbables(panel)[0];
        if (first) {
          first.focus();
        } else {
          panel.setAttribute('tabindex', '-1');
          panel.focus();
        }
      }
    }
    this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  toggle(anchor: HTMLElement): void {
    if (this.open()) {
      this.close(true);
    } else {
      this.show(anchor);
    }
  }

  /** Closes; `restoreFocus` returns focus to the trigger. */
  close(restoreFocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    this.overlay?.remove(false);
    this.overlay = null;
    this.stopAnchor?.();
    this.stopAnchor = null;
    this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    if (restoreFocus) {
      focusTrigger(this.anchor);
    }
  }

  /** Whether `node` is inside the open panel (for the focus trigger). */
  contains(node: Node | null): boolean {
    return !!node && !!this.panel()?.nativeElement.contains(node);
  }

  ngOnDestroy(): void {
    this.close(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // a popover inside a dialog closes alone
      this.close(true);
    }
  }
}

/**
 * Opens an {@link SfPopoverComponent} from its host: `click` toggles it (default), or `trigger="focus"` shows it while
 * the host has focus or the pointer. Sets `aria-haspopup`, `aria-expanded` and `aria-controls` on the focusable
 * element (the inner `<button>` of an `sf-button`).
 */
@Directive({
  selector: '[sfPopoverTrigger]',
  standalone: true,
  host: {
    '(click)': 'onClick()',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut($event)',
    '(mouseenter)': 'onPointer(true)',
    '(mouseleave)': 'onPointer(false)',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class SfPopoverTriggerDirective implements OnInit {
  readonly sfPopoverTrigger = input.required<SfPopoverComponent>();
  readonly trigger = input<'click' | 'focus'>('click', { alias: 'sfPopoverTriggerOn' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private ready = false;

  constructor() {
    // Mirror the popover state onto the focusable element.
    const sync = () => {
      if (!this.ready) {
        return; // afterRender runs app-wide, possibly before this directive's inputs are bound
      }
      const target = focusableOf(this.host);
      const popover = this.sfPopoverTrigger();
      target.setAttribute('aria-haspopup', 'dialog');
      target.setAttribute('aria-expanded', String(popover.open()));
      if (popover.open()) {
        target.setAttribute('aria-controls', popover.panelId);
      } else {
        target.removeAttribute('aria-controls');
      }
    };
    // After every render: the inner <button> of an sf-button host exists only once that host has rendered.
    afterRender({ write: sync });
  }

  ngOnInit(): void {
    this.ready = true;
  }

  protected onClick(): void {
    if (this.trigger() === 'click') {
      this.sfPopoverTrigger().toggle(this.host);
    }
  }

  /** Escape on the trigger closes an open popover (a focus-opened one keeps focus on the trigger). */
  protected onEscape(event: Event): void {
    const popover = this.sfPopoverTrigger();
    if (popover.open()) {
      event.preventDefault();
      event.stopPropagation();
      popover.close(false);
    }
  }

  protected onFocusIn(): void {
    if (this.trigger() === 'focus') {
      this.sfPopoverTrigger().show(this.host, false);
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    if (this.trigger() === 'focus') {
      const next = event.relatedTarget as Node | null;
      if (!this.host.contains(next) && !this.sfPopoverTrigger().contains(next)) {
        this.sfPopoverTrigger().close(false);
      }
    }
  }

  protected onPointer(inside: boolean): void {
    if (this.trigger() !== 'focus') {
      return;
    }
    if (inside) {
      this.sfPopoverTrigger().show(this.host, false);
    } else if (!this.host.contains(this.host.ownerDocument.activeElement)) {
      this.sfPopoverTrigger().close(false);
    }
  }
}

function focusableOf(host: HTMLElement): HTMLElement {
  return host.matches('button, a[href], [tabindex]') ? host : (tabbables(host)[0] ?? host);
}

function focusTrigger(host: HTMLElement | null): void {
  if (host?.isConnected) {
    focusableOf(host).focus();
  }
}
