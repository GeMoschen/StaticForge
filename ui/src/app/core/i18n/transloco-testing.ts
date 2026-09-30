import { APP_INITIALIZER, EnvironmentProviders, Injectable, Provider } from '@angular/core';
import {
  TRANSLOCO_MISSING_HANDLER,
  Translation,
  TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { Observable, of } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import { DEFAULT_LANG, TRANSLOCO_SETTINGS } from './i18n.config';
import { ThrowingMissingKeyHandler } from './missing-key.handler';

/**
 * Transloco for specs (M35.4): the real `assets/i18n/en.json`, loaded synchronously, the messageformat plugin, and a
 * missing-key handler that THROWS, so a component asking for a key that `en.json` lacks fails its spec.
 *
 * `test-setup.ts` adds these providers to every TestBed, so a spec normally needs nothing. Import this directly for a
 * spec with its own texts (`provideTranslocoTesting({ common: { save: 'Sichern' } })`) or one that builds an injector
 * without the global TestBed set-up.
 *
 * ```ts
 * TestBed.configureTestingModule({ providers: [provideTranslocoTesting()] });
 * ```
 */
export function provideTranslocoTesting(translations: Translation = en): (Provider | EnvironmentProviders)[] {
  @Injectable()
  class StaticLoader implements TranslocoLoader {
    getTranslation(): Observable<Translation> {
      return of(translations);
    }
  }

  return [
    provideTransloco({ config: { ...TRANSLOCO_SETTINGS, prodMode: true }, loader: StaticLoader }),
    provideTranslocoMessageformat(),
    { provide: TRANSLOCO_MISSING_HANDLER, useClass: ThrowingMissingKeyHandler },
    {
      // Loads the default language while the TestBed module is created (the loader above is synchronous).
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: (transloco: TranslocoService) => () => {
        transloco.load(DEFAULT_LANG).subscribe();
      },
      deps: [TranslocoService],
    },
  ];
}
