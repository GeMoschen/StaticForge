import { describe, expect, it } from 'vitest';
import { LocaleRow, localesChanged, urlsWillChange, validateLocales } from './project-settings-locales.util';

const row = (code: string, fallbacks: string[] = []): LocaleRow => ({ code, label: code, fallbacks });

describe('validateLocales', () => {
  it('accepts a well-formed configuration', () => {
    expect(validateLocales([row('de'), row('de-CH', ['de']), row('en')], 'de')).toEqual([]);
  });

  it('rejects an ill-formed language tag', () => {
    const errors = validateLocales([row('not a tag')], 'not a tag');

    expect(errors).toContainEqual({
      field: 'locales[0].code',
      message: "'not a tag' is not a valid BCP 47 language tag.",
    });
  });

  it('rejects a blank tag', () => {
    expect(validateLocales([row('')], '')).toContainEqual({
      field: 'locales[0].code',
      message: 'A language tag is required.',
    });
  });

  it('rejects a duplicate tag case-insensitively', () => {
    const errors = validateLocales([row('de'), row('DE')], 'de');

    expect(errors).toContainEqual({ field: 'locales[1].code', message: "'DE' is listed more than once." });
  });

  it('requires a default language that is one of the listed ones', () => {
    expect(validateLocales([row('de')], '')).toContainEqual({
      field: 'defaultLocale',
      message: 'Pick the default language.',
    });
    expect(validateLocales([row('de')], 'en')).toContainEqual({
      field: 'defaultLocale',
      message: "'en' is not one of the languages listed above.",
    });
  });

  it('rejects a language that falls back to itself', () => {
    expect(validateLocales([row('de', ['de'])], 'de')).toContainEqual({
      field: 'fallbacks[de]',
      message: "'de' cannot fall back to itself.",
    });
  });

  it('rejects a cyclic fallback chain', () => {
    const errors = validateLocales([row('de', ['en']), row('en', ['de'])], 'de');

    expect(errors.map((e) => e.field)).toContain('fallbacks[de]');
    expect(errors.find((e) => e.field === 'fallbacks[de]')?.message).toContain('cyclic');
  });

  it('accepts a chain that is deep but acyclic', () => {
    expect(validateLocales([row('de-CH', ['de']), row('de', ['en']), row('en')], 'en')).toEqual([]);
  });

  it('has nothing to say about a project with no languages', () => {
    expect(validateLocales([], '')).toEqual([]);
  });
});

describe('urlsWillChange', () => {
  const localized = {
    locales: [{ code: 'de', label: 'Deutsch' }],
    defaultLocale: 'de',
    fallbacks: {},
    defaultWithoutPrefix: false,
    urlsWillChange: false,
    removedLocales: [],
    retainedValueCount: 0,
    confirmationRequired: false,
    discardedLocaleValues: 0,
    affectedAssets: [],
  };

  it('is true when a project gains its first language', () => {
    expect(urlsWillChange(null, [row('de')], false)).toBe(true);
  });

  it('is true when a project gives up its languages', () => {
    expect(urlsWillChange(localized, [], false)).toBe(true);
  });

  it('is true when the default language moves to or from the site root', () => {
    expect(urlsWillChange(localized, [row('de')], true)).toBe(true);
  });

  it('is false for a label-only edit', () => {
    expect(urlsWillChange(localized, [{ code: 'de', label: 'Deutsch (DE)', fallbacks: [] }], false)).toBe(false);
  });

  it('is false when another language is added to an already-localized project', () => {
    expect(urlsWillChange(localized, [row('de'), row('en')], false)).toBe(false);
  });
});

describe('localesChanged', () => {
  const saved = {
    locales: [
      { code: 'de', label: 'Deutsch' },
      { code: 'en', label: 'English' },
    ],
    defaultLocale: 'de',
    fallbacks: { 'de-CH': ['de'] },
    defaultWithoutPrefix: false,
    urlsWillChange: false,
    removedLocales: [],
    retainedValueCount: 0,
    confirmationRequired: false,
    discardedLocaleValues: 0,
    affectedAssets: [],
  };
  const current: LocaleRow[] = [
    { code: 'de', label: 'Deutsch', fallbacks: [] },
    { code: 'en', label: 'English', fallbacks: [] },
  ];

  it('is false while nothing has been edited', () => {
    expect(localesChanged(saved, current, 'de', false)).toBe(false);
  });

  it('is false before the configuration has loaded', () => {
    expect(localesChanged(null, [], '', false)).toBe(false);
  });

  it('notices a new language, a relabel and a reorder', () => {
    expect(localesChanged(saved, [...current, row('fr')], 'de', false)).toBe(true);
    expect(localesChanged(saved, [{ ...current[0], label: 'Deutsch (DE)' }, current[1]], 'de', false)).toBe(true);
    expect(localesChanged(saved, [current[1], current[0]], 'de', false)).toBe(true);
  });

  it('notices a changed fallback chain, default language or prefix setting', () => {
    expect(localesChanged(saved, [{ ...current[0], fallbacks: ['en'] }, current[1]], 'de', false)).toBe(true);
    expect(localesChanged(saved, current, 'en', false)).toBe(true);
    expect(localesChanged(saved, current, 'de', true)).toBe(true);
  });
});
