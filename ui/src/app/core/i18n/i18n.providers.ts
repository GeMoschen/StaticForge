import { APP_INITIALIZER, EnvironmentProviders, Provider, isDevMode, makeEnvironmentProviders } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  TRANSLOCO_MISSING_HANDLER,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_LANG, TRANSLOCO_SETTINGS } from './i18n.config';
import { WarnMissingKeyHandler } from './missing-key.handler';
import { TranslocoHttpLoader } from './transloco-http.loader';

/**
 * Keeps `<html lang>` on the active language and loads the default language before the first render, so `translate()`
 * in TypeScript and the `transloco` pipe have their texts from the first change-detection pass.
 */
export function i18nInitializer(transloco: TranslocoService, document: Document): () => Promise<unknown> {
  return () => {
    transloco.langChanges$.subscribe((lang) => document.documentElement.setAttribute('lang', lang));
    return firstValueFrom(transloco.load(DEFAULT_LANG));
  };
}

/** Transloco for the app (M35.4): runtime JSON loader, messageformat plurals and interpolation, dev-warning handler. */
export function provideI18n(): EnvironmentProviders {
  const initializer: Provider = {
    provide: APP_INITIALIZER,
    multi: true,
    useFactory: i18nInitializer,
    deps: [TranslocoService, DOCUMENT],
  };
  return makeEnvironmentProviders([
    provideTransloco({
      config: { ...TRANSLOCO_SETTINGS, prodMode: !isDevMode() },
      loader: TranslocoHttpLoader,
    }),
    provideTranslocoMessageformat(),
    { provide: TRANSLOCO_MISSING_HANDLER, useClass: WarnMissingKeyHandler },
    initializer,
  ]);
}
