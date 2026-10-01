import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  OnDestroy,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  numberAttribute,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { OverlayHandle, OverlayStack, tabbables } from '../../overlay/overlay-stack';
import { SfButtonComponent } from '../sf-button.component';
import { sfUniqueId } from '../forms/sf-field-context';

/** Marks the drawer's footer content (`<div sfDrawerFooter>…</div>`). */
@Directive({ selector: '[sfDrawerFooter]', standalone: true })
export class SfDrawerFooterDirective {}

/** One keyboard step of the resize handle, in px. */
const RESIZE_STEP = 16;

/**
 * A drawer on the right edge (M35.7), for details and history. Used inline:
 * `@if (selected()) { <sf-drawer title="…" (closed)="selected.set(null)"> … }` — it moves itself into `<body>`.
 *
 * - **Non-modal** (default): the page stays usable beside it; `Escape` closes it while focus is inside.
 * - **Modal** (`modal`): backdrop, focus trap, `inert` page, scroll lock, `Escape` / backdrop close — like `sf-dialog`.
 * - **Resizable**: the left edge is a `role=separator` handle — drag it, or `←`/`→` (wider/narrower), `Home`/`End`
 *   (largest/smallest). `width` is a two-way model, so a host can keep the user's size. (M35.8's splitter will replace
 *   the handle's internals; its API stays.)
 *
 * Focus moves into the drawer on open (`[sfAutofocus]`, else the first control of the body) and returns to the opener
 * on close.
 */
@Component({
  selector: 'sf-drawer',
  standalone: true,
  imports: [SfButtonComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-drawer.component.scss',
  template: `
    @if (modal()) {
      <div class="sf-drawer__backdrop" (click)="requestClose()"></div>
    }
    <section
      #panel
      class="sf-drawer"
      role="dialog"
      [attr.aria-modal]="modal() || null"
      [attr.aria-labelledby]="titleId"
      [style.width.px]="clampedWidth()"
    >
      <div
        class="sf-drawer__handle"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        [attr.aria-label]="'shared.drawer.resize' | transloco"
        [attr.aria-valuenow]="clampedWidth()"
        [attr.aria-valuemin]="minWidth()"
        [attr.aria-valuemax]="maxWidthNow()"
        (keydown)="onHandleKeydown($event)"
        (pointerdown)="onHandlePointerDown($event)"
      ></div>
      <header class="sf-drawer__header">
        <h2 class="sf-drawer__title" [id]="titleId">{{ title() }}</h2>
        <ng-content select="[sfDrawerActions]" />
        <sf-button
          variant="ghost"
          size="sm"
          icon="close"
          [label]="'shared.drawer.close' | transloco"
          (click)="requestClose()"
        />
      </header>
      <div #body class="sf-drawer__body">
        <ng-content />
      </div>
      <footer class="sf-drawer__footer">
        <ng-content select="[sfDrawerFooter]" />
      </footer>
    </section>
  `,
  host: { '[class.sf-drawer-host--modal]': 'modal()' },
})
export class SfDrawerComponent implements AfterViewInit, OnDestroy {
  readonly title = input.required<string>();
  readonly modal = input(false, { transform: booleanAttribute });
  /** The panel width in px; the user can resize it. */
  readonly width = model(480);
  readonly minWidth = input(320, { transform: numberAttribute });
  /** The largest width as a share of the window. */
  readonly maxShare = input(0.9, { transform: numberAttribute });

  /** The drawer wants to close (Escape, ×, backdrop). */
  readonly closed = output<void>();

  protected readonly titleId = sfUniqueId('sf-drawer-title');
  private readonly stack = inject(OverlayStack);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private handle: OverlayHandle | null = null;

  protected readonly maxWidthNow = computed(() => {
    const view = this.host.ownerDocument.defaultView;
    return Math.max(this.minWidth(), Math.round((view?.innerWidth ?? 1280) * this.maxShare()));
  });
  protected readonly clampedWidth = computed(() => clamp(this.width(), this.minWidth(), this.maxWidthNow()));

  ngAfterViewInit(): void {
    if (this.host.parentElement !== this.host.ownerDocument.body) {
      this.host.ownerDocument.body.appendChild(this.host);
    }
    this.handle = this.stack.push(this.host, {
      layer: this.modal() ? 'modal' : 'drawer',
      modal: this.modal(),
      onEscape: () => this.requestClose(),
    });
    const panel = this.panel().nativeElement;
    if (panel.querySelector('[autofocus], [sfAutofocus], [data-sf-autofocus]')) {
      this.stack.focusInitial(panel);
    } else {
      (tabbables(this.body().nativeElement)[0] ?? panel.querySelector<HTMLElement>('.sf-drawer__header sf-button button'))?.focus();
    }
  }

  ngOnDestroy(): void {
    this.handle?.remove();
    this.host.remove();
  }

  requestClose(): void {
    this.closed.emit();
  }

  protected onHandleKeydown(event: KeyboardEvent): void {
    const keys: Record<string, number> = {
      ArrowLeft: this.clampedWidth() + RESIZE_STEP,
      ArrowRight: this.clampedWidth() - RESIZE_STEP,
      Home: this.maxWidthNow(),
      End: this.minWidth(),
    };
    if (event.key in keys) {
      event.preventDefault();
      this.width.set(clamp(keys[event.key], this.minWidth(), this.maxWidthNow()));
    }
  }

  protected onHandlePointerDown(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const view = this.host.ownerDocument.defaultView!;
    const move = (moveEvent: PointerEvent) =>
      this.width.set(clamp(view.innerWidth - moveEvent.clientX, this.minWidth(), this.maxWidthNow()));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
