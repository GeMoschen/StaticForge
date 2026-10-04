import { describe, expect, it } from 'vitest';
import { pickPageUrls } from './navigation-urls.util';
import type { UrlRegistryEntryView } from './navigation.service';

const row = (data: Partial<UrlRegistryEntryView>): UrlRegistryEntryView => ({ targetType: 'PAGE', area: 'GENERATED', ...data });

describe('pickPageUrls', () => {
  it('prefers the generated site\'s URL over the preview\'s', () => {
    const urls = pickPageUrls(
      [row({ targetUuid: 'p1', area: 'PREVIEW', url: '/preview/a/' }), row({ targetUuid: 'p1', area: 'GENERATED', url: '/a/' })],
      null,
    );
    expect(urls.get('p1')).toBe('/a/');
  });

  it('falls back to the preview URL while nothing was built', () => {
    expect(pickPageUrls([row({ targetUuid: 'p1', area: 'PREVIEW', url: '/a/' })], null).get('p1')).toBe('/a/');
  });

  it('prefers the editing language, then a row without a language, then another language', () => {
    const rows = [
      row({ targetUuid: 'p1', locale: 'de', url: '/de/a/' }),
      row({ targetUuid: 'p1', locale: 'en', url: '/en/a/' }),
      row({ targetUuid: 'p2', locale: 'de', url: '/de/b/' }),
      row({ targetUuid: 'p2', url: '/b/' }),
      row({ targetUuid: 'p3', locale: 'de', url: '/de/c/' }),
    ];
    const urls = pickPageUrls(rows, 'en');
    expect(urls.get('p1')).toBe('/en/a/');
    expect(urls.get('p2')).toBe('/b/');
    expect(urls.get('p3')).toBe('/de/c/');
  });

  it('skips further pagination pages, variants, deleted targets and rows without a URL', () => {
    const rows = [
      row({ targetUuid: 'p1', pageNumber: 2, url: '/a/page/2/' }),
      row({ targetUuid: 'p1', pageNumber: 1, url: '/a/' }),
      row({ targetUuid: 'p2', variant: 'thumb', url: '/b.jpg' }),
      row({ targetUuid: 'p3', targetDeleted: true, url: '/c/' }),
      row({ targetUuid: 'p4' }),
    ];
    const urls = pickPageUrls(rows, null);
    expect([...urls.keys()]).toEqual(['p1']);
    expect(urls.get('p1')).toBe('/a/');
  });
});
