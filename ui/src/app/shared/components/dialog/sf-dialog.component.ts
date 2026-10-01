import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  OnDestroy,
  booleanAttribute,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { OverlayHandle, OverlayStack, tabbables } from '../../overlay/overlay-stack';
import { SfButtonComponent } from '../sf-button.component';
import { sfUniqueId } from '../forms/sf-field-context';
import { SfDialogRef } from './dialog-ref';

export type SfDialogSize = 'sm' | 'md' | 'lg' | 'full';

/** Marks the dialog's footer content (`<div sfDialogFooter>…</div>`): actions, primary on the right. */
@Directive({ selector: '[sfDialogFooter]', standalone: true })
export class SfDialogFooterDirective {}

/**
 * A modal dialog (M35.7): backdrop, panel in `sm | md | lg | full` size, header with the title as `h2`
 * (`aria-labelledby`) and an optional × button, a scrolling body, and a footer for `[sfDialogFooter]` actions.
 *
 * Two ways to use it, same behaviour:
 * - as the root of a component opened with `DialogService.open()` — closing resolves its `SfDialogRef`;
 * - inline in a template, `@if (open()) { <sf-dialog title="…" (closed)="open.set(false)"> … }` — it moves itself
 *   into `<body>` and emits `closed`.
 *
 * While shown it is on the {@link OverlayStack}: focus moves in (`[sfAutofocus]`/`[data-sf-autofocus]`, else the
 * body's first control, else the footer's) and is trapped there, the page behind is `inert` and doesn't scroll, `Escape` or a backdrop click
 * close it when `dismissible`, and focus returns to the opener afterwards. Stacked dialogs work.
 */
@Component({
  selector: 'sf-dialog',
  standalone: true,
  imports: [SfButtonComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-dialog.component.scss',
  template: `
    <div class="sf-dialog__backdrop" (click)="onBackdropClick()"></div>
    <section
      #panel
      class="sf-dialog sf-dialog--{{ size() }}"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="describedBy()"
    >
      <header class="sf-dialog__header">
        <h2 class="sf-dialog__title" [id]="titleId">{{ title() }}</h2>
        @if (dismissible()) {
          <sf-button
            class="sf-dialog__close"
            variant="ghost"
            size="sm"
            icon="close"
            [label]="'shared.dialog.close' | transloco"
            (click)="requestClose()"
          />
        }
      </header>
      <div class="sf-dialog__body">
        <ng-content />
      </div>
      <footer class="sf-dialog__footer">
        <ng-content select="[sfDialogFooter]" />
      </footer>
    </section>
  `,
  host: { class: 'sf-dialog-host' },
})
export class SfDialogComponent implements AfterViewInit, OnDestroy {
  readonly title = input.required<string>();
  readonly size = input<SfDialogSize>('md');
  /** Escape, the backdrop and the × button close it. Turn off while it must not be left (a running save). */
  readonly dismissible = input(true, { transform: booleanAttribute });
  /** Ids describing the dialog (its main message), for `aria-describedby`. */
  readonly describedBy = input<string | null>(null);

  /** Inline use: the dialog wants to close (Escape, backdrop, ×). */
  readonly closed = output<void>();

  protected readonly titleId = sfUniqueId('sf-dialog-title');

  private readonly ref = inject(SfDialogRef, { optional: true });
  private readonly stack = inject(OverlayStack);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private handle: OverlayHandle | null = null;

  ngAfterViewInit(): void {
    // Inline use: leave the page's stacking contexts (a transformed or clipping ancestor) behind.
    if (this.host.parentElement !== this.host.ownerDocument.body) {
      this.host.ownerDocument.body.appendChild(this.host);
    }
    this.handle = this.stack.push(this.host, {
      layer: 'modal',
      modal: true,
      onEscape: () => this.dismissible() && this.requestClose(),
    });
    this.focusInitial();
  }

  ngOnDestroy(): void {
    this.handle?.remove();
    this.host.remove(); // Angular removes only a destroyed view's top nodes; this one may live in <body>
  }

  /** Closes the dialog as dismissed. */
  requestClose(): void {
    if (this.ref) {
      this.ref.close();
    } else {
      this.closed.emit();
    }
  }

  /** Focus starts on the content, not the × button: a marked element, else the body's first control, else the footer's. */
  private focusInitial(): void {
    const panel = this.panel().nativeElement;
    if (panel.querySelector('[autofocus], [sfAutofocus], [data-sf-autofocus]')) {
      this.stack.focusInitial(panel);
      return;
    }
    const first = [panel.querySelector<HTMLElement>('.sf-dialog__body'), panel.querySelector<HTMLElement>('.sf-dialog__footer')]
      .map((part) => (part ? tabbables(part)[0] : undefined))
      .find((element) => !!element);
    if (first) {
      first.focus();
    } else {
      this.stack.focusInitial(panel);
    }
  }

  protected onBackdropClick(): void {
    if (this.dismissible()) {
      this.requestClose();
    }
  }
}
