import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { PRODUCTS, summary } from './media-library.testing';
import { MediaThumbnailStore } from './media-thumbnail.store';

function setup() {
  const api = {
    mediaThumbnailBlob: vi.fn().mockReturnValue(of(new Blob(['x']))),
    mediaText: vi.fn().mockReturnValue(of({ text: '﻿l1\r\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9', mimeType: 'text/css' })),
  };
  const locale = signal<string | null>('de');
  TestBed.configureTestingModule({
    providers: [MediaThumbnailStore, { provide: ApiClient, useValue: api }, { provide: EditingLocaleStore, useValue: { locale } }],
  });
  return { store: TestBed.inject(MediaThumbnailStore), api, locale };
}

describe('MediaThumbnailStore', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:one');
    URL.revokeObjectURL = vi.fn();
  });

  it('requests the thumbnail of a raster once and serves it from a blob URL', () => {
    const { store, api } = setup();
    const photo = summary('a.jpg', PRODUCTS);

    store.request('proj', photo);
    store.request('proj', photo);

    expect(api.mediaThumbnailBlob).toHaveBeenCalledTimes(1);
    expect(api.mediaThumbnailBlob).toHaveBeenCalledWith('proj', photo.uuid, null);
    expect(store.thumb(photo)).toBe('blob:one');
    expect(store.snippet(photo)).toBeNull();
  });

  it('asks again when the file was replaced (another revision) and drops the old URL', () => {
    const { store, api } = setup();
    const photo = summary('a.jpg', PRODUCTS);
    store.request('proj', photo);
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockReturnValue('blob:two');

    const replaced = { ...photo, revision: 4 };
    store.request('proj', replaced);

    expect(api.mediaThumbnailBlob).toHaveBeenCalledTimes(2);
    expect(store.thumb(replaced)).toBe('blob:two');
    expect(store.thumb(photo)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one');
  });

  it('does not ask again for a file that has no thumbnail', () => {
    const { store, api } = setup();
    api.mediaThumbnailBlob.mockReturnValue(throwError(() => new Error('415')));
    const photo = summary('a.jpg', PRODUCTS);

    store.request('proj', photo);
    store.request('proj', photo);

    expect(api.mediaThumbnailBlob).toHaveBeenCalledTimes(1);
    expect(store.thumb(photo)).toBeNull();
  });

  it('gives a localized picture the thumbnail of the editing language', () => {
    const { store, api, locale } = setup();
    const hero = summary('hero.png', PRODUCTS, { localized: true });

    store.request('proj', hero);
    locale.set('en');
    store.request('proj', hero);

    expect(api.mediaThumbnailBlob.mock.calls.map((call) => call[2])).toEqual(['de', 'en']);
  });

  it('reads the first lines of a small text file for its card, and leaves out the BOM', () => {
    const { store, api } = setup();
    const css = summary('brand.css', PRODUCTS, { sizeBytes: 300 });

    store.request('proj', css);

    expect(api.mediaText).toHaveBeenCalledWith('proj', css.uuid, null, null);
    expect(store.snippet(css)).toBe('l1\nl2\nl3\nl4\nl5\nl6\nl7');
    expect(api.mediaThumbnailBlob).not.toHaveBeenCalled();
  });

  it('does not read a text file that is large, nor a PDF, nor an SVG as a thumbnail', () => {
    const { store, api } = setup();

    store.requestAll('proj', [
      summary('big.css', PRODUCTS, { sizeBytes: 5_000_000 }),
      summary('price.pdf', PRODUCTS),
      summary('logo.svg', PRODUCTS, { sizeBytes: 200 }),
    ]);

    expect(api.mediaThumbnailBlob).not.toHaveBeenCalled();
    expect(api.mediaText).toHaveBeenCalledTimes(1); // only the SVG's text
  });

  it('releases its blob URLs when it is destroyed', () => {
    const { store } = setup();
    store.request('proj', summary('a.jpg', PRODUCTS));

    store.ngOnDestroy();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:one');
  });
});
