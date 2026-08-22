import { Injectable, signal } from '@angular/core';

export interface DialogConfig {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: 'danger' | 'info';
}

export interface DialogState extends DialogConfig {
  open: boolean;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly state = signal<DialogState | null>(null);

  open(config: DialogConfig): void {
    this.state.set({ ...config, open: true });
  }

  close(): void {
    this.state.set(null);
  }
}
