import { Injectable, signal } from '@angular/core';

/**
 * A change signal shared by the Content store and the screens it hosts in its router outlet
 * (M25.5.1). The set view and the record editor call {@link notify} after a write that the tree or
 * the set list shows (a record added, moved or deleted changes a set's count; a saved query can
 * fix an invalid-query badge), and the store reloads on {@link tick}. Provided by
 * `ContentComponent`, so it is optional for those screens when they're rendered on their own.
 */
@Injectable()
export class ContentStoreRefresh {
  private readonly counter = signal(0);

  /** Increases after every change reported through {@link notify}. */
  readonly tick = this.counter.asReadonly();

  notify(): void {
    this.counter.update((n) => n + 1);
  }
}
