import { describe, expect, it } from 'vitest';
import { assetLocation } from './asset-ref';
import { openedAsset } from './opened-asset';

const U = '0b9c3a8e-1d2f-4c5b-9a7e-6f1d2c3b4a5e';

describe('openedAsset', () => {
  it('reads a page, a record and a record set from the path', () => {
    expect(openedAsset(`/p/acme/pages/${U}`)).toEqual({ projectKey: 'acme', uuid: U });
    expect(openedAsset(`/p/acme/content/records/${U}?dataset=x`)).toEqual({ projectKey: 'acme', uuid: U });
    expect(openedAsset(`/p/acme/content/sets/${U}`)).toEqual({ projectKey: 'acme', uuid: U });
  });

  it('reads a template or dataset from its route, and a folder from the query (M35.21)', () => {
    expect(openedAsset(`/p/acme/templates/${U}`)).toEqual({ projectKey: 'acme', uuid: U });
    expect(openedAsset(`/p/acme/templates?folder=${U}`)).toEqual({ projectKey: 'acme', uuid: U });
    expect(openedAsset(`/p/acme/templates?asset=${U}`)).toEqual({ projectKey: 'acme', uuid: U });
  });

  it('reads the asset or folder a store keeps in its query', () => {
    expect(openedAsset(`/p/acme/media?asset=${U}`)).toEqual({ projectKey: 'acme', uuid: U });
    expect(openedAsset(`/p/acme/pages?folder=${U}`)).toEqual({ projectKey: 'acme', uuid: U });
    expect(openedAsset(`/p/acme/globals?asset=${U}#top`)).toEqual({ projectKey: 'acme', uuid: U });
  });

  it('knows nothing is open on a list, a settings page or outside a project', () => {
    expect(openedAsset('/p/acme/pages')).toBeNull();
    expect(openedAsset(`/p/acme/settings/general?asset=${U}`)).toBeNull();
    expect(openedAsset('/p/acme/pages/not-a-uuid')).toBeNull();
    expect(openedAsset('/admin/users')).toBeNull();
    expect(openedAsset('/')).toBeNull();
  });
});

describe('assetLocation', () => {
  it('drops the store root and does not repeat a folder own name', () => {
    expect(assetLocation('/pages_root/news/archive/', 'PAGE')).toBe('news › archive');
    expect(assetLocation('/pages_root/news/archive/', 'FOLDER')).toBe('news');
    expect(assetLocation('/pages_root/news/', 'FOLDER')).toBeNull();
    expect(assetLocation(undefined, 'PAGE')).toBeNull();
  });
});
