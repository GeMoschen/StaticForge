import { CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { cdlCompletion, cdlStringContext, declaredPaths, octlCompletion, whereCompletion } from './completions';

/** Completes at `|` in `source`. */
function complete(
  source: string,
  make: (names: () => readonly string[]) => CompletionSource,
  names: readonly string[] = [],
): string[] | null {
  const pos = source.indexOf('|');
  const doc = source.replace('|', '');
  const state = EditorState.create({ doc });
  const result = make(() => names)(new CompletionContext(state, pos, true)) as CompletionResult | null;
  return result ? result.options.map((option) => option.label) : null;
}

const CDL = 'content { editor text title { } editor list gallery { item { editor text caption { } } } }\n';

describe('CDL completion', () => {
  it('knows the declared editor paths', () => {
    expect(declaredPaths(CDL)).toEqual(['title', 'gallery', 'gallery[]', 'caption']);
  });

  it('offers editor types after `editor`, levels, scopes and modes by position', () => {
    expect(complete('content { editor |', cdlCompletion)).toContain('richtext');
    expect(complete(CDL + 'rules { rule "a" on title { level |', cdlCompletion)).toEqual(['hint', 'info', 'warning', 'error']);
    expect(complete(CDL + 'rules { rule "a" on title { scope [edit, |', cdlCompletion)).toEqual([
      'edit',
      'save',
      'release',
      'generation',
    ]);
    expect(complete(CDL + 'rules { fill title { mode |', cdlCompletion)).toEqual(['empty', 'always']);
    expect(complete(CDL + 'rules { rule "x" on title { onGeneration |', cdlCompletion)).toEqual(['holdBack', 'fail']);
  });

  it('offers editor paths (and inherited names) as targets', () => {
    const targets = complete(CDL + 'rules { rule "a" on |', cdlCompletion, ['inherited']);
    expect(targets).toEqual(expect.arrayContaining(['title', 'gallery[]', 'inherited', 'page']));
    expect(complete(CDL + 'rules { state |', cdlCompletion)).toEqual(expect.arrayContaining(['title', 'caption']));
  });

  it('offers functions, context and editors inside expression strings only', () => {
    const inAssert = complete(CDL + 'rules { rule "a" on title { assert "len|', cdlCompletion);
    expect(inAssert).toEqual(expect.arrayContaining(['length', 'slugify', 'value', 'item', 'title']));
    expect(inAssert).not.toContain('gallery[]');
    expect(complete(CDL + 'content { editor text x { label "Ti|', cdlCompletion)).toBeNull();
    expect(complete('// editor |', cdlCompletion)).toBeNull();
  });

  it('reads the string context of a line', () => {
    expect(cdlStringContext('  assert "length(value) < ')).toEqual({ inString: true, key: 'assert' });
    expect(cdlStringContext('  label "A" ')).toEqual({ inString: false, key: null });
  });
});

describe('OCTL completion', () => {
  it('offers instructions after `$` and the template editors inside an instruction', () => {
    expect(complete('<p>$CMS_V|', octlCompletion)).toEqual(expect.arrayContaining(['CMS_VALUE', 'CMS_IF']));
    expect(complete('<p>$CMS_VALUE(ti|', octlCompletion, ['title'])).toEqual(
      expect.arrayContaining(['title', 'CMS_PAGE', 'page:']),
    );
    expect(complete('<p>$CMS_VALUE(title)$ text |', octlCompletion, ['title'])).toBeNull();
  });

  it('matches a reference with a path (`#global.brand.accent`, `media:logo`, `page:/shop`) as one name', () => {
    const names = ['#global.brand.accent', 'media:logo', 'page:/shop'];
    for (const source of ['color: $CMS_VALUE(#global.br|', 'href: $CMS_REF(page:/sh|', 'src: $CMS_REF(media:lo|']) {
      const pos = source.indexOf('|');
      const state = EditorState.create({ doc: source.replace('|', '') });
      const result = octlCompletion(() => names)(new CompletionContext(state, pos, true)) as CompletionResult;
      // The completion replaces the whole reference typed so far, not only the word after its last dot or slash.
      expect(result.from).toBe(source.indexOf(source.includes('#') ? '#' : source.includes('page') ? 'page:' : 'media:'));
      expect(result.options.map((o) => o.label)).toEqual(expect.arrayContaining(names));
    }
  });

  it('matches a global value written as CMS_GLOBAL.<set>.<path> as one name', () => {
    const source = 'color: $CMS_VALUE(CMS_GLOBAL.brand.ro';
    const state = EditorState.create({ doc: source });
    const result = octlCompletion(() => ['CMS_GLOBAL.brand.roastColor'])(new CompletionContext(state, source.length, true)) as CompletionResult;
    expect(result.from).toBe(source.indexOf('CMS_GLOBAL'));
    expect(result.options.map((o) => o.label)).toContain('CMS_GLOBAL.brand.roastColor');
  });
});

describe('where completion', () => {
  it('offers the dataset fields and the expression words', () => {
    expect(complete('ro|', whereCompletion, ['role', 'joined'])).toEqual(['role', 'joined', 'in', 'contains', 'startsWith', 'true', 'false', 'null']);
  });
});
