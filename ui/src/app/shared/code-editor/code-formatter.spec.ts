import { describe, expect, it } from 'vitest';
import { codeFormatterFor, formatBraces, formatJson } from './code-formatter';

describe('code formatters', () => {
  it('exist for CDL and JSON only', () => {
    expect(codeFormatterFor('cdl')).toBe(formatBraces);
    expect(codeFormatterFor('json')).toBe(formatJson);
    expect(codeFormatterFor('octl')).toBeNull();
    expect(codeFormatterFor('where')).toBeNull();
  });

  it('pretty-prints JSON, and gives up on JSON that does not parse', () => {
    expect(formatJson('{"a":1,"b":[true,null]}\n')).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}\n');
    expect(formatJson('{"a":')).toBeNull();
    expect(formatJson('  ')).toBe('  ');
  });

  it('changes only the whitespace outside strings of JSON, keeping the values as written', () => {
    expect(formatJson('{"big":12345678901234567890,"f":1.0,"e":1e3,"z":-0,"a":1,"a":2}')).toBe(
      '{\n  "big": 12345678901234567890,\n  "f": 1.0,\n  "e": 1e3,\n  "z": -0,\n  "a": 1,\n  "a": 2\n}',
    );
    expect(formatJson('[ {} , [ ] , "a \\" , { } :\\u0041" ]')).toBe('[\n  {},\n  [],\n  "a \\" , { } :\\u0041"\n]');
  });

  it('re-indents CDL by its braces, ignoring braces in strings and comments', () => {
    const source = [
      'content {',
      '      editor text title {   ',
      'label "a { b"   // }',
      '}',
      '',
      '',
      '  /* { */ rules {',
      'assert "x > 1" }',
      '}',
    ].join('\n');
    expect(formatBraces(source)).toBe(
      [
        'content {',
        '  editor text title {',
        '    label "a { b"   // }',
        '  }',
        '',
        '  /* { */ rules {',
        '    assert "x > 1" }',
        '}',
      ].join('\n'),
    );
  });

  it('keeps the lines of a comment that spans lines as written', () => {
    expect(formatBraces('a {\n/*\n   keep {\n*/\nb\n}\n')).toBe('a {\n  /*\n   keep {\n*/\n  b\n}\n');
  });

  it('keeps the trailing spaces of a string that spans lines', () => {
    const source = 'a {\nlabel "one  \n  two {  \n\nthree"   \n}\n';
    expect(formatBraces(source)).toBe('a {\n  label "one  \n  two {  \n\nthree"   \n}\n');
  });
});
