import { describe, expect, it } from 'vitest';
import { releaseChoicesOf, releaseScope } from './content-release.util';
import { buildIndex } from './content-tree.util';
import type { FolderView, RecordSetSummaryView } from './content.service';

const TREE: FolderView[] = [
  {
    uuid: 'root',
    uid: 'content_root',
    displayName: 'All Content',
    path: '/content_root/',
    type: 'FOLDER',
    children: [
      {
        uuid: 'shop',
        uid: 'shop',
        displayName: 'Shop',
        path: '/content_root/shop/',
        type: 'FOLDER',
        release: { '': { status: 'CHANGED' } } as never,
        children: [
          { uuid: 'set-a', uid: 'a', displayName: 'Alpha', type: 'RECORD_SET' },
          {
            uuid: 'spring',
            uid: 'spring',
            displayName: 'Spring',
            path: '/content_root/shop/spring/',
            type: 'FOLDER',
            children: [{ uuid: 'set-b', uid: 'b', displayName: 'Beta', type: 'RECORD_SET' }],
          },
        ],
      },
      { uuid: 'set-c', uid: 'c', displayName: 'Gamma', type: 'RECORD_SET' },
    ],
  },
];

const SETS: RecordSetSummaryView[] = [
  { uuid: 'set-a', uid: 'a', displayName: 'Alpha', folderUuid: 'shop', release: { '': { status: 'CHANGED' } } as never },
  { uuid: 'set-b', uid: 'b', displayName: 'Beta', folderUuid: 'spring', release: { '': { status: 'CHANGED' } } as never },
  { uuid: 'set-c', uid: 'c', displayName: 'Gamma', folderUuid: 'root', release: { '': { status: 'PUBLISHED' } } as never },
];

describe('content release scope', () => {
  const index = buildIndex(TREE, SETS);
  const entry = (uuid: string) => index.entries.get(uuid)!;

  it('covers a folder, every folder and record set inside it, each once', () => {
    expect(releaseScope(index, [entry('shop')]).map((e) => e.uuid)).toEqual(['shop', 'set-a', 'spring', 'set-b']);
    expect(releaseScope(index, [entry('shop'), entry('spring')]).map((e) => e.uuid)).toEqual(['shop', 'set-a', 'spring', 'set-b']);
  });

  it('covers a record set alone', () => {
    expect(releaseScope(index, [entry('set-c')]).map((e) => e.uuid)).toEqual(['set-c']);
  });

  it('offers the unreleased entries ticked, named by entry, and skips what is released', () => {
    const choices = releaseChoicesOf(index, [entry('shop')], null, (code) => code);

    expect(choices.map((c) => [c.assetUuid, c.assetType, c.checked])).toEqual([
      ['shop', 'FOLDER', true],
      ['set-a', 'RECORD_SET', true],
      ['set-b', 'RECORD_SET', true],
    ]);
    expect(choices[1].label.startsWith('Alpha · ')).toBe(true);
  });

  it('has nothing to offer when everything is released', () => {
    expect(releaseChoicesOf(index, [entry('set-c')], null, (code) => code)).toEqual([]);
  });
});
