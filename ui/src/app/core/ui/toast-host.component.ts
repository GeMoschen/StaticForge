import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { ToastKind, ToastService } from './toast.service';

/** How often the countdown of an action toast redraws. */
const TICK_MS = 250;

const KIND_ICONS: Record<ToastKind, string> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
};

/**
 * Renders the visible part of the {@link ToastService} queue in a corner of the app: a polite live region
 * (`role=status`) for news, an assertive one (`role=alert`) for errors. Each toast has an icon per kind (colour is not
 * the only cue), a dismiss button, and, with an action (Undo, Build now), the action button and a countdown.
 *
 * - Hovering a toast or moving focus into it pauses its clock; leaving resumes it with the time that was left.
 * - The countdown (a shrinking bar and the seconds) is `aria-hidden`, so its ticking never reaches the live region.
 *   Screen readers get the static `shared.toast.countdown` text as the action button's description instead: it sits
 *   in a `hidden` element (out of the accessibility tree, so the live region does not announce it) referenced by
 *   `aria-describedby`, and changes only when the clock pauses or resumes — focusing the button pauses it, so what
 *   is read on focus is exact and stays put while the user decides.
 * - `data-sf-no-inert`: the overlay layer leaves the toasts live while a modal makes the rest of the app `inert`, so an
 *   Undo stays reachable.
 */
@Component({
  selector: 'sf-toast-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, TranslocoPipe, SfButtonComponent, SfIconComponent],
  host: { 'data-sf-no-inert': '', '(focusin)': 'onHostFocusIn($event)' },
  template: `
    <div class="toasts" role="status" aria-live="polite">
      @for (toast of polite(); track toast.id) {
        <ng-container *ngTemplateOutlet="item; context: { $implicit: toast }" />
      }
    </div>
    <div class="toasts" role="alert" aria-live="assertive">
      @for (toast of assertive(); track toast.id) {
        <ng-container *ngTemplateOutlet="item; context: { $implicit: toast }" />
      }
    </div>
    <ng-template #item let-toast>
      <div
        [class]="'toast toast--' + toast.kind"
        [attr.data-kind]="toast.kind"
        [attr.data-toast-id]="toast.id"
        (mouseenter)="service.pause(toast.id, 'hover')"
        (mouseleave)="service.resume(toast.id, 'hover')"
        (focusin)="service.pause(toast.id, 'focus')"
        (focusout)="onFocusOut($event, toast.id)"
      >
        <sf-icon class="toast__icon" [name]="icon(toast.kind)" />
        <span class="toast__message">{{ toast.message }}</span>
        @if (toast.action; as action) {
          <span class="toast__countdown" aria-hidden="true">{{ secondsLeft(toast.id) }}</span>
          <span [id]="countdownId(toast.id)" hidden>{{
            'shared.toast.countdown' | transloco: { seconds: describedSeconds(toast.id) }
          }}</span>
          <sf-button
            class="toast__action"
            variant="secondary"
            size="sm"
            [aria-describedby]="countdownId(toast.id)"
            (click)="runAction(toast.id)"
            >{{ action.translate ? (action.label | transloco) : action.label }}</sf-button
          >
        }
        <sf-button
          class="toast__close"
          variant="ghost"
          size="sm"
          icon="close"
          [label]="'shell.toast.dismiss' | transloco"
          (click)="dismiss(toast.id)"
        />
        @if (toast.action) {
          <span class="toast__bar" aria-hidden="true">
            <span class="toast__bar-fill" [style.transform]="'scaleX(' + fractionLeft(toast.id) + ')'"></span>
          </span>
        }
      </div>
    </ng-template>
  `,
  styleUrl: './toast-host.component.scss',
})
export class ToastHostComponent {
  protected readonly service = inject(ToastService);

  protected readonly polite = computed(() => this.service.visible().filter((t) => t.kind !== 'error'));
  protected readonly assertive = computed(() => this.service.visible().filter((t) => t.kind === 'error'));

  /** The clock the countdowns read; ticks only while an action toast's timer runs. */
  private readonly now = signal(Date.now());

  constructor() {
    effect(
      (onCleanup) => {
        const timers = this.service.timers();
        const ticking = this.service.visible().some((t) => t.action && timers.get(t.id)?.runningSince != null);
        if (!ticking) {
          return;
        }
        this.now.set(Date.now());
        const handle = setInterval(() => this.now.set(Date.now()), TICK_MS);
        onCleanup(() => clearInterval(handle));
      },
      { allowSignalWrites: true },
    );
  }

  protected icon(kind: ToastKind): string {
    return KIND_ICONS[kind];
  }

  protected countdownId(id: number): string {
    return `sf-toast-${id}-countdown`;
  }

  /** The visible seconds, ticking. */
  protected secondsLeft(id: number): number {
    return Math.ceil(this.msLeft(id) / 1000);
  }

  /** The seconds for screen readers: the snapshot at the last start or pause, so it never ticks. */
  protected describedSeconds(id: number): number {
    return Math.ceil((this.service.timers().get(id)?.remaining ?? 0) / 1000);
  }

  protected fractionLeft(id: number): number {
    const lifetime = this.service.timers().get(id)?.lifetime ?? 0;
    return lifetime > 0 ? this.msLeft(id) / lifetime : 0;
  }

  /** Where focus was before it entered the toasts; it goes back there when the last focused toast closes. */
  private returnFocus: HTMLElement | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onHostFocusIn(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !this.host.contains(from)) {
      this.returnFocus = from;
    }
  }

  protected runAction(id: number): void {
    this.keepFocus(id);
    this.service.runAction(id);
  }

  protected dismiss(id: number): void {
    this.keepFocus(id);
    this.service.dismiss(id);
  }

  /**
   * A toast about to close holds focus: move it to the next toast's button, else back to where it came from, so a
   * keyboard user doesn't land on <body>.
   */
  private keepFocus(id: number): void {
    const closing = this.host.querySelector<HTMLElement>(`[data-toast-id="${id}"]`);
    if (!closing?.contains(this.host.ownerDocument.activeElement)) {
      return;
    }
    const next = Array.from(this.host.querySelectorAll<HTMLElement>('[data-toast-id]'))
      .filter((toast) => toast !== closing)
      .map((toast) => toast.querySelector<HTMLElement>('button'))
      .find((button) => !!button);
    const target = next ?? (this.returnFocus?.isConnected ? this.returnFocus : null);
    target?.focus();
  }

  protected onFocusOut(event: FocusEvent, id: number): void {
    const toast = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node && toast.contains(event.relatedTarget))) {
      this.service.resume(id, 'focus');
    }
  }

  private msLeft(id: number): number {
    const timer = this.service.timers().get(id);
    if (!timer) {
      return 0;
    }
    if (timer.runningSince === null) {
      return timer.remaining;
    }
    return Math.max(0, timer.remaining - (Math.max(this.now(), timer.runningSince) - timer.runningSince));
  }
}
