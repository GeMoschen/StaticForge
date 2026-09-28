import { describe, expect, it } from 'vitest';
import { parseDiagnostics, parseHeldBack } from './generation-diagnostics';
import { ALPHA, RUN_WITH_FINDINGS } from './findings/testing/findings.fixtures';

describe('parseDiagnostics', () => {
  it('flattens errors before warnings', () => {
    const groups = parseDiagnostics({
      errors: [{ code: 'SF-TPL-0110', count: 1, messages: ['Unresolvable asset reference: nav:root'] }],
      warnings: [{ code: 'SF-GEN-0210', count: 2, messages: ['a', 'b'] }],
    });

    expect(groups).toEqual([
      { severity: 'error', code: 'SF-TPL-0110', count: 1, messages: ['Unresolvable asset reference: nav:root'] },
      { severity: 'warning', code: 'SF-GEN-0210', count: 2, messages: ['a', 'b'] },
    ]);
  });

  it('returns nothing for null or non-object input', () => {
    expect(parseDiagnostics(null)).toEqual([]);
    expect(parseDiagnostics(undefined)).toEqual([]);
    expect(parseDiagnostics('oops')).toEqual([]);
  });

  it('tolerates malformed entries', () => {
    const groups = parseDiagnostics({
      errors: [null, { code: 5, messages: ['kept', 7] }],
      warnings: 'not-an-array',
    });

    expect(groups).toEqual([{ severity: 'error', code: '', count: 1, messages: ['kept'] }]);
  });
});

describe('parseHeldBack', () => {
  it('reads the held-back pages of a run, in order', () => {
    const pages = parseHeldBack(RUN_WITH_FINDINGS.diagnostics);
    expect(pages).toHaveLength(4);
    expect(pages[2]).toEqual({ asset: ALPHA, uid: 'alpha', channel: 'html', locale: 'en', codes: ['SF-CHK-0301'] });
  });

  it('keeps a null uid and locale, and drops entries without asset or channel', () => {
    expect(
      parseHeldBack({
        errors: [],
        warnings: [],
        heldBack: [
          { asset: ALPHA, uid: null, channel: 'html', locale: null, codes: ['SF-CHK-0201'] },
          { uid: 'x', channel: 'html', codes: [] },
          'oops',
        ],
      }),
    ).toEqual([{ asset: ALPHA, uid: null, channel: 'html', locale: null, codes: ['SF-CHK-0201'] }]);
  });

  it('is empty for runs from before heldBack and for anything else', () => {
    expect(parseHeldBack({ errors: [], warnings: [] })).toEqual([]);
    expect(parseHeldBack(null)).toEqual([]);
    expect(parseHeldBack({ heldBack: 'x' })).toEqual([]);
  });
});
