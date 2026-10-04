import { Injectable, effect, inject } from '@angular/core';
import { PreferencesService } from '../preferences/preferences.service';
import { CodePalettePreference } from '../preferences/preferences.types';

/**
 * The code highlighting palette (M35.21, decision 166): reads and writes the user's preference ({@link PreferencesService})
 * and mirrors it to `data-code-palette` on `<html>`, which `design/_semantic.scss` switches the `--sf-code-*` colours on.
 * `current` (the M35.5 palette) is the default and sets no attribute; `refined` sets `data-code-palette="refined"`.
 */
@Injectable({ providedIn: 'root' })
export class CodePaletteService {
  private readonly preferences = inject(PreferencesService);

  readonly palette = this.preferences.codePalette;

  constructor() {
    this.apply();
    effect(() => {
      this.palette();
      this.apply();
    });
  }

  set(value: CodePalettePreference): void {
    this.preferences.setCodePalette(value);
    this.apply();
  }

  private apply(): void {
    const root = document.documentElement;
    if (this.palette() === 'refined') {
      root.dataset['codePalette'] = 'refined';
    } else {
      delete root.dataset['codePalette'];
    }
  }
}
