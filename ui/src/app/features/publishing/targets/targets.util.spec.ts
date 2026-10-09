import { describe, expect, it } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { type TargetDraft, draftOf, kindOf, newDraft, requestOf } from './targets.util';

type JsonNode = components['schemas']['JsonNode'];

describe('targets.util', () => {
  it('maps the server types to the form kinds', () => {
    expect(kindOf('FILESYSTEM')).toBe('folder');
    expect(kindOf('ZIP')).toBe('zip');
    expect(kindOf('S3')).toBe('s3');
    expect(kindOf(undefined)).toBe('folder');
  });

  it('starts a new target as the default only when it is the first', () => {
    expect(newDraft(true).isDefault).toBe(true);
    expect(newDraft(false).isDefault).toBe(false);
    expect(newDraft(false).redirects).toEqual({ html: true, htaccess: false, json: false });
  });

  it('reads a target into the form, with the base URL from the view and "no redirect output" as all off', () => {
    const draft = draftOf({
      id: 5,
      name: 'Cdn',
      type: 'S3',
      config: { path: 'cdn' } as unknown as JsonNode,
      isDefault: false,
      baseUrl: 'https://cdn.example.com',
      redirectFormats: [],
    });

    expect(draft).toEqual({
      id: 5,
      name: 'Cdn',
      kind: 's3',
      path: 'cdn',
      baseUrl: 'https://cdn.example.com',
      isDefault: false,
      redirects: { html: false, htaccess: false, json: false },
    });
  });

  it('builds the request: trimmed values, explicit redirect formats, the original config carried through', () => {
    const draft: TargetDraft = {
      id: 5,
      name: ' Cdn ',
      kind: 'zip',
      path: ' ',
      baseUrl: ' https://cdn.example.com ',
      isDefault: true,
      redirects: { html: false, htaccess: true, json: true },
    };
    const original = { id: 5, config: { path: 'old', bucket: 'b' } as unknown as JsonNode };

    expect(requestOf(draft, original)).toEqual({
      name: 'Cdn',
      type: 'ZIP',
      config: { bucket: 'b', redirectFormats: ['HTACCESS', 'JSON'] },
      isDefault: true,
      baseUrl: 'https://cdn.example.com',
    });
  });

  it('sends an empty redirect list for "no redirect output"', () => {
    const draft = { ...newDraft(false), name: 'x', redirects: { html: false, htaccess: false, json: false } };

    expect(requestOf(draft, null).config).toEqual({ redirectFormats: [] });
  });
});
