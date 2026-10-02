import { describe, expect, it } from 'vitest';
import { isValidLinkTarget, mergeFindings, moveItem } from './forms-util';

describe('mergeFindings', () => {
  const requiredMessage = 'This field is required.';

  it('adds the required error for an empty required field', () => {
    expect(mergeFindings({ findings: [], required: true, empty: true, requiredMessage })).toEqual([{ level: 'error', message: requiredMessage }]);
  });

  it('shows a required error once: a rule that already reports an error replaces it', () => {
    const server = [{ level: 'error' as const, message: 'A title is required before release.' }];
    const merged = mergeFindings({ findings: server, required: true, empty: true, requiredMessage });
    expect(merged).toEqual(server);
    expect(merged.filter((finding) => finding.level === 'error')).toHaveLength(1);
  });

  it('still adds it next to findings that are not errors', () => {
    const merged = mergeFindings({ findings: [{ level: 'info', message: 'Net price' }], required: true, empty: true, requiredMessage });
    expect(merged.map((finding) => finding.level)).toEqual(['error', 'info']);
  });

  it('says nothing for a filled or optional field', () => {
    expect(mergeFindings({ findings: [], required: true, empty: false, requiredMessage })).toEqual([]);
    expect(mergeFindings({ findings: [], required: false, empty: true, requiredMessage })).toEqual([]);
  });

  it('orders by seriousness: error, warning, info, hint', () => {
    const merged = mergeFindings({
      findings: [
        { level: 'hint', message: 'h' },
        { level: 'warning', message: 'w' },
        { level: 'error', message: 'e' },
        { level: 'info', message: 'i' },
      ],
      required: false,
      empty: false,
      requiredMessage,
    });
    expect(merged.map((finding) => finding.level)).toEqual(['error', 'warning', 'info', 'hint']);
  });
});

describe('isValidLinkTarget', () => {
  it.each(['https://example.com/a?b=1', 'http://localhost:4300', '/news/spring-harvest', '#top', 'mailto:ada@example.com', 'tel:+49 40 123'])(
    'accepts %s',
    (value) => expect(isValidLinkTarget(value)).toBe(true),
  );

  it.each(['', 'example.com', 'javascript:alert(1)', 'https://', 'two words', 'mailto:'])('rejects "%s"', (value) =>
    expect(isValidLinkTarget(value)).toBe(false),
  );
});

describe('moveItem', () => {
  it('moves an item and leaves the original alone', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('returns the same list for a move that goes nowhere', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, 0)).toBe(list);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 2)).toBe(list);
  });
});
