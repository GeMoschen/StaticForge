import { describe, expect, it } from 'vitest';
import type { EditorDefinition } from '../forms/form.model';
import {
  firstPositioned,
  readRecordTemplateSources,
  recordTemplateChannels,
  recordTemplateErrorsOf,
  recordTemplateFields,
  recordTemplateMetaHelpers,
  recordTemplatesDiffer,
  recordTemplatesForSave,
} from './record-template.util';

describe('record template helpers', () => {
  it('reads the stored sources and ignores anything without one', () => {
    expect(
      readRecordTemplateSources({ html: { source: '<p>$CMS_VALUE(name)$</p>', compiledHash: 'h' }, md: {}, txt: null }),
    ).toEqual({ html: '<p>$CMS_VALUE(name)$</p>' });
    expect(readRecordTemplateSources(undefined)).toEqual({});
  });

  it('saves every non-blank source and compares blank as absent', () => {
    expect(recordTemplatesForSave({ html: ' <b/> ', md: '  ', txt: '' })).toEqual({ html: ' <b/> ' });
    expect(recordTemplatesDiffer({ html: 'a', md: '' }, { html: 'a' })).toBe(false);
    expect(recordTemplatesDiffer({ html: 'a ' }, { html: 'a' })).toBe(true);
    expect(recordTemplatesDiffer({}, { md: 'x' })).toBe(true);
  });

  it('offers one tab per enabled channel in channel order, plus disabled channels holding a template', () => {
    const tabs = recordTemplateChannels(
      [
        { key: 'md', name: 'Markdown', enabled: true, position: 2 },
        { key: 'html', name: 'HTML', enabled: true, position: 1 },
        { key: 'rss', name: 'RSS', enabled: false, position: 3 },
        { key: 'amp', name: 'AMP', enabled: false, position: 4 },
      ],
      { amp: '<p/>', gone: '<p/>' },
    );
    expect(tabs).toEqual([
      { key: 'html', name: 'HTML', enabled: true },
      { key: 'md', name: 'Markdown', enabled: true },
      { key: 'amp', name: 'AMP', enabled: false },
      { key: 'gone', name: 'gone', enabled: false },
    ]);
  });

  it('lists the record fields of the CDL being edited: top level and group wrappers, not list items', () => {
    const cdl = `content {
  editor text name { label "Name {first}" required }
  group "Contact" {
    editor text email { label 'E-mail' }
  }
  editor list links {
    item {
      editor text label { label "Label" }
    }
  }
  editor number age { }
}`;
    const saved: EditorDefinition[] = [
      { name: 'name', type: 'TEXT', label: 'Full name' },
      { name: 'contact', type: 'GROUP', items: [{ name: 'email', type: 'TEXT', label: 'E-mail' }] } as EditorDefinition,
    ];
    const fields = recordTemplateFields(cdl, saved);
    expect(fields.map((f) => f.name)).toEqual(['name', 'email', 'links', 'age']);
    expect(fields[0]).toEqual({
      name: 'name',
      description: 'Full name (text)',
      snippet: '$CMS_VALUE(name)$',
      caret: '$CMS_VALUE(name)$'.length,
    });
    // `age` is new in the draft: no saved label yet, still offered.
    expect(fields[3].description).toBe('number');
  });

  it('offers the meta names, flags as an $CMS_IF block with the caret inside', () => {
    const helpers = recordTemplateMetaHelpers();
    expect(helpers.map((h) => h.name)).toEqual(['_uid', '_displayName', '_index', '_first', '_last', '_count']);
    const first = helpers.find((h) => h.name === '_first')!;
    expect(first.snippet).toBe('$CMS_IF(_first)$$CMS_END_IF$');
    expect(first.snippet.slice(0, first.caret)).toBe('$CMS_IF(_first)$');
    expect(helpers[0].snippet).toBe('$CMS_VALUE(_uid)$');
  });

  it('reads the record template errors of a rejected save, and nothing else', () => {
    const diag = { severity: 'ERROR' as const, code: 'SF-TPL-0103', message: 'Unknown editor name: nme', line: 2, column: 5 };
    expect(
      recordTemplateErrorsOf({ error: { channel: 'md', diagnostics: [diag], channelDiagnostics: { md: [diag], html: [] } } }),
    ).toEqual({ channel: 'md', byChannel: { md: [diag], html: [] } });
    expect(recordTemplateErrorsOf({ error: { channel: 'md', diagnostics: [diag] } })).toEqual({
      channel: 'md',
      byChannel: { md: [diag] },
    });
    expect(recordTemplateErrorsOf({ error: { diagnostics: [diag] } })).toBeNull();
    expect(recordTemplateErrorsOf(new Error('x'))).toBeNull();
  });

  it('picks the first positioned error to reveal', () => {
    expect(
      firstPositioned([
        { severity: 'WARNING', line: 1, column: 1 },
        { severity: 'ERROR' },
        { severity: 'ERROR', line: 4, column: 2 },
      ]),
    ).toEqual({ severity: 'ERROR', line: 4, column: 2 });
    expect(firstPositioned([])).toBeUndefined();
  });
});
