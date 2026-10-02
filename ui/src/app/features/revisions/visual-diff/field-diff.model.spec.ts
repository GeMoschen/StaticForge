import { describe, expect, it } from 'vitest';
import { humanizeDiffPath, toRenderedChange } from './field-diff.model';

describe('humanizeDiffPath', () => {
  it('reads a stored path as words, without the content prefix', () => {
    expect(humanizeDiffPath('content.hero_headline')).toBe('Hero headline');
    expect(humanizeDiffPath('payload.content.heroHeadline')).toBe('Hero headline');
    expect(humanizeDiffPath('content.team.name')).toBe('Team › Name');
  });

  it('reads an index as a position', () => {
    expect(humanizeDiffPath('content.items[2].title')).toBe('Items 3 › Title');
  });

  it('is empty for no path', () => {
    expect(humanizeDiffPath('')).toBe('');
  });
});

describe('toRenderedChange', () => {
  it('keeps the template’s name for the field, which the read-only editor does not carry', () => {
    const editor = { name: 'title', type: 'text', label: 'Title' } as never;
    const rendered = toRenderedChange({ path: 'content.title', before: 'a' as never, after: 'b' as never }, editor);
    expect(rendered.label).toBe('Title');
    expect(rendered.editor?.label).toBeUndefined();
  });

  it('has no name for a field without an editor', () => {
    expect(toRenderedChange({ path: 'content.x', before: 1 as never, after: 2 as never }, null).label).toBeUndefined();
  });
});
