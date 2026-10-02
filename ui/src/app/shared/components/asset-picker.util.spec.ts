import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import { folderRows, matchingDatasets, pickerDatasets, pickerRecordSets, pickerTypeOptions, recordCountLabel, folderTrail, folderOptions } from './asset-picker.util';

/** The active language's text for a key, through the real `en.json`. */
const t = (key: string, params?: Record<string, unknown>) => TestBed.inject(TranslocoService).translate(key, params);

describe('pickerTypeOptions', () => {
  const values = (allowed: string[] | null | undefined, dataset: string | null | undefined) =>
    pickerTypeOptions(allowed, dataset).map((o) => o.value);

  it('offers records and record sets of a restricted dataset exactly as far as assetTypes allows', () => {
    expect(values(['RECORD'], 'team')).toEqual(['RECORD']);
    expect(values(['RECORD_SET'], 'team')).toEqual(['RECORD_SET']);
    expect(values(['RECORD_SET', 'RECORD', 'PAGE'], 'team')).toEqual(['RECORD', 'RECORD_SET']);
  });

  /** The server accepts only records for `dataset "uid"` without `assetTypes` (M19), never a record set. */
  it('offers records only for a dataset restriction without assetTypes', () => {
    expect(values(null, 'team')).toEqual(['RECORD']);
    expect(values(undefined, 'team')).toEqual(['RECORD']);
    expect(values([], 'team')).toEqual(['RECORD']);
  });

  it('falls back to records when assetTypes allows neither dataset-bound type (a CDL error)', () => {
    expect(values(['PAGE'], 'team')).toEqual(['RECORD']);
  });

  it('filters by assetTypes and falls back to everything for an unknown restriction', () => {
    expect(values(['RECORD', 'PAGE'], null)).toEqual(['PAGE', 'RECORD']);
    expect(values(['RECORD_SET'], null)).toEqual(['RECORD_SET']);
    expect(t(pickerTypeOptions(['RECORD_SET'], null)[0].labelKey)).toBe('Record sets');
    expect(values(['NOPE'], null)).toEqual(['PAGE', 'MEDIA', 'PAGE_REFERENCE', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'RECORD', 'RECORD_SET']);
    expect(values([], undefined)).toHaveLength(7);
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
    expect(recordCountLabel(1, t)).toBe('1 record');
    expect(recordCountLabel(0, t)).toBe('0 records');
    expect(recordCountLabel(undefined, t)).toBe('0 records');
    expect(recordCountLabel(12, t)).toBe('12 records');
  });
});

describe('pagination sources', () => {
  it('offers navigation folders and datasets only when asked for by name', () => {
    expect(pickerTypeOptions(null, null).map((o) => o.value)).not.toContain('NAV_FOLDER');
    expect(pickerTypeOptions(['NAV_FOLDER', 'DATASET'], null).map((o) => t(o.labelKey))).toEqual(['Navigation folders', 'Datasets']);
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

describe('folder trail and options (M35.17)', () => {
  const tree = [
    { uuid: 'a', displayName: 'About', children: [{ uuid: 'a1', displayName: 'Team', children: [{ uuid: 'a11', uid: 'dev' }] }] },
    { uuid: 'b', uid: 'news' },
  ];

  it('walks from the top folder down to the one asked for', () => {
    expect(folderTrail(tree, 'a11').map((f) => f.uuid)).toEqual(['a', 'a1', 'a11']);
    expect(folderTrail(tree, 'b').map((f) => f.uuid)).toEqual(['b']);
  });

  it('is empty for no folder or one that is not in the tree', () => {
    expect(folderTrail(tree, null)).toEqual([]);
    expect(folderTrail(tree, 'zzz')).toEqual([]);
    expect(folderTrail(null, 'a')).toEqual([]);
  });

  it('lists the folders as select options, a child after its parent, marked by depth', () => {
    expect(folderOptions(tree)).toEqual([
      { value: 'a', label: 'About' },
      { value: 'a1', label: '– Team' },
      { value: 'a11', label: '– – dev' },
      { value: 'b', label: 'news' },
    ]);
  });
});

describe('navigation entries (PAGE_REFERENCE)', () => {
  it('are part of the default type switch, after media, and can be asked for by name', () => {
    expect(pickerTypeOptions(null, null).map((o) => o.value)).toEqual(['PAGE', 'MEDIA', 'PAGE_REFERENCE', 'PAGE_TEMPLATE', 'SECTION_TEMPLATE', 'RECORD', 'RECORD_SET']);
    expect(pickerTypeOptions(['PAGE_REFERENCE'], null).map((o) => t(o.labelKey))).toEqual(['Navigation entries']);
    expect(pickerTypeOptions(['PAGE', 'PAGE_REFERENCE'], null).map((o) => o.value)).toEqual(['PAGE', 'PAGE_REFERENCE']);
  });

  it('are not offered under a dataset restriction', () => {
    expect(pickerTypeOptions(['PAGE_REFERENCE'], 'team').map((o) => o.value)).toEqual(['RECORD']);
  });
});
