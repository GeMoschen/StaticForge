import { describe, expect, it } from 'vitest';
import { applyIntersections, currentSection, spyRootMargin } from './scrollspy.util';

const ORDER = ['sg-colors', 'sg-type', 'sg-spacing', 'sg-buttons'];

describe('style guide scroll spy', () => {
  it('marks the first section in the band, in document order', () => {
    expect(currentSection(ORDER, new Set(['sg-spacing', 'sg-type']), null)).toBe('sg-type');
    expect(currentSection(ORDER, new Set(['sg-buttons']), 'sg-colors')).toBe('sg-buttons');
  });

  it('keeps the previous section while none is in the band, and starts with the first', () => {
    expect(currentSection(ORDER, new Set(), 'sg-spacing')).toBe('sg-spacing');
    expect(currentSection(ORDER, new Set(), null)).toBe('sg-colors');
    expect(currentSection([], new Set(), null)).toBeNull();
  });

  it('ignores ids that are not sections', () => {
    expect(currentSection(ORDER, new Set(['elsewhere']), 'sg-type')).toBe('sg-type');
  });

  it('tracks entries entering and leaving the band', () => {
    let visible: Set<string> = new Set();
    visible = applyIntersections(visible, [
      { id: 'sg-colors', isIntersecting: true },
      { id: 'sg-type', isIntersecting: true },
    ]);
    expect([...visible]).toEqual(['sg-colors', 'sg-type']);
    visible = applyIntersections(visible, [{ id: 'sg-colors', isIntersecting: false }]);
    expect(currentSection(ORDER, visible, 'sg-colors')).toBe('sg-type');
  });

  it('starts the band under the sticky header', () => {
    expect(spyRootMargin(88.4)).toBe('-112px 0px -60% 0px');
    expect(spyRootMargin(88, 0)).toBe('-88px 0px -60% 0px');
    expect(spyRootMargin(-50)).toBe('-0px 0px -60% 0px');
  });
});
