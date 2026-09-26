import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** A button on a toast (e.g. "Build now" after a release, M28.3.3); pressing it dismisses the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

/** How long a toast stays, by kind; one with an action stays longer, to be pressed. */
const LIFETIME_MS: Record<ToastKind, number> = { info: 5_000, success: 5_000, warning: 8_000, error: 8_000 };
const ACTION_LIFETIME_MS = 15_000;

/** The app's toasts, rendered by `ToastHostComponent`; each dismisses itself after its lifetime. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private nextId = 1;

  show(message: string, kind: ToastKind = 'info', action?: ToastAction): number {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, action ? { id, message, kind, action } : { id, message, kind }]);
    setTimeout(() => this.dismiss(id), action ? ACTION_LIFETIME_MS : LIFETIME_MS[kind]);
    return id;
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.toasts.set([]);
  }
}
