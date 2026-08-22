import { describe, expect, it } from 'vitest';
import { SfFileSizePipe } from './sf-file-size.pipe';

describe('SfFileSizePipe', () => {
  const pipe = new SfFileSizePipe();

  it('formats bytes', () => {
    expect(pipe.transform(0)).toBe('0 B');
    expect(pipe.transform(500)).toBe('500 B');
    expect(pipe.transform(1024)).toBe('1 KB');
    expect(pipe.transform(1536)).toBe('1.5 KB');
    expect(pipe.transform(1024 * 1024)).toBe('1 MB');
  });

  it('handles edge cases', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
    expect(pipe.transform(-5)).toBe('—');
  });
});
