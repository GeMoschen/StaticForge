/** A fuzzy match: higher `score` is better; `ranges` are the `[start, end)` spans of `text` to highlight. */
export interface FuzzyMatch {
  readonly score: number;
  readonly ranges: readonly (readonly [number, number])[];
}

const SEPARATORS = /[\s\-_/›.,:]/;

/**
 * Matches `query` against `text`, case-insensitively (M35.14, the command palette). A substring wins over a scattered
 * match and an early one over a late one; a scattered match needs every query character in order and prefers word
 * starts and runs. An empty query matches everything with score 0. Returns `null` when it does not match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return { score: 0, ranges: [] };
  }
  const t = text.toLowerCase();

  const at = t.indexOf(q);
  if (at >= 0) {
    const wordStart = at === 0 || SEPARATORS.test(t[at - 1]);
    return { score: 1000 - at + (wordStart ? 100 : 0) - (t.length - q.length), ranges: [[at, at + q.length]] };
  }

  const ranges: [number, number][] = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const index = t.indexOf(char, from);
    if (index < 0) {
      return null;
    }
    const wordStart = index === 0 || SEPARATORS.test(t[index - 1]);
    score += 1 + (index === previous + 1 ? 4 : 0) + (wordStart ? 6 : 0) - Math.min(index - from, 5) * 0.2;
    const last = ranges.at(-1);
    if (last && last[1] === index) {
      last[1] = index + 1;
    } else {
      ranges.push([index, index + 1]);
    }
    previous = index;
    from = index + 1;
  }
  return { score, ranges };
}

/** Splits `text` into alternating plain and highlighted parts along the match's `ranges`. */
export function highlightRanges(text: string, ranges: readonly (readonly [number, number])[]): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), mark: false });
    }
    parts.push({ text: text.slice(start, end), mark: true });
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), mark: false });
  }
  return parts;
}
