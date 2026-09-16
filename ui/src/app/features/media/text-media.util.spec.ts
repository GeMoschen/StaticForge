import { describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  diagnosticsOf,
  hasErrors,
  insertTab,
  lineEndingOf,
  offsetForPosition,
  positionLabel,
  withLineEnding,
} from './text-media.util';

type Diagnostic = components['schemas']['Diagnostic'];

describe('offsetForPosition', () => {
  const text = 'a{}\n  $CMS_BODY(x)$\nlast';

  it('maps 1-based line and column to a character offset', () => {
    expect(offsetForPosition(text, 1, 1)).toBe(0);
    expect(offsetForPosition(text, 2, 3)).toBe(6);
    expect(text.slice(6, 15)).toBe('$CMS_BODY');
    expect(offsetForPosition(text, 3, 2)).toBe(text.indexOf('last') + 1);
  });

  it('treats column 0 as the start of the line', () => {
    expect(offsetForPosition(text, 2, 0)).toBe(4);
  });

  it('does not count the carriage return of a CRLF line ending as a column', () => {
    const crlf = 'a\r\nb\r\n$$';
    expect(offsetForPosition(crlf, 3, 1)).toBe(6);
    expect(offsetForPosition('ab\r\ncd', 1, 3)).toBe(2);
  });

  it('clamps positions past the end of a line or of the text', () => {
    expect(offsetForPosition(text, 1, 99)).toBe(3);
    expect(offsetForPosition(text, 9, 1)).toBe(text.length);
  });
});

describe('insertTab', () => {
  it('replaces the selection with a tab and puts the caret after it', () => {
    expect(insertTab('abcd', 1, 3)).toEqual({ value: 'a\td', caret: 2 });
    expect(insertTab('', 0, 0)).toEqual({ value: '\t', caret: 1 });
  });
});

describe('diagnostics', () => {
  const error: Diagnostic = { severity: 'ERROR', code: 'SF-TPL-0121', message: 'x', line: 2, column: 5 };
  const warning: Diagnostic = { severity: 'WARNING', code: 'SF-TPL-0320', message: 'y', line: 0, column: 0 };

  it('detects errors among warnings', () => {
    expect(hasErrors([warning])).toBe(false);
    expect(hasErrors([warning, error])).toBe(true);
    expect(hasErrors(null)).toBe(false);
  });

  it('labels known positions only', () => {
    expect(positionLabel(error)).toBe('2:5');
    expect(positionLabel(warning)).toBe('');
  });

  it('reads the diagnostics of a 422 problem', () => {
    expect(diagnosticsOf({ error: { code: 'SF-API-0422', diagnostics: [error] } })).toEqual([error]);
    expect(diagnosticsOf({ error: { detail: 'nope' } })).toEqual([]);
    expect(diagnosticsOf(null)).toEqual([]);
  });
});

describe('line endings', () => {
  it('detects LF, CRLF and mixed files', () => {
    expect(lineEndingOf('a\nb')).toBe('LF');
    expect(lineEndingOf('no newline')).toBe('LF');
    expect(lineEndingOf('a\r\nb\r\n')).toBe('CRLF');
    expect(lineEndingOf('a\r\nb\n')).toBe('MIXED');
  });

  it('restores CRLF on the LF value a textarea returns and leaves other files alone', () => {
    const original = 'a {\r\n  color: red;\r\n}\r\n';
    const fromTextarea = original.replace(/\r\n/g, '\n');
    expect(withLineEnding(fromTextarea, 'CRLF')).toBe(original);
    expect(withLineEnding('a\nb', 'LF')).toBe('a\nb');
    expect(withLineEnding('a\nb', 'MIXED')).toBe('a\nb');
  });
});
