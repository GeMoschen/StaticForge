import { describe, expect, it } from 'vitest';
import { pickerDatasets, pickerTypeOptions } from './asset-picker.util';

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
