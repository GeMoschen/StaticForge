import { Injectable, computed, inject } from '@angular/core';
import { FrameContextStore } from '../frame/frame-context.store';
import { PreferencesService } from '../preferences/preferences.service';
import type { FavoriteEntry } from '../preferences/preferences.types';
import type { AssetRef } from './asset-ref';

/**
 * The assets a person starred, per project (M35.15), kept in the preferences. A favorite is any asset or folder of any
 * store — it is not tied to the store of the screen it is starred on — so one list serves every tree, the palette and
 * the Favorites views.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly preferences = inject(PreferencesService);
  private readonly frame = inject(FrameContextStore);

  /** The open project's favorites, in the order they were starred. */
  readonly list = computed<readonly FavoriteEntry[]>(() => {
    const key = this.frame.projectKey();
    return key === null ? [] : this.preferences.favorites(key);
  });

  /** Whether the asset is a favorite of the open project (reactive: read it in a `computed` or a template). */
  isFavorite(uuid: string | null | undefined): boolean {
    return uuid != null && this.list().some((entry) => entry.uuid === uuid);
  }

  /** Stars the asset, or takes the star off. Returns whether it is a favorite now. */
  toggle(asset: AssetRef): boolean {
    const key = this.frame.projectKey();
    if (key === null) {
      return false;
    }
    const current = this.preferences.favorites(key);
    if (current.some((entry) => entry.uuid === asset.uuid)) {
      this.preferences.setFavorites(
        key,
        current.filter((entry) => entry.uuid !== asset.uuid),
      );
      return false;
    }
    this.preferences.setFavorites(key, [
      ...current,
      { kind: asset.type, uuid: asset.uuid, title: asset.displayName, folderPath: asset.folderPath },
    ]);
    return true;
  }

  /** Takes a favorite off the list (the Favorites view's star). */
  remove(uuid: string): void {
    const key = this.frame.projectKey();
    if (key !== null) {
      this.preferences.setFavorites(
        key,
        this.preferences.favorites(key).filter((entry) => entry.uuid !== uuid),
      );
    }
  }
}
