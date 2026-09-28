import { describe, expect, it } from 'vitest';
import { bySeverity, fixHintLabel, issueDestination, issueFocusTarget, locateField } from './page-issues.util';

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

  describe('issueFocusTarget', () => {
    /** A section card as `sf-section-editor` renders it, with one field. */
    const card = (id: string) =>
      `<div class="section-card" data-sf-section="${id}"><header class="section-card__header"></header>` +
      `<div class="section-card__body"><sf-content-form><div class="sf-content-form">` +
      `<div data-sf-editor="image"><input></div></div></sf-content-form></div></div>`;

    function centre(html: string): HTMLElement {
      const root = document.createElement('div');
      root.innerHTML = html;
      return root;
    }

    it('waits for the section scope: the body scope card with the same id is about to be replaced', () => {
      // Right after `?section=sec-1`: the body scope (every card of the body) is still on screen.
      const bodyScope = centre(`<section class="page-editor__body">${card('sec-1')}${card('sec-2')}</section>`);
      expect(issueFocusTarget(bodyScope, 'sec-1', null)).toBeNull();
      expect(issueFocusTarget(bodyScope, 'sec-1', 'image')).toBeNull();

      const sectionScope = centre(`<section class="page-editor__body" data-sf-section-scope="sec-1">${card('sec-1')}</section>`);
      expect(issueFocusTarget(sectionScope, 'sec-1', null)?.getAttribute('data-sf-section')).toBe('sec-1');
      expect(issueFocusTarget(sectionScope, 'sec-1', 'image')?.getAttribute('data-sf-editor')).toBe('image');
      // A field the card doesn't show (collapsed, conditional): the card itself.
      expect(issueFocusTarget(sectionScope, 'sec-1', 'caption')?.getAttribute('data-sf-section')).toBe('sec-1');
    });

    it("finds a field of the page's own form, and nothing while that form isn't shown", () => {
      const pageScope = centre(
        `<sf-content-form data-sf-page-fields><div class="sf-content-form"><div data-sf-editor="teaser"><textarea></textarea></div></div></sf-content-form>`,
      );
      expect(issueFocusTarget(pageScope, null, 'teaser')?.getAttribute('data-sf-editor')).toBe('teaser');
      expect(issueFocusTarget(pageScope, null, 'missing')).toBeNull();
      expect(issueFocusTarget(centre(card('sec-1')), null, 'teaser')).toBeNull();
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
