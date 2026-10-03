import { Injectable, signal } from '@angular/core';

/** The drawer's width, kept while the app is open: the next file, and the next drawer, open as wide as it was left. */
@Injectable({ providedIn: 'root' })
export class MediaDrawerLayout {
  readonly width = signal(typeof innerWidth === 'number' && innerWidth < 1280 ? 420 : 520);
}
