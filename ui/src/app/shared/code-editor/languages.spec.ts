import { StringStream } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { cdlParser, octlParser, whereParser } from './languages';

type Parser<S> = { startState: () => S; token: (stream: StringStream, state: S) => string | null };

/** `[text, token]` pairs of a source, empty tokens dropped. */
function tokens<S>(parser: Parser<S>, source: string): [string, string][] {
  const state = parser.startState();
  const out: [string, string][] = [];
  for (const line of source.split('\n')) {
    const stream = new StringStream(line, 2, 2);
    while (!stream.eol()) {
      const token = parser.token(stream, state);
      const text = line.slice(stream.start, stream.pos);
      if (stream.pos === stream.start) {
        throw new Error(`no progress at ${stream.pos} in "${line}"`);
      }
      if (token && text.trim()) {
        out.push([text.trim(), token]);
      }
      stream.start = stream.pos;
    }
  }
  return out;
}

const of = (pairs: [string, string][], token: string) => pairs.filter(([, t]) => t === token).map(([text]) => text);

describe('CDL highlighting', () => {
  const source = [
    'content {',
    '  editor text title { label "Title" required level warning scope [release] }',
    '  editor select category { options [ { value "news" label "News" } ] }',
    '  // a comment',
    '}',
    'rules {',
    '  rule "short" on title { level warning scope [edit] assert "length(value) <= 70 && category == \'news\'" message { en "Short" } }',
    '  fill slug { value "slugify(title)" mode empty on [save] }',
    '  /* block',
    '     comment */ state teaser { requiredWhen "global:site.flag" }',
    '}',
  ].join('\n');
  const pairs = tokens(cdlParser as unknown as Parser<unknown>, source);

  it('colors structure, types, attributes and values', () => {
    expect(of(pairs, 'keyword')).toEqual(expect.arrayContaining(['content', 'editor', 'rules', 'rule', 'fill', 'state']));
    expect(of(pairs, 'typeName')).toEqual(['text', 'select']);
    expect(of(pairs, 'propertyName')).toEqual(expect.arrayContaining(['label', 'required', 'level', 'scope', 'assert', 'mode']));
    expect(of(pairs, 'atom')).toEqual(expect.arrayContaining(['warning', 'release', 'edit', 'empty', 'save']));
    expect(of(pairs, 'comment')).toEqual(['// a comment', '/*', 'block', 'comment */']);
  });

  it('highlights expressions inside expression strings only', () => {
    expect(of(pairs, 'fn')).toEqual(['length', 'slugify']);
    expect(of(pairs, 'ctx')).toEqual(['value']);
    expect(of(pairs, 'ns')).toEqual(['global:']);
    expect(of(pairs, 'operator')).toEqual(expect.arrayContaining(['<=', '&&', '==']));
    // A select option's `value "news"` is a plain string, a label too.
    expect(of(pairs, 'string')).toEqual(expect.arrayContaining(['"Title"', '"news"', '"News"', "'news'"]));
  });
});

describe('OCTL highlighting', () => {
  it('colors instructions, their arguments and comments, leaves the text alone', () => {
    const pairs = tokens(
      octlParser as unknown as Parser<unknown>,
      '<h1>$CMS_VALUE(title)$</h1>$CMS_IF(count > 1 && CMS_PAGE.x == "a$b")$ many $CMS_END_IF$\n$CMS_COMMENT$ note $CMS_END_COMMENT$ $CMS_REF(page:home, locale="en")$',
    );
    expect(of(pairs, 'tag')).toEqual(['$CMS_VALUE', '$CMS_IF', '$CMS_END_IF', '$CMS_REF']);
    expect(of(pairs, 'variable')).toEqual(expect.arrayContaining(['title', 'count']));
    expect(of(pairs, 'ctx')).toEqual(['CMS_PAGE']);
    expect(of(pairs, 'string')).toEqual(['"a$b"', '"en"']);
    expect(of(pairs, 'ns')).toEqual(['page:']);
    expect(of(pairs, 'comment')).toEqual(['note']);
    expect(pairs.map(([text]) => text)).not.toContain('<h1>');
  });
});

describe('where highlighting', () => {
  it('colors fields, operators and literals', () => {
    const pairs = tokens(whereParser as unknown as Parser<unknown>, "role == 'lead' && joined > '2022-01-01' && tags contains 'x'");
    expect(of(pairs, 'variable')).toEqual(['role', 'joined', 'tags']);
    expect(of(pairs, 'operatorKeyword')).toEqual(['contains']);
    expect(of(pairs, 'string')).toHaveLength(3);
  });
});
