import { signal } from '@angular/core';
import { vi } from 'vitest';
import { FavoritesService } from '../favorites.service';

/** A stand-in for specs that render an editor header (with its ☆) but do not care about favorites. */
export function provideFavoritesStub() {
  return {
    provide: FavoritesService,
    useValue: { list: signal([]), isFavorite: () => false, toggle: vi.fn(() => true), remove: vi.fn() },
  };
}
