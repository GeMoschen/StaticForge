import { describe, expect, it } from 'vitest';
import { outputPathLacksLocale, outputPathMessages, outputPathsForSave } from './output-path.util';

describe('outputPathLacksLocale (decision 163)', () => {
  it('warns when a multi-language project has a path without {locale}', () => {
    expect(outputPathLacksLocale('index.html', 2)).toBe(true);
    expect(outputPathLacksLocale('blog/{uid}.html', 3)).toBe(true);
  });

  it('is quiet with {locale}, with one language, with none and for a blank path', () => {
    expect(outputPathLacksLocale('{locale}/index.html', 2)).toBe(false);
    expect(outputPathLacksLocale('index.html', 1)).toBe(false);
    expect(outputPathLacksLocale('index.html', 0)).toBe(false);
    expect(outputPathLacksLocale('  ', 2)).toBe(false);
    expect(outputPathLacksLocale(undefined, 2)).toBe(false);
  });
});

describe('outputPathMessages', () => {
  const server = [{ code: 'SF-GEN-0112', message: 'The server says: no {locale}.' }];
  const base = { savedPath: 'index.html', languageCount: 2, clientMessage: 'Client: add {locale}.' };

  it('shows the client message alone when both say the same', () => {
    expect(outputPathMessages({ ...base, path: 'index.html', server })).toEqual(['Client: add {locale}.']);
  });

  it('shows the server warning when the client does not judge (one language known to the server only)', () => {
    expect(outputPathMessages({ ...base, languageCount: 1, path: 'index.html', server })).toEqual(['The server says: no {locale}.']);
  });

  it('drops the server warning once the path was edited, and shows it once', () => {
    expect(outputPathMessages({ ...base, path: '{locale}/index.html', server })).toEqual([]);
    const twice = [...server, ...server];
    expect(outputPathMessages({ ...base, languageCount: 1, path: 'index.html', server: twice })).toHaveLength(1);
  });

  it('keeps a server warning of another kind next to the client message', () => {
    const other = [{ code: 'SF-GEN-0001', message: 'Other.' }, ...server];
    expect(outputPathMessages({ ...base, path: 'index.html', server: other })).toEqual(['Client: add {locale}.', 'Other.']);
  });
});

describe('outputPathsForSave', () => {
  it('leaves blank paths out and trims', () => {
    expect(outputPathsForSave({ html: ' a/b.html ', rss: '  ' })).toEqual({ html: 'a/b.html' });
  });
});
