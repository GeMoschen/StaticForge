import { describe, expect, it } from 'vitest';
import { eventKey, matchesStep, normalizeKeys, parseKeys } from './shortcut-keys.util';

const key = (init: KeyboardEventInit & { key: string }) => new KeyboardEvent('keydown', init);

describe('parseKeys', () => {
  it('reads a chord and a sequence', () => {
    expect(parseKeys('Mod+Shift+K')).toEqual([{ key: 'k', mod: true, alt: false, shift: true }]);
    expect(parseKeys('g p')).toEqual([
      { key: 'g', mod: false, alt: false, shift: false },
      { key: 'p', mod: false, alt: false, shift: false },
    ]);
  });

  it('reads symbols, named keys and the comma chord', () => {
    expect(parseKeys('?')[0].key).toBe('?');
    expect(parseKeys('g ,')[1].key).toBe(',');
    expect(parseKeys('Esc')[0].key).toBe('escape');
    expect(parseKeys('Alt+ArrowUp')[0]).toMatchObject({ key: 'arrowup', alt: true });
  });
});

describe('matchesStep', () => {
  const [save] = parseKeys('Mod+S');

  it('takes Ctrl or Cmd for Mod, and forbids Shift on a letter', () => {
    expect(matchesStep(save, key({ key: 's', ctrlKey: true }))).toBe(true);
    expect(matchesStep(save, key({ key: 's', metaKey: true }))).toBe(true);
    expect(matchesStep(save, key({ key: 'S', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matchesStep(save, key({ key: 's' }))).toBe(false);
  });

  it('ignores Shift for a symbol such as ?', () => {
    const [sheet] = parseKeys('?');
    expect(matchesStep(sheet, key({ key: '?', shiftKey: true }))).toBe(true);
    expect(matchesStep(sheet, key({ key: '?' }))).toBe(true);
    expect(matchesStep(sheet, key({ key: '?', ctrlKey: true }))).toBe(false);
  });

  it('requires Shift when the shortcut has it, and reads the physical key under Alt (Mac)', () => {
    const [release] = parseKeys('Alt+Shift+R');
    expect(matchesStep(release, key({ key: 'Í', code: 'KeyR', altKey: true, shiftKey: true }))).toBe(true);
    expect(matchesStep(release, key({ key: 'r', code: 'KeyR', altKey: true }))).toBe(false);
    expect(eventKey(key({ key: 'ª', code: 'KeyA', altKey: true }))).toBe('a');
  });
});

describe('normalizeKeys', () => {
  it('spells equal shortcuts the same', () => {
    expect(normalizeKeys('Ctrl+s')).toBe(normalizeKeys('Mod+S'));
    expect(normalizeKeys('g p')).toBe('g p');
  });
});
