import { CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { HighlightStyle, ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Extension } from '@codemirror/state';
import { highlightTree, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import type { CodeFormat } from './code-format';
import { octlCompletion } from './completions';
import { loadFormat, octlCompletionEverywhere, textRanges } from './formats';

const style = HighlightStyle.define([
  { tag: tags.tagName, class: 'tag' },
  { tag: tags.attributeName, class: 'attr' },
  { tag: tags.propertyName, class: 'prop' },
  { tag: tags.string, class: 'string' },
  { tag: tags.heading, class: 'heading' },
  { tag: tags.keyword, class: 'kw' },
  { tag: tags.meta, class: 'meta' },
  { tag: tags.comment, class: 'comment' },
]);

async function stateFor(format: CodeFormat, doc: string, svg = false, extra: Extension = []): Promise<EditorState> {
  const support = await loadFormat(format, svg);
  const state = EditorState.create({ doc, extensions: [support.extension, extra] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** Collects the style's classes over [from, to) of the document. */
async function highlighted(format: CodeFormat, doc: string): Promise<Map<string, string>> {
  const state = await stateFor(format, doc);
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const out = new Map<string, string>();
  highlightTree(tree, style, (from, to, cls) => {
    const text = doc.slice(from, to);
    out.set(text, [out.get(text), cls].filter(Boolean).join(' '));
  });
  return out;
}

function complete(state: EditorState, pos: number): string[] {
  const sources = state
    .languageDataAt<CompletionSource>('autocomplete', pos)
    .map((source) => source(new CompletionContext(state, pos, true)) as CompletionResult | null);
  return sources.flatMap((result) => (result ? result.options.map((o) => o.label) : []));
}

describe('text between OCTL instructions', () => {
  it('leaves out instructions and comments, keeps literal dollars', () => {
    const text = 'a$CMS_VALUE(x)$b$$c$CMS_COMMENT$ no $CMS_END_COMMENT$d';
    expect(textRanges(text).map((r) => text.slice(r.from, r.to))).toEqual(['a', 'b$$c', 'd']);
  });

  it("ends an instruction at a dollar outside quotes, and an unclosed one at the end", () => {
    const text = '<p>$CMS_IF(x == "$")$y$CMS_END_IF$</p>$CMS_VALUE(open';
    expect(textRanges(text).map((r) => text.slice(r.from, r.to))).toEqual(['<p>', 'y', '</p>']);
  });
});

describe('OCTL over a format', () => {
  it('parses HTML around the instructions, attributes with OCTL values included', async () => {
    const doc = '<a class="nav" href="$CMS_REF(page:home)$">$CMS_VALUE(title)$</a>';
    const classes = await highlighted('HTML', doc);
    expect(classes.get('a')).toContain('tag');
    expect(classes.get('class')).toContain('attr');
    expect(classes.get('"nav"')).toContain('string');
    expect(classes.get('$CMS_REF')).toContain('tag');
    expect(classes.get('$CMS_VALUE')).toContain('tag');
  });

  it('highlights CSS and JavaScript inside HTML', async () => {
    const classes = await highlighted('HTML', '<style>p { color: red }</style><script>const x = 1;</script>');
    expect(classes.get('color')).toContain('prop');
    expect(classes.get('const')).toContain('kw');
  });

  it('highlights Markdown, JSON, YAML, CSS, JavaScript and XML', async () => {
    expect((await highlighted('MARKDOWN', '# $CMS_VALUE(title)$\n\ntext')).get('#')).toBeDefined();
    expect((await highlighted('JSON', '{"title": "$CMS_VALUE(title)$"}')).get('"title"')).toContain('prop');
    expect((await highlighted('YAML', 'title: $CMS_VALUE(title)$\n')).get('title')).toBeDefined();
    expect((await highlighted('CSS', 'body { margin: 0 }')).get('margin')).toContain('prop');
    expect((await highlighted('JAVASCRIPT', 'let a = "$CMS_VALUE(x)$";')).get('let')).toContain('kw');
    expect((await highlighted('XML', '<rss><item>$CMS_VALUE(x)$</item></rss>')).get('item')).toContain('tag');
  });

  it("completes the format's names in text and OCTL inside instructions", async () => {
    const extra = octlCompletionEverywhere(octlCompletion(() => ['title']));
    const state = await stateFor('HTML', '<di $CMS_VALUE(ti)$', false, extra);
    expect(complete(state, 3)).toContain('div');
    const inside = state.doc.toString().indexOf('ti)');
    const labels = complete(state, inside + 2);
    expect(labels).toContain('title');
    expect(labels).not.toContain('div');
  });

  it('completes OCTL instructions after a dollar in text', async () => {
    const extra = octlCompletionEverywhere(octlCompletion(() => []));
    const state = await stateFor('HTML', '<p>$CM</p>', false, extra);
    expect(complete(state, 6)).toContain('CMS_VALUE');
  });

  it('offers closing tags in XML and SVG names for SVG', async () => {
    const xml = await stateFor('XML', '<feed><entry></');
    expect(complete(xml, xml.doc.length)).toContain('entry>');
    const svg = await stateFor('XML', '<svg><', true);
    expect(complete(svg, svg.doc.length)).toEqual(expect.arrayContaining(['circle', 'path', 'rect']));
  });

  it('offers no completion for JSON, Markdown and YAML text', async () => {
    for (const format of ['JSON', 'MARKDOWN', 'YAML'] as const) {
      const state = await stateFor(format, '<di');
      expect(complete(state, 3)).toEqual([]);
    }
  });
});
