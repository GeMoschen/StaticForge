import { describe, expect, it } from 'vitest';
import { deriveUid, UID_PATTERN } from './uid.util';

describe('deriveUid', () => {
  it('slugs a display name like the server does', () => {
    expect(deriveUid('Team Leads')).toBe('team_leads');
    expect(deriveUid('  Größe & Maße!  ')).toBe('grosse_masse');
    expect(deriveUid('æsir — øresund')).toBe('aesir_oresund');
  });

  it('is empty for a name without letters or digits (the server then falls back to the type)', () => {
    expect(deriveUid('!!!')).toBe('');
  });

  it('cuts long names at an underscore near 96 characters', () => {
    const uid = deriveUid('word '.repeat(40));

    expect(uid.length).toBeLessThanOrEqual(96);
    expect(uid.endsWith('_')).toBe(false);
    expect(UID_PATTERN.test(uid)).toBe(true);
  });
});
