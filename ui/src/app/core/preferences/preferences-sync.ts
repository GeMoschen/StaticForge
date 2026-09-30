import {
  ENVIRONMENT_INITIALIZER,
  EnvironmentProviders,
  effect,
  inject,
  makeEnvironmentProviders,
  untracked,
} from '@angular/core';
import { AuthStore } from '../auth/auth.store';
import { PreferencesService } from './preferences.service';

/**
 * Ties the preferences to the session: whenever the auth store gets a user (login, silent refresh, page reload: all end
 * in `setSession`/`setUser`) the document is loaded, and when the user goes away or changes it is reset.
 */
export function providePreferencesSync(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const auth = inject(AuthStore);
        const preferences = inject(PreferencesService);
        let previous: number | null = null;
        effect(() => {
          const id = auth.userId();
          untracked(() => {
            if (id === null) {
              preferences.reset();
            } else {
              if (previous !== null && previous !== id) {
                preferences.reset();
              }
              preferences.load();
            }
            previous = id;
          });
        });
      },
    },
  ]);
}
