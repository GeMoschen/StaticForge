import { Injectable, signal } from '@angular/core';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * Root-provided floating context-menu state. Tree nodes call `open()` from a
 * `(contextmenu)` handler; the single `sf-context-menu` mounted in
 * `app.component.html` renders whatever is currently open.
 */
@Injectable({ providedIn: 'root' })
export class ContextMenuService {
  readonly state = signal<ContextMenuState | null>(null);

  open(event: MouseEvent, items: ContextMenuItem[]): void {
    event.preventDefault();
    event.stopPropagation();
    this.state.set({ x: event.clientX, y: event.clientY, items });
  }

  close(): void {
    this.state.set(null);
  }
}
