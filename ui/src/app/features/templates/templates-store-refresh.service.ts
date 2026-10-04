import { Injectable, signal } from '@angular/core';

/**
 * A change signal shared by the Templates area and the screens it hosts (M35.21), after `ContentStoreRefresh`. The folder
 * table and the item actions call {@link notify} after a create, move, delete or Undo; the area reads the folder tree and
 * the template list again on {@link tick}. Provided by `TemplatesComponent`.
 */
@Injectable()
export class TemplatesStoreRefresh {
  private readonly counter = signal(0);

  /** Increases after every change reported through {@link notify}. */
  readonly tick = this.counter.asReadonly();

  notify(): void {
    this.counter.update((n) => n + 1);
  }
}
