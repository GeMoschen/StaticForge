import { Injectable, effect, inject } from '@angular/core';
import { PreferencesService } from '../preferences/preferences.service';
import { DensityPreference } from '../preferences/preferences.types';

/**
 * Compact / comfortable (M35.5): reads and writes the user's preference ({@link PreferencesService}) and mirrors it to
 * `data-density` on `<html>`, which the density tokens in `design/_scales.scss` switch on. Compact is the default; with
 * no attribute the tokens are compact as well, so there is nothing to flash.
 */
@Injectable({ providedIn: 'root' })
export class DensityService {
  private readonly preferences = inject(PreferencesService);

  readonly density = this.preferences.density;

  constructor() {
    this.apply();
    effect(() => {
      this.density();
      this.apply();
    });
  }

  set(value: DensityPreference): void {
    this.preferences.setDensity(value);
    this.apply();
  }

  toggle(): DensityPreference {
    const next: DensityPreference = this.density() === 'compact' ? 'comfortable' : 'compact';
    this.set(next);
    return next;
  }

  private apply(): void {
    document.documentElement.dataset['density'] = this.density();
  }
}
