import { describe, expect, it } from 'vitest';
import { LARGE_DELETE_THRESHOLD, LARGE_DELETE_WORD, typeToConfirmFor } from './delete-confirm';

describe('typeToConfirmFor', () => {
  it('asks for the word "delete" from 25 items on, and for nothing below', () => {
    expect(LARGE_DELETE_THRESHOLD).toBe(25);
    expect(typeToConfirmFor(1)).toBeUndefined();
    expect(typeToConfirmFor(24)).toBeUndefined();
    expect(typeToConfirmFor(25)).toBe(LARGE_DELETE_WORD);
    expect(typeToConfirmFor(400)).toBe('delete');
  });
});
