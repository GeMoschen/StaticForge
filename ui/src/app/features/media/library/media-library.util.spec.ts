import { describe, expect, it } from 'vitest';
import { MEDIA_TREE, PRODUCTS, productFiles, summary } from './media-library.testing';
import {
  compareMedia,
  folderChain,
  formatOf,
  isRaster,
  isTransparent,
  matchesType,
  mediaKind,
  parseSort,
  sortParam,
  visibleMedia,
} from './media-library.util';

const names = (items: { displayName?: string }[]) => items.map((item) => item.displayName);

describe('media library util', () => {
  describe('what a file is', () => {
    it('tells pictures, text and other documents apart from what the list sends', () => {
      const [yirgacheffe, , , css, svg, pdf] = productFiles();
      expect(mediaKind(yirgacheffe)).toBe('image');
      expect(mediaKind(css)).toBe('text');
      expect(mediaKind(svg)).toBe('text');
      expect(mediaKind(pdf)).toBe('document');
    });

    it('names the format from the media type, else from the extension', () => {
      expect(formatOf(summary('a.jpg', PRODUCTS))).toBe('JPG');
      expect(formatOf(summary('a.svg', PRODUCTS))).toBe('SVG');
      expect(formatOf(summary('a.pdf', PRODUCTS))).toBe('PDF');
      expect(formatOf({ displayName: 'font.woff2', mimeType: 'font/woff2' })).toBe('WOFF2');
      expect(formatOf({ displayName: 'readme', mimeType: 'application/x-thing+json' })).toBe('X-THING');
    });

    it('gives rasters a thumbnail and marks the transparent kinds', () => {
      expect(isRaster('image/jpeg')).toBe(true);
      expect(isRaster('image/svg+xml')).toBe(false);
      expect(isRaster('application/pdf')).toBe(false);
      expect(isRaster(undefined)).toBe(false);
      expect(isTransparent('image/png')).toBe(true);
      expect(isTransparent('image/jpeg')).toBe(false);
    });
  });

  describe('the type filter', () => {
    const files = productFiles();

    it('images keep every picture, an SVG included', () => {
      expect(names(files.filter((f) => matchesType(f, 'images')))).toEqual(['yirgacheffe.jpg', 'latte-art.jpg', 'logo-mark.png', 'logo.svg']);
    });

    it('documents keep what is neither a picture nor text', () => {
      expect(names(files.filter((f) => matchesType(f, 'documents')))).toEqual(['price-list.pdf']);
    });

    it('text keeps the stylesheet and the SVG', () => {
      expect(names(files.filter((f) => matchesType(f, 'text')))).toEqual(['brand.css', 'logo.svg']);
    });
  });

  describe('sorting', () => {
    const files = productFiles();

    it('sorts by name, numbers by value, in either direction', () => {
      const numbered = [summary('img-10.jpg', PRODUCTS), summary('img-2.jpg', PRODUCTS), summary('Img-1.jpg', PRODUCTS)];
      expect(names(visibleMedia(numbered, '', 'all', 'name', 'asc'))).toEqual(['Img-1.jpg', 'img-2.jpg', 'img-10.jpg']);
      expect(names(visibleMedia(numbered, '', 'all', 'name', 'desc'))).toEqual(['img-10.jpg', 'img-2.jpg', 'Img-1.jpg']);
    });

    it('sorts dates ascending as newest first', () => {
      expect(names(visibleMedia(files, '', 'all', 'date', 'asc'))).toEqual([
        'latte-art.jpg',
        'yirgacheffe.jpg',
        'brand.css',
        'logo.svg',
        'price-list.pdf',
        'logo-mark.png',
      ]);
      expect(names(visibleMedia(files, '', 'all', 'date', 'desc')).at(0)).toBe('logo-mark.png');
    });

    it('sorts by size and by type, ties by name', () => {
      expect(names(visibleMedia(files, '', 'all', 'size', 'desc')).slice(0, 2)).toEqual(['yirgacheffe.jpg', 'latte-art.jpg']);
      expect(names(visibleMedia(files, '', 'all', 'type', 'asc'))).toEqual([
        'brand.css',
        'latte-art.jpg',
        'yirgacheffe.jpg',
        'price-list.pdf',
        'logo-mark.png',
        'logo.svg',
      ]);
    });

    it('puts a file without a date last in "newest first"', () => {
      const undated = summary('old.jpg', PRODUCTS, { changedAt: undefined });
      const sorted = [summary('new.jpg', PRODUCTS), undated].sort(compareMedia('date'));
      expect(names(sorted)).toEqual(['new.jpg', 'old.jpg']);
    });

    it('does not change the list it was given', () => {
      const before = names(files);
      visibleMedia(files, '', 'all', 'size', 'desc');
      expect(names(files)).toEqual(before);
    });
  });

  describe('search', () => {
    it('matches the name in any case, together with the type filter', () => {
      const files = productFiles();
      expect(names(visibleMedia(files, '  LOGO ', 'all', 'name', 'asc'))).toEqual(['logo-mark.png', 'logo.svg']);
      expect(names(visibleMedia(files, 'logo', 'text', 'name', 'asc'))).toEqual(['logo.svg']);
      expect(visibleMedia(files, 'nothing', 'all', 'name', 'asc')).toEqual([]);
    });
  });

  describe('the sort parameter', () => {
    it('reads <field>-<direction> and nothing else', () => {
      expect(parseSort('size-desc')).toEqual({ sort: 'size', direction: 'desc' });
      expect(parseSort('date-asc')).toEqual({ sort: 'date', direction: 'asc' });
      expect(parseSort('size')).toBeNull();
      expect(parseSort('weight-asc')).toBeNull();
      expect(parseSort(null)).toBeNull();
    });

    it('leaves the default out of the URL', () => {
      expect(sortParam('name', 'asc')).toBeNull();
      expect(sortParam('name', 'desc')).toBe('name-desc');
      expect(sortParam('date', 'asc')).toBe('date-asc');
    });
  });

  describe('the folder chain', () => {
    it('runs from the top level down to the folder', () => {
      const wrapper = MEDIA_TREE[0].children ?? [];
      expect(folderChain(wrapper, 'roastery-uuid').map((f) => f.displayName)).toEqual(['Products', 'Roastery']);
      expect(folderChain(wrapper, 'team-uuid').map((f) => f.displayName)).toEqual(['Team']);
      expect(folderChain(wrapper, 'unknown')).toEqual([]);
    });
  });
});
