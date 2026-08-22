import { describe, expect, it } from 'vitest';
import { diffFields, mergePayload } from './conflict-util';

describe('diffFields', () => {
  it('returns an empty list when payloads are identical', () => {
    const payload = { content: { title: 'Hello' }, bodies: { hero: [] } };
    expect(diffFields(payload, payload)).toEqual([]);
  });

  it('finds shallow field differences with dotted paths', () => {
    const base = { content: { title: 'Hello', slug: 'a' } };
    const theirs = { content: { title: 'Goodbye', slug: 'a' } };
    expect(diffFields(base, theirs)).toEqual([
      { path: 'content.title', base: 'Hello', theirs: 'Goodbye' },
    ]);
  });

  it('finds added and removed keys', () => {
    const base = { content: { title: 'Hello' } };
    const theirs = { content: { title: 'Hello', tagline: 'New' } };
    expect(diffFields(base, theirs)).toEqual([
      { path: 'content.tagline', base: undefined, theirs: 'New' },
    ]);
  });

  it('uses bracket notation for array indices', () => {
    const base = { bodies: { hero: [{ content: { heading: 'A' } }] } };
    const theirs = { bodies: { hero: [{ content: { heading: 'B' } }] } };
    expect(diffFields(base, theirs)).toEqual([
      { path: 'bodies.hero[0].content.heading', base: 'A', theirs: 'B' },
    ]);
  });
});

describe('mergePayload', () => {
  it('keeps server values for "theirs" decisions', () => {
    const theirs = { content: { title: 'Goodbye' } };
    const local = { content: { title: 'Hello' } };
    expect(mergePayload(theirs, local, { 'content.title': 'theirs' })).toEqual(theirs);
  });

  it('replaces server values with local ones for "mine" decisions', () => {
    const theirs = { content: { title: 'Goodbye', slug: 'b' }, nav: { label: 'X' } };
    const local = { content: { title: 'Hello', slug: 'a' }, nav: { label: 'X' } };
    const merged = mergePayload(theirs, local, { 'content.title': 'mine' });
    expect(merged).toEqual({ content: { title: 'Hello', slug: 'b' }, nav: { label: 'X' } });
  });

  it('applies mine at nested array paths', () => {
    const theirs = { bodies: { hero: [{ content: { heading: 'B', body: 'keep' } }] } };
    const local = { bodies: { hero: [{ content: { heading: 'A', body: 'mine' } }] } };
    const merged = mergePayload(theirs, local, { 'bodies.hero[0].content.heading': 'mine' });
    expect(merged).toEqual({
      bodies: { hero: [{ content: { heading: 'A', body: 'keep' } }] },
    });
  });

  it('does not mutate the source payload', () => {
    const theirs = { content: { title: 'Goodbye' } };
    const local = { content: { title: 'Hello' } };
    mergePayload(theirs, local, { 'content.title': 'mine' });
    expect(theirs).toEqual({ content: { title: 'Goodbye' } });
  });
});
