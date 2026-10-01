import { describe, expect, it } from 'vitest';
import { computeVirtualWindow } from './virtual-window';

describe('computeVirtualWindow', () => {
  it('renders the visible rows plus overscan, with spacers for the rest', () => {
    // 5,000 rows of 28px, scrolled to row 1,000, 280px viewport (10 rows), overscan 8.
    const window = computeVirtualWindow(5000, 28, 28_000, 280, 8);

    expect(window).toEqual({ start: 992, end: 1018, before: 992 * 28, after: (5000 - 1018) * 28 });
  });

  it('starts at the top and clamps at the bottom', () => {
    expect(computeVirtualWindow(100, 28, 0, 280, 8)).toMatchObject({ start: 0, end: 18, before: 0 });
    expect(computeVirtualWindow(100, 28, 100 * 28, 280, 8)).toMatchObject({ end: 100, after: 0 });
  });

  it('renders a first chunk without layout (keeping the full scroll height), and nothing for no rows', () => {
    expect(computeVirtualWindow(50, 28, 0, 0)).toEqual({ start: 0, end: 50, before: 0, after: 0 });
    expect(computeVirtualWindow(10_000, 28, 0, 0)).toEqual({ start: 0, end: 100, before: 0, after: 9_900 * 28 });
    expect(computeVirtualWindow(0, 28, 0, 280)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});
