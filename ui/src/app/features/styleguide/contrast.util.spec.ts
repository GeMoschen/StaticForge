import { describe, expect, it } from 'vitest';
import {
  TEXT_CONTRAST,
  UI_CONTRAST,
  composite,
  contrastRatio,
  formatRatio,
  meetsContrast,
  parseColor,
  relativeLuminance,
  toHex,
} from './contrast.util';

const color = (value: string) => {
  const parsed = parseColor(value);
  if (!parsed) {
    throw new Error(`not a colour: ${value}`);
  }
  return parsed;
};

describe('contrast util', () => {
  it('parses the colour forms browsers serialise and the tokens use', () => {
    expect(parseColor('#2563eb')).toEqual([37, 99, 235, 1]);
    expect(parseColor('#FFF')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#0f172a80')).toEqual([15, 23, 42, 0.502]);
    expect(parseColor('rgb(15, 23, 42)')).toEqual([15, 23, 42, 1]);
    expect(parseColor('rgba(15, 23, 42, 0.5)')).toEqual([15, 23, 42, 0.5]);
    expect(parseColor('rgb(15 23 42 / 0.5)')).toEqual([15, 23, 42, 0.5]);
    expect(parseColor('rgb(15 23 42 / 50%)')).toEqual([15, 23, 42, 0.5]);
  });

  it('gives null for what is not a colour', () => {
    for (const value of ['', 'transparent', 'var(--sf-text)', '#12', 'rgb(1, 2)', null, undefined]) {
      expect(parseColor(value), String(value)).toBeNull();
    }
  });

  it('computes the WCAG ratio of known pairs', () => {
    expect(contrastRatio(color('#000000'), color('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(color('#ffffff'), color('#ffffff'))).toBeCloseTo(1, 5);
    // The light accent on white, slate-900 on slate-50, and the text-subtle tuning note in _semantic.scss.
    expect(contrastRatio(color('#2563eb'), color('#ffffff'))).toBeCloseTo(5.17, 2);
    expect(contrastRatio(color('#0f172a'), color('#f8fafc'))).toBeCloseTo(17.06, 2);
    expect(contrastRatio(color('#5f6f86'), color('#f1f5f9'))).toBeCloseTo(4.67, 2);
    // Symmetric.
    expect(contrastRatio(color('#ffffff'), color('#2563eb'))).toBeCloseTo(5.17, 2);
    expect(relativeLuminance(color('#ffffff'))).toBeCloseTo(1, 5);
  });

  it('lays a translucent foreground over the background first', () => {
    expect(composite(color('rgb(0 0 0 / 0.5)'), color('#ffffff')).map(Math.round)).toEqual([128, 128, 128, 1]);
    expect(contrastRatio(color('rgb(0 0 0 / 0.5)'), color('#ffffff'))).toBeCloseTo(3.95, 1);
    expect(contrastRatio(color('rgb(0 0 0 / 0)'), color('#ffffff'))).toBeCloseTo(1, 5);
  });

  it('judges and formats ratios without rounding a failing pair up', () => {
    const grey = contrastRatio(color('#777777'), color('#ffffff'));
    expect(formatRatio(grey)).toBe('4.47');
    expect(meetsContrast(grey, TEXT_CONTRAST)).toBe(false);
    expect(meetsContrast(grey, UI_CONTRAST)).toBe(true);
    expect(formatRatio(4.499)).toBe('4.49');
    expect(formatRatio(21)).toBe('21.00');
  });

  it('prints a colour as hex, with alpha only when translucent', () => {
    expect(toHex(color('rgb(37, 99, 235)'))).toBe('#2563eb');
    expect(toHex(color('rgba(15, 23, 42, 0.5)'))).toBe('#0f172a80');
  });
});
