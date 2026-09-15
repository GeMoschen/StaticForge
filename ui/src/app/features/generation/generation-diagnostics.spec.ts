import { describe, expect, it } from 'vitest';
import { parseDiagnostics } from './generation-diagnostics';

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
