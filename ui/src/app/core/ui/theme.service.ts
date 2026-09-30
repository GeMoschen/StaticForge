import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { PreferencesService } from '../preferences/preferences.service';
import { ThemePreference } from '../preferences/preferences.types';

/** The theme that is actually shown: what `data-theme` on `<html>` says. */
export type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Light / dark / system (M35.5). The choice lives in the user's preferences ({@link PreferencesService}); this service
 * resolves it (`system` follows `prefers-color-scheme`, live) and writes the result to `data-theme` on `<html>`, which
 * the tokens in `design/_semantic.scss` switch on. Nothing here touches `localStorage`: the legacy `sf-theme` value is
 * moved into the preferences by their one-time migration.
 *
 * It is created at start-up (see `provideAppearance`), so the attribute is set synchronously from the default
 * preference (`system`) before the stored preference has loaded; the tokens also follow the system with no attribute.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly preferences = inject(PreferencesService);
  private readonly systemDark = signal(false);

  /** The stored choice: `system`, `light` or `dark`. */
  readonly preference = this.preferences.theme;
  /** The resolved theme in effect. */
  readonly theme = computed<Theme>(() => {
    const preference = this.preference();
    return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
  });

  constructor() {
    const query = typeof window !== 'undefined' ? window.matchMedia?.(DARK_QUERY) : undefined;
    if (query) {
      this.systemDark.set(query.matches);
      const onChange = (event: MediaQueryListEvent): void => {
        this.systemDark.set(event.matches);
        this.apply();
      };
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
    this.apply();
    // Covers the preference arriving from the server after login.
    effect(() => {
      this.theme();
      this.apply();
    });
  }

  /** Stores the choice and applies it at once. */
  set(value: ThemePreference): void {
    this.preferences.setTheme(value);
    this.apply();
  }

  /** Flips the shown theme to an explicit choice (leaves `system`). */
  toggle(): Theme {
    const next: Theme = this.theme() === 'light' ? 'dark' : 'light';
    this.set(next);
    return next;
  }

  private apply(): void {
    document.documentElement.dataset['theme'] = this.theme();
  }
}
