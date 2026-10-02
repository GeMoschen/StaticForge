import { describe, expect, it } from 'vitest';
import { fuzzyMatch, highlightRanges } from './fuzzy-match.util';

describe('fuzzyMatch', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyMatch('  ', 'Pages')).toEqual({ score: 0, ranges: [] });
  });

  it('finds a substring case-insensitively and reports its range', () => {
    expect(fuzzyMatch('AGE', 'Pages')?.ranges).toEqual([[1, 4]]);
  });

  it('matches characters in order and merges adjacent ones into one range', () => {
    expect(fuzzyMatch('pgs', 'Pages')?.ranges).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(fuzzyMatch('tmp', 'Templates')?.ranges).toEqual([[0, 1], [2, 4]]);
  });

  it('rejects a query whose characters are not all present in order', () => {
    expect(fuzzyMatch('zq', 'Pages')).toBeNull();
    expect(fuzzyMatch('sgp', 'Pages')).toBeNull();
  });

  it('ranks a substring above a scattered match, and an earlier or word-start one higher', () => {
    const substring = fuzzyMatch('pub', 'Publishing')!;
    const scattered = fuzzyMatch('pub', 'Pie crust tub')!;
    expect(substring.score).toBeGreaterThan(scattered.score);
    expect(fuzzyMatch('set', 'Settings')!.score).toBeGreaterThan(fuzzyMatch('set', 'Site settings')!.score);
  });
});

describe('highlightRanges', () => {
  it('splits the text along the ranges', () => {
    expect(highlightRanges('Settings', [[0, 3]])).toEqual([
      { text: 'Set', mark: true },
      { text: 'tings', mark: false },
    ]);
  });

  it('returns the whole text unmarked without ranges', () => {
    expect(highlightRanges('Pages', [])).toEqual([{ text: 'Pages', mark: false }]);
  });
});
