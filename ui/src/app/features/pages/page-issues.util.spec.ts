import { describe, expect, it } from 'vitest';
import { bySeverity, fixHintLabel, issueDestination, locateField } from './page-issues.util';

describe('page issues util', () => {
  it('locates page fields and section fields, list rows and group members at their top-level editor', () => {
    expect(locateField('content.title')).toEqual({ scope: 'page', editor: 'title' });
    expect(locateField('content.links[0].target')).toEqual({ scope: 'page', editor: 'links' });
    expect(locateField('bodies.main[1].content.image')).toEqual({ scope: 'section', body: 'main', index: 1, editor: 'image' });
    expect(locateField('bodies.main[2].content.links[0].target')).toEqual({
      scope: 'section',
      body: 'main',
      index: 2,
      editor: 'links',
    });
    expect(locateField('bodies.main[3].templateRef')).toEqual({ scope: 'section', body: 'main', index: 3, editor: null });
    expect(locateField('bodies.main')).toBeNull();
    expect(locateField(null)).toBeNull();
  });

  describe('issueDestination', () => {
    const sections: Record<string, string[]> = { main: ['sec-1', 'sec-2'] };
    const sectionAt = (body: string, index: number) => sections[body]?.[index] ?? null;

    it('opens the page fields for a page field, and outlines only the element in the preview', () => {
      expect(
        issueDestination({ editorPath: 'content.title', sectionInstanceId: null, selector: 'head > title' }, sectionAt),
      ).toEqual({ form: { scope: 'page', editor: 'title' }, preview: { instanceId: null, selector: 'head > title' } });
    });

    it('opens the section of a section field, found by its place in the page as it is now', () => {
      expect(
        issueDestination(
          { editorPath: 'bodies.main[1].content.image', sectionInstanceId: 'stale', selector: 'body > img' },
          sectionAt,
        ),
      ).toEqual({
        form: { scope: 'section', instanceId: 'sec-2', editor: 'image' },
        preview: { instanceId: 'sec-2', selector: 'body > img' },
      });
    });

    it('opens the section of a finding that only knows its section', () => {
      expect(issueDestination({ editorPath: null, sectionInstanceId: 'sec-1', selector: 'p > a' }, sectionAt)).toEqual({
        form: { scope: 'section', instanceId: 'sec-1', editor: null },
        preview: { instanceId: 'sec-1', selector: 'p > a' },
      });
    });

    it('only outlines the element of a finding outside every section and field', () => {
      expect(issueDestination({ editorPath: null, sectionInstanceId: null, selector: 'body > h2' }, sectionAt)).toEqual({
        form: null,
        preview: { instanceId: null, selector: 'body > h2' },
      });
    });

    it('goes nowhere for a finding about the whole page', () => {
      expect(issueDestination({ editorPath: null, sectionInstanceId: null, selector: null }, sectionAt)).toEqual({
        form: null,
        preview: null,
      });
    });
  });

  it('orders errors first and names the fix hints', () => {
    expect(bySeverity([{ severity: 'WARNING', n: 1 }, { severity: 'ERROR', n: 2 }, { severity: 'WARNING', n: 3 }])).toEqual([
      { severity: 'ERROR', n: 2 },
      { severity: 'WARNING', n: 1 },
      { severity: 'WARNING', n: 3 },
    ]);
    expect(fixHintLabel('CONTENT')).toBe('Fix in content');
    expect(fixHintLabel('TEMPLATE')).toBe('Fix in template');
    expect(fixHintLabel(undefined)).toBeNull();
  });
});
