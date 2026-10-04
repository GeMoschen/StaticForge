import { APP_INITIALIZER, EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { CodePaletteService } from './code-palette.service';
import { DensityService } from './density.service';
import { ThemeService } from './theme.service';

/** Creates the theme, density and code palette services at start-up, so `data-theme` / `data-density` / `data-code-palette` are set before the first render. */
export function provideAppearance(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        inject(ThemeService);
        inject(DensityService);
        inject(CodePaletteService);
        return () => undefined;
      },
    },
  ]);
}
