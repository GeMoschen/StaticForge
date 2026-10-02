import { Injectable, signal } from '@angular/core';

/**
 * Tells the pages tree to re-read itself after something it did not do itself changed the pages: an undo (M35.13)
 * restores a page or folder long after the node that deleted it was removed from the tree.
 */
@Injectable({ providedIn: 'root' })
export class PagesTreeRefresh {
  /** Bumped by every {@link notify}; the pages list reloads when it changes. */
  readonly version = signal(0);

  notify(): void {
    this.version.update((v) => v + 1);
  }
}
