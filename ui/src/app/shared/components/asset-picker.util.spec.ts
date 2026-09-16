import { describe, expect, it } from 'vitest';
import { folderRows, matchingDatasets, pickerDatasets, pickerTypeOptions } from './asset-picker.util';

describe('pickerTypeOptions', () => {
  it('offers only records when the editor is restricted to a dataset', () => {
    expect(pickerTypeOptions(['PAGE'], 'team').map((o) => o.value)).toEqual(['RECORD']);
  });

  it('filters by assetTypes and falls back to everything for an unknown restriction', () => {
    expect(pickerTypeOptions(['RECORD', 'PAGE'], null).map((o) => o.value)).toEqual(['PAGE', 'RECORD']);
    expect(pickerTypeOptions(['NOPE'], null)).toHaveLength(5);
    expect(pickerTypeOptions([], undefined)).toHaveLength(5);
  });
});

describe('pagination sources', () => {
  it('offers navigation folders and datasets only when asked for by name', () => {
    expect(pickerTypeOptions(null, null).map((o) => o.value)).not.toContain('NAV_FOLDER');
    expect(pickerTypeOptions(['NAV_FOLDER', 'DATASET'], null).map((o) => o.label)).toEqual(['Navigation folders', 'Datasets']);
    expect(pickerTypeOptions(['DATASET'], null).map((o) => o.value)).toEqual(['DATASET']);
  });

  const tree = [
    {
      uuid: 'root',
      uid: 'navigation_root',
      displayName: 'All Navigation',
      path: '/',
      children: [
        { uuid: 'blog', uid: 'blog', displayName: 'Blog', path: '/blog/', children: [{ uuid: 'archive', displayName: 'Archive' }] },
        { uuid: 'docs', uid: 'docs', displayName: 'Docs', path: '/docs/' },
      ],
    },
  ];

  it('lists a folder tree depth-first with its depth', () => {
    expect(folderRows(tree).map((r) => [r.uuid, r.depth])).toEqual([
      ['root', 0],
      ['blog', 1],
      ['archive', 2],
      ['docs', 1],
    ]);
  });

  it('keeps the ancestors of a search match', () => {
    expect(folderRows(tree, 'ARCH').map((r) => r.uuid)).toEqual(['root', 'blog', 'archive']);
    expect(folderRows(tree, 'docs').map((r) => r.uuid)).toEqual(['root', 'docs']);
    expect(folderRows(tree, 'nothing')).toEqual([]);
  });

  it('filters datasets by name or uid', () => {
    const datasets = [
      { uid: 'team', displayName: 'Team' },
      { uid: 'products', displayName: 'Catalog' },
    ];
    expect(matchingDatasets(datasets, 'prod').map((d) => d.uid)).toEqual(['products']);
    expect(matchingDatasets(datasets, ' ')).toHaveLength(2);
  });
});

describe('pickerDatasets', () => {
  const datasets = [
    { uid: 'team', displayName: 'Team' },
    { uid: 'products', displayName: 'Products' },
  ];

  it('keeps only the restricted dataset', () => {
    expect(pickerDatasets(datasets, 'team')).toEqual([{ uid: 'team', displayName: 'Team' }]);
    expect(pickerDatasets(datasets, 'gone')).toEqual([]);
  });

  it('offers every dataset without a restriction', () => {
    expect(pickerDatasets(datasets, null)).toEqual(datasets);
  });
});
