import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private nextId = 1;

  show(message: string, kind: ToastKind = 'info'): number {
    const id = this.nextId++;
    this.toasts.update((list) => [...list, { id, message, kind }]);
    return id;
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.toasts.set([]);
  }
}
