import { Injectable, signal } from '@angular/core';

/** Whether the History drawer is open (M35.12): the top bar's History button toggles it, the drawer closes itself. */
@Injectable({ providedIn: 'root' })
export class HistoryDrawerStore {
  readonly isOpen = signal(false);

  toggle(): void {
    this.isOpen.update((open) => !open);
  }

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
