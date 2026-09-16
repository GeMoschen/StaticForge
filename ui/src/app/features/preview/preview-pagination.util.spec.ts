import { describe, expect, it } from 'vitest';
import { pageNumbers, readPageHeaders, requestedPage } from './preview-pagination.util';

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe('preview pagination', () => {
  it('reads the rendered page and page count from the response headers', () => {
    expect(readPageHeaders(headers({ 'X-SF-Total-Pages': '3', 'X-SF-Page': '2' }))).toEqual({ page: 2, total: 3 });
    expect(readPageHeaders(headers({}))).toEqual({ page: 1, total: 1 });
    expect(readPageHeaders(headers({ 'X-SF-Total-Pages': '2', 'X-SF-Page': '9' }))).toEqual({ page: 2, total: 2 });
    expect(readPageHeaders(headers({ 'X-SF-Total-Pages': 'nope', 'X-SF-Page': '0' }))).toEqual({ page: 1, total: 1 });
  });

  it('lists the page numbers for the selector', () => {
    expect(pageNumbers(3)).toEqual([1, 2, 3]);
    expect(pageNumbers(0)).toEqual([1]);
  });

  it('accepts only page requests from the frame script', () => {
    expect(requestedPage({ type: 'sf-preview-page', page: 3 })).toBe(3);
    expect(requestedPage({ type: 'sf-preview-page', page: 0 })).toBeNull();
    expect(requestedPage({ type: 'sf-preview-page', page: 'x' })).toBeNull();
    expect(requestedPage({ type: 'sf-section-click', page: 2 })).toBeNull();
    expect(requestedPage('page=2')).toBeNull();
  });
});
