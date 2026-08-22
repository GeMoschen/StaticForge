import { describe, expect, it } from 'vitest';
import { parseGenerationFrame } from './generation-sse';

describe('parseGenerationFrame', () => {
  it('decodes a single progress frame', () => {
    const frame =
      'event: progress\ndata: {"stage":"RENDER","message":"Rendering","filesWritten":3,"errors":0,"warnings":1,"diagnostics":null}\n';
    const event = parseGenerationFrame(frame);
    expect(event).toMatchObject({
      stage: 'RENDER',
      message: 'Rendering',
      filesWritten: 3,
      errors: 0,
      warnings: 1,
      diagnostics: null,
    });
  });

  it('tolerates the SSE single leading space after data:', () => {
    const frame =
      'data: {"stage":"STATUS","message":"Done","filesWritten":12,"errors":1,"warnings":2}';
    const event = parseGenerationFrame(frame);
    expect(event?.filesWritten).toBe(12);
    expect(event?.errors).toBe(1);
  });

  it('joins multi-line data payloads', () => {
    const frame =
      'event: progress\ndata: {"stage":"PLAN","message":"a",\ndata: "filesWritten":0}\n';
    const event = parseGenerationFrame(frame);
    expect(event?.stage).toBe('PLAN');
  });

  it('returns null for frames without data', () => {
    expect(parseGenerationFrame('event: progress\n')).toBeNull();
    expect(parseGenerationFrame('')).toBeNull();
  });

  it('defaults missing numeric fields to zero', () => {
    const frame = 'data: {"stage":"STATUS","message":"ok"}';
    const event = parseGenerationFrame(frame);
    expect(event).toMatchObject({
      filesWritten: 0,
      errors: 0,
      warnings: 0,
    });
  });

  it('returns null for malformed JSON', () => {
    expect(parseGenerationFrame('data: not-json')).toBeNull();
  });
});
