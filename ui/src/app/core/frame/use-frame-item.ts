import { DestroyRef, effect, inject } from '@angular/core';
import type { FrameItem } from './breadcrumb.util';
import { FrameContextStore } from './frame-context.store';

/**
 * A screen reports the item it has open (its name and folder path) to the frame: the breadcrumb ends with it and the
 * document title starts with it. Call it in an injection context; `source` is read reactively, `null` means "none
 * open". The item is withdrawn when the screen is destroyed.
 */
export function useFrameItem(source: () => FrameItem | null): void {
  const frame = inject(FrameContextStore);
  effect(() => frame.setItem(source()), { allowSignalWrites: true });
  inject(DestroyRef).onDestroy(() => frame.setItem(null));
}
