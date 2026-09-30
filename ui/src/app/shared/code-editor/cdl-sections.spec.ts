import { describe, expect, it } from 'vitest';
import {
  channelOfField,
  diagnosticsIn,
  firstSectionWithErrors,
  isSaveShortcut,
  sectionsEqual,
  sectionsOf,
  splitDiagnostics,
} from './cdl-sections';

describe('cdl-sections (M34)', () => {
  const error = (field?: string) => ({ severity: 'ERROR' as const, code: 'X', message: 'm', line: 1, column: 1, field });

  it('reads the sections of a detail, empty when missing', () => {
    expect(sectionsOf({ contentCdl: 'a', rulesCdl: 'r' })).toEqual({ content: 'a', bodies: '', rules: 'r' });
    expect(sectionsOf(null)).toEqual({ content: '', bodies: '', rules: '' });
    expect(sectionsEqual(sectionsOf({ contentCdl: 'a' }), { content: 'a', bodies: '', rules: '' })).toBe(true);
  });

  it('puts a CDL diagnostic without a section on Content', () => {
    const all = [error(), error('rules'), error('content')];
    expect(diagnosticsIn(all, 'content')).toHaveLength(2);
    expect(diagnosticsIn(all, 'rules')).toHaveLength(1);
    expect(diagnosticsIn(all, 'bodies')).toHaveLength(0);
  });

  it('splits a save\'s diagnostics into CDL and per-channel ones', () => {
    const { cdl, channels } = splitDiagnostics([error('bodies'), error('channel:html'), error('channel:md'), error()]);
    expect(cdl.map((d) => d.field)).toEqual(['bodies', undefined]);
    expect(Object.keys(channels)).toEqual(['html', 'md']);
    expect(channelOfField('channel:rss')).toBe('rss');
    expect(channelOfField('rules')).toBeNull();
  });

  it('finds the first section with an error, in tab order', () => {
    const warning = { ...error('content'), severity: 'WARNING' as const };
    expect(firstSectionWithErrors([warning, error('rules'), error('bodies')], ['content', 'bodies', 'rules'])).toBe('bodies');
    expect(firstSectionWithErrors([warning], ['content', 'rules'])).toBeNull();
  });

  it('recognizes Ctrl+S and ⌘S only', () => {
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))).toBe(true);
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 'S', metaKey: true }))).toBe(true);
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's' }))).toBe(false);
  });
});
