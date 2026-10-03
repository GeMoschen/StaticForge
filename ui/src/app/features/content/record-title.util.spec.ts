import { describe, expect, it } from 'vitest';
import { recordTitle } from './record-title.util';

describe('recordTitle', () => {
  it('is the display name', () => {
    expect(recordTitle({ displayName: ' Jane Doe ' }, 'Untitled')).toBe('Jane Doe');
  });

  it('never shows a uuid, which is how a dataset without a title field names its records', () => {
    expect(recordTitle({ displayName: '3f2b8c1e-5a47-4d0e-9b21-0c6a1f7e8d92' }, 'Untitled Staff record')).toBe(
      'Untitled Staff record',
    );
  });

  it('falls back for a blank or missing name and a missing record', () => {
    expect(recordTitle({ displayName: '  ' }, 'Untitled')).toBe('Untitled');
    expect(recordTitle({}, 'Untitled')).toBe('Untitled');
    expect(recordTitle(null, 'Untitled')).toBe('Untitled');
  });
});
