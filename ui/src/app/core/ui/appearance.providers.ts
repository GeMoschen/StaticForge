import { APP_INITIALIZER, EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { DensityService } from './density.service';
import { ThemeService } from './theme.service';

/** Creates the theme and density services at start-up, so `data-theme` / `data-density` are set before the first render. */
export function provideAppearance(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        inject(ThemeService);
        inject(DensityService);
        return () => undefined;
      },
    },
  ]);
}
