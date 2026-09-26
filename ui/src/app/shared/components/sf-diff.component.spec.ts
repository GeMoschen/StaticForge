import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import {
  formatDiffPath,
  SfDiffComponent,
  blockKind,
  formatValue,
} from './sf-diff.component';

describe('SfDiffComponent', () => {
  it('renders an empty message when there are no changes', async () => {
    await render(SfDiffComponent);

    expect(screen.getByText('No changes in this asset.')).toBeTruthy();
  });
});

describe('formatValue', () => {
  it('returns an empty string for nullish values', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
  });

  it('returns strings verbatim', () => {
    expect(formatValue('hello')).toBe('hello');
  });

  it('pretty-prints objects as JSON', () => {
    expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('blockKind', () => {
  it('passes through explicit ADD/REMOVE kinds', () => {
    expect(blockKind({ kind: 'ADD', after: 'x' })).toBe('ADD');
    expect(blockKind({ kind: 'REMOVE', before: 'x' })).toBe('REMOVE');
  });

  it('infers UPDATE when before and after are present', () => {
    expect(blockKind({ before: 'a', after: 'b' })).toBe('UPDATE');
  });

  it('infers ADD/REMOVE from which side is present', () => {
    expect(blockKind({ after: 'b' })).toBe('ADD');
    expect(blockKind({ before: 'a' })).toBe('REMOVE');
  });
});

describe('formatDiffPath', () => {
  it('names the language of a language-dependent value', () => {
    expect(formatDiffPath('content.headline.values.en', { en: 'English' })).toBe('content.headline (English)');
  });

  it('drops the payload prefix of a Changes diff', () => {
    expect(formatDiffPath('payload.content.headline')).toBe('content.headline');
    expect(formatDiffPath('payload.content.title.values.de')).toBe('content.title (de)');
  });
});
