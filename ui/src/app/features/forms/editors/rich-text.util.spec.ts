import { describe, expect, it } from 'vitest';
import { enabledCommands, escapeHtml, isValidLinkTarget, pagePath, textLength } from './rich-text.util';

describe('enabledCommands', () => {
  it('offers all nine commands without a features list', () => {
    expect(enabledCommands(undefined).map((c) => c.id)).toEqual(['bold', 'italic', 'h2', 'h3', 'ul', 'ol', 'quote', 'link', 'clear']);
    expect(enabledCommands([])).toHaveLength(9);
  });

  it('offers exactly the named ones, so an older template keeps its toolbar', () => {
    expect(enabledCommands(['bold', 'list', 'link']).map((c) => c.id)).toEqual(['bold', 'ul', 'link']);
    expect(enabledCommands(['numbered', 'clear']).map((c) => c.id)).toEqual(['ol', 'clear']);
  });
});

describe('isValidLinkTarget', () => {
  it('accepts web, mail and phone links, site paths and anchors', () => {
    for (const ok of ['https://example.com/a?b=1', 'http://x.io', 'mailto:a@b.de', 'tel:+49 30 123', '/news/story', '#top']) {
      expect(isValidLinkTarget(ok), ok).toBe(true);
    }
  });

  it('rejects anything else, including scripts and blanks', () => {
    for (const bad of ['', '  ', 'example.com', 'javascript:alert(1)', 'https://', 'news/story', '/a b']) {
      expect(isValidLinkTarget(bad), bad).toBe(false);
    }
  });
});

describe('helpers', () => {
  it('counts the visible text only', () => {
    expect(textLength('<p>Hello <b>you</b></p>')).toBe(9);
  });

  it('derives a page path from its folder and uid, without the store root', () => {
    expect(pagePath('/pages_root/news/archive/', 'winter_blend')).toBe('/news/archive/winter_blend');
    expect(pagePath('/pages_root/', 'home')).toBe('/home');
  });

  it('escapes HTML', () => {
    expect(escapeHtml('a<b>"&')).toBe('a&lt;b&gt;&quot;&amp;');
  });
});
