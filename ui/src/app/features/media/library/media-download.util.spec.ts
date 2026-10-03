import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveBlob, zipSlug } from './media-download.util';

describe('zipSlug', () => {
  it('names the archive after the folder: lower case, one hyphen between words', () => {
    expect(zipSlug('Products')).toBe('products');
    expect(zipSlug('Spring Photos & Press')).toBe('spring-photos-press');
    expect(zipSlug('  --Büro 2026--  ')).toBe('büro-2026');
  });

  it('falls back when the name has no letters or digits', () => {
    expect(zipSlug('???')).toBe('media');
    expect(zipSlug('…', 'files')).toBe('files');
  });
});

describe('saveBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clicks a download link named after the file and lets the URL go afterwards', () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:file');
    URL.revokeObjectURL = vi.fn();
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });

    saveBlob(new Blob(['x']), 'products.zip');

    expect(clicked).toEqual([{ href: 'blob:file', download: 'products.zip' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file');
    vi.useRealTimers();
  });
});
