import { Injectable, signal } from '@angular/core';

/**
 * A change signal for the Navigation area (M35.22), like `ContentStoreRefresh`: the area reads the menu again on
 * {@link tick} after a create, move, reorder, delete, undo or a save in the detail. Provided by `NavigationComponent`.
 */
@Injectable()
export class NavigationStoreRefresh {
  private readonly counter = signal(0);

  /** Increases after every change reported through {@link notify}. */
  readonly tick = this.counter.asReadonly();

  notify(): void {
    this.counter.update((n) => n + 1);
  }
}
