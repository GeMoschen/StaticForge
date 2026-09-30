import { isDevMode } from '@angular/core';
import { HashMap, TranslocoConfig, TranslocoMissingHandler } from '@jsverse/transloco';

/**
 * The app's handler for a key that has no translation (M35.4): it logs the key in dev builds and renders the key
 * itself, so a gap is visible on screen but never breaks a page. Production stays silent.
 */
export class WarnMissingKeyHandler implements TranslocoMissingHandler {
  handle(key: string, _config: TranslocoConfig, _params?: HashMap): string {
    if (isDevMode()) {
      console.warn(`[i18n] Missing translation key: ${key}`);
    }
    return key;
  }
}

/** The handler of specs: a missing key fails the test that rendered it, instead of showing the key as text. */
export class ThrowingMissingKeyHandler implements TranslocoMissingHandler {
  handle(key: string, _config: TranslocoConfig, _params?: HashMap): string {
    throw new Error(`[i18n] Missing translation key: ${key}`);
  }
}
