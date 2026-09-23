import { describe, expect, it } from 'vitest';
import {
  folderRows,
  matchingDatasets,
  pickerDatasets,
  pickerRecordSets,
  pickerTypeOptions,
  recordCountLabel,
} from './asset-picker.util';

describe('pickerTypeOptions', () => {
  const values = (allowed: string[] | null | undefined, dataset: string | null | undefined) =>
    pickerTypeOptions(allowed, dataset).map((o) => o.value);

  it('offers records and record sets of a restricted dataset, as far as assetTypes allows', () => {
    expect(values(null, 'team')).toEqual(['RECORD', 'RECORD_SET']);
    expect(values([], 'team')).toEqual(['RECORD', 'RECORD_SET']);
    expect(values(['RECORD'], 'team')).toEqual(['RECORD']);
    expect(values(['RECORD_SET'], 'team')).toEqual(['RECORD_SET']);
    expect(values(['RECORD_SET', 'RECORD', 'PAGE'], 'team')).toEqual(['RECORD', 'RECORD_SET']);
  });

  it('falls back to both dataset-bound types when assetTypes allows neither (a CDL error)', () => {
    expect(values(['PAGE'], 'team')).toEqual(['RECORD', 'RECORD_SET']);
  });

  it('filters by assetTypes and falls back to everything for an unknown restriction', () => {
    expect(values(['RECORD', 'PAGE'], null)).toEqual(['PAGE', 'RECORD']);
    expect(values(['RECORD_SET'], null)).toEqual(['RECORD_SET']);
    expect(pickerTypeOptions(['RECORD_SET'], null)[0].label).toBe('Record sets');
    expect(values(['NOPE'], null)).toEqual(['PAGE', 'MEDIA', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'RECORD', 'RECORD_SET']);
    expect(values([], undefined)).toHaveLength(6);
  });
});

describe('pickerRecordSets', () => {
  const sets = [
    { uid: 'leadership', displayName: 'Leadership', dataset: { uid: 'team' } },
    { uid: 'staff', displayName: 'Staff', dataset: { uid: 'team' } },
    { uid: 'featured', displayName: 'Featured', dataset: { uid: 'products' } },
  ];

  it("keeps only the restricted dataset's sets", () => {
    expect(pickerRecordSets(sets, 'team', '').map((s) => s.uid)).toEqual(['leadership', 'staff']);
    expect(pickerRecordSets(sets, 'gone', '')).toEqual([]);
  });

  it('offers every set without a restriction and filters by name or uid', () => {
    expect(pickerRecordSets(sets, null, '')).toHaveLength(3);
    expect(pickerRecordSets(sets, null, 'FEAT').map((s) => s.uid)).toEqual(['featured']);
    expect(pickerRecordSets(sets, 'team', 'staff').map((s) => s.uid)).toEqual(['staff']);
  });

  it('counts records in words', () => {
    expect(recordCountLabel(1)).toBe('1 record');
    expect(recordCountLabel(0)).toBe('0 records');
    expect(recordCountLabel(undefined)).toBe('0 records');
    expect(recordCountLabel(12)).toBe('12 records');
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
