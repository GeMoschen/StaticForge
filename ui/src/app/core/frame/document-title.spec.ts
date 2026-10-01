import { describe, expect, it } from 'vitest';
import { APP_TITLE, composeTitle } from './document-title';

describe('composeTitle', () => {
  it('is "Item · Section · Project — StaticForge"', () => {
    expect(composeTitle({ item: 'Our story', sections: ['Pages'], project: 'Acme' })).toBe(
      'Our story · Pages · Acme — StaticForge',
    );
  });

  it('lists a sub-page before its area', () => {
    expect(composeTitle({ sections: ['Generation', 'Settings'], project: 'Acme' })).toBe(
      'Generation · Settings · Acme — StaticForge',
    );
  });

  it('leaves out what is missing', () => {
    expect(composeTitle({ sections: ['Projects'] })).toBe('Projects — StaticForge');
    expect(composeTitle({ item: '  ', sections: [], project: null })).toBe(APP_TITLE);
    expect(composeTitle({})).toBe(APP_TITLE);
  });
});
