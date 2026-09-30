import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SfRelativeTimePipe } from './sf-relative-time.pipe';

describe('SfRelativeTimePipe', () => {
  let pipe: SfRelativeTimePipe;
  beforeEach(() => {
    pipe = TestBed.runInInjectionContext(() => new SfRelativeTimePipe());
  });

  const now = new Date('2026-08-20T12:00:00Z');

  it('renders "just now" for recent timestamps', () => {
    expect(pipe.transform(new Date('2026-08-20T11:59:40Z'), now)).toBe(
      'just now',
    );
  });

  it('renders minutes in the past', () => {
    expect(pipe.transform(new Date('2026-08-20T11:55:00Z'), now)).toBe(
      '5 min ago',
    );
  });

  it('renders hours in the past', () => {
    expect(pipe.transform(new Date('2026-08-20T10:00:00Z'), now)).toBe(
      '2 h ago',
    );
  });

  it('renders the future and the larger units', () => {
    expect(pipe.transform(new Date('2026-08-20T12:05:00Z'), now)).toBe('5 min from now');
    expect(pipe.transform(new Date('2026-08-18T12:00:00Z'), now)).toBe('2 d ago');
    expect(pipe.transform(new Date('2026-06-20T12:00:00Z'), now)).toBe('2 mo ago');
    expect(pipe.transform(new Date('2024-08-20T12:00:00Z'), now)).toBe('2 y ago');
  });

  it('renders invalid input as em dash', () => {
    expect(pipe.transform(undefined, now)).toBe('—');
    expect(pipe.transform('not-a-date', now)).toBe('—');
  });
});
