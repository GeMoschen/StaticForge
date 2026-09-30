import { TranslocoConfig } from '@jsverse/transloco';

/** The languages the UI ships. Adding one means adding `assets/i18n/<lang>.json` and listing it here. */
export const AVAILABLE_LANGS = ['en'] as const;
export const DEFAULT_LANG = 'en';

/** Transloco settings shared by the app and the specs (the missing handler and the loader differ). */
export const TRANSLOCO_SETTINGS: Partial<TranslocoConfig> = {
  availableLangs: [...AVAILABLE_LANGS],
  defaultLang: DEFAULT_LANG,
  fallbackLang: DEFAULT_LANG,
  reRenderOnLangChange: true,
  // Our own TRANSLOCO_MISSING_HANDLER reports a missing key (warns in dev, throws in specs), so the default logger is off.
  missingHandler: { logMissingKey: false, useFallbackTranslation: true, allowEmpty: false },
};
