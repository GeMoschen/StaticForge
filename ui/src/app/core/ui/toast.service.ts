import { Injectable, computed, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/**
 * A button on a toast (e.g. "Build now" after a release, M28.3.3, or "Undo" after a delete, M35.7); pressing it runs
 * `run` and dismisses the toast.
 */
export interface ToastAction {
  /** The button text — or, with `translate`, a Transloco key the host translates. */
  label: string;
  run: () => void;
  /** `label` is a Transloco key (the service has no Transloco, so the host translates it). */
  translate?: boolean;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

/** Why a toast's timer is held: the pointer is over it, or focus is inside it. Both must end before it runs again. */
export type ToastPauseReason = 'hover' | 'focus';

/** The clock of a visible toast. */
export interface ToastTimer {
  /** The toast's full lifetime, ms ({@link toastLifetime}). */
  lifetime: number;
  /** What was left when the timer last started or paused, ms. */
  remaining: number;
  /** `Date.now()` when the timer last (re)started; `null` while paused. */
  runningSince: number | null;
}

/** At most this many toasts are on screen; the rest wait their turn. */
export const MAX_VISIBLE_TOASTS = 3;

const BASE_MS: Record<ToastKind, number> = { info: 4_000, success: 4_000, warning: 6_000, error: 6_000 };
/** ~200 words per minute at ~5 characters a word. */
const READ_MS_PER_CHAR = 60;
const MIN_TEXT_MS = 5_000;
const MAX_TEXT_MS = 12_000;
/** Time to reach and press an action, on top of the reading time. */
const ACTION_MS = 6_000;

/**
 * How long a toast stays once it is on screen:
 *
 * `clamp(base(kind) + 60 ms × message.length, 5 s, 12 s) + (action ? 6 s : 0)`
 *
 * with `base` 4 s for info/success and 6 s for warning/error. So a short "Saved" stays 5 s, a long error up to 12 s,
 * and a toast with an action (Undo) 11–18 s. Hover and focus pause the clock ({@link ToastService.pause}).
 */
export function toastLifetime(message: string, kind: ToastKind, hasAction: boolean): number {
  const text = Math.min(MAX_TEXT_MS, Math.max(MIN_TEXT_MS, BASE_MS[kind] + READ_MS_PER_CHAR * message.length));
  return text + (hasAction ? ACTION_MS : 0);
}

interface Clock extends ToastTimer {
  handle: ReturnType<typeof setTimeout> | null;
  paused: Set<ToastPauseReason>;
}

/**
 * The app's toasts, rendered by `ToastHostComponent`.
 *
 * - `toasts` is the whole queue in display order; the first {@link MAX_VISIBLE_TOASTS} are `visible`, the rest wait.
 *   A waiting toast's clock starts only when it becomes visible (an earlier one leaves).
 * - Errors jump the queue: a new error is placed ahead of every waiting non-error (never ahead of another error, and
 *   never displacing a visible toast), so a failure is not stuck behind a pile of "Saved" notices.
 * - Each visible toast dismisses itself after {@link toastLifetime}; `pause`/`resume` hold the clock while the user
 *   hovers or focuses it, and it then runs on with the time that was left.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  readonly visible = computed(() => this.toasts().slice(0, MAX_VISIBLE_TOASTS));
  /** The clocks of the visible toasts, by id (a new map on every change). */
  readonly timers = signal<ReadonlyMap<number, ToastTimer>>(new Map());

  private nextId = 1;
  private readonly clocks = new Map<number, Clock>();

  show(message: string, kind: ToastKind = 'info', action?: ToastAction): number {
    const id = this.nextId++;
    const toast: Toast = action ? { id, message, kind, action } : { id, message, kind };
    this.toasts.update((list) => {
      if (kind !== 'error') {
        return [...list, toast];
      }
      const firstWaitingNews = list.findIndex((t, i) => i >= MAX_VISIBLE_TOASTS && t.kind !== 'error');
      return firstWaitingNews < 0 ? [...list, toast] : [...list.slice(0, firstWaitingNews), toast, ...list.slice(firstWaitingNews)];
    });
    this.startVisible();
    return id;
  }

  /** A toast with an "Undo" button (`shared.toast.undo`) that calls `run` — for delete, move and rename (M35.7). */
  undo(message: string, run: () => void, kind: ToastKind = 'success'): number {
    return this.show(message, kind, { label: 'shared.toast.undo', translate: true, run });
  }

  dismiss(id: number): void {
    this.stop(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
    this.startVisible();
    this.publish();
  }

  clear(): void {
    for (const id of [...this.clocks.keys()]) {
      this.stop(id);
    }
    this.toasts.set([]);
    this.publish();
  }

  /** Holds a visible toast's clock (pointer over it, or focus inside it). */
  pause(id: number, reason: ToastPauseReason): void {
    const clock = this.clocks.get(id);
    if (!clock || clock.paused.has(reason)) {
      return;
    }
    clock.paused.add(reason);
    if (clock.runningSince !== null) {
      clock.remaining = Math.max(0, clock.remaining - (Date.now() - clock.runningSince));
      clock.runningSince = null;
      clearTimeout(clock.handle ?? undefined);
      clock.handle = null;
      this.publish();
    }
  }

  /** Releases one pause reason; the clock runs on with the remaining time once no reason is left. */
  resume(id: number, reason: ToastPauseReason): void {
    const clock = this.clocks.get(id);
    if (!clock || !clock.paused.delete(reason) || clock.paused.size > 0) {
      return;
    }
    this.run(id, clock);
    this.publish();
  }

  /** Runs a toast's action and dismisses it. */
  runAction(id: number): void {
    const toast = this.toasts().find((t) => t.id === id);
    this.dismiss(id);
    toast?.action?.run();
  }

  /** Starts the clocks of toasts that just became visible. */
  private startVisible(): void {
    let started = false;
    for (const toast of this.visible()) {
      if (!this.clocks.has(toast.id)) {
        const lifetime = toastLifetime(toast.message, toast.kind, !!toast.action);
        const clock: Clock = { lifetime, remaining: lifetime, runningSince: null, handle: null, paused: new Set() };
        this.clocks.set(toast.id, clock);
        this.run(toast.id, clock);
        started = true;
      }
    }
    if (started) {
      this.publish();
    }
  }

  private run(id: number, clock: Clock): void {
    clock.runningSince = Date.now();
    clock.handle = setTimeout(() => this.dismiss(id), clock.remaining);
  }

  private stop(id: number): void {
    const clock = this.clocks.get(id);
    if (clock) {
      clearTimeout(clock.handle ?? undefined);
      this.clocks.delete(id);
    }
  }

  private publish(): void {
    this.timers.set(
      new Map(
        [...this.clocks].map(([id, { lifetime, remaining, runningSince }]) => [id, { lifetime, remaining, runningSince }]),
      ),
    );
  }
}
