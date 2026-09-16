import { describe, expect, it } from 'vitest';
import type { EditorDefinition } from '../form.model';
import {
  clampPageSize,
  flattenFolders,
  maxPageSize,
  pageCountHint,
  paginationValue,
  pickerTypeFor,
  readPaginationValue,
  sortKeys,
  sourceKindOf,
  sourceKinds,
  summarizePagination,
} from './pagination-editor.util';

const editor = (pagination?: EditorDefinition['pagination']): EditorDefinition => ({
  name: 'posts',
  type: 'PAGINATION',
  label: 'Posts',
  pagination,
});

describe('pagination editor', () => {
  it('offers only the declared source kinds, navigation when undeclared', () => {
    expect(sourceKinds(editor())).toEqual(['NAV']);
    expect(sourceKinds(editor({ sources: ['nav', 'dataset'], pageSize: 10, sort: [] }))).toEqual(['NAV', 'DATASET']);
    expect(sourceKinds(editor({ sources: ['dataset'], pageSize: 10, sort: [] }))).toEqual(['DATASET']);
  });

  it('offers navigation keys to a navigation source and field names to a dataset', () => {
    const both = editor({ sources: ['nav', 'dataset'], pageSize: 10, sort: ['navigation', 'date', 'title', 'position'] });
    expect(sortKeys(both, 'NAV')).toEqual(['navigation', 'date', 'position']);
    expect(sortKeys(both, 'DATASET')).toEqual(['date', 'title']);
    expect(sortKeys(editor(), 'NAV')).toEqual(['navigation']);
    expect(sortKeys(editor(), 'DATASET')).toEqual(['_displayName']);
  });

  it('bounds the page size by maxPageSize', () => {
    const bounded = editor({ sources: ['nav'], pageSize: 10, maxPageSize: 50, sort: [] });
    expect(maxPageSize(bounded)).toBe(50);
    expect(maxPageSize(editor())).toBe(1000);
    expect(clampPageSize(bounded, '25')).toBe(25);
    expect(clampPageSize(bounded, '500')).toBe(50);
    expect(clampPageSize(bounded, '0')).toBe(1);
    expect(clampPageSize(bounded, '-3')).toBe(1);
    expect(clampPageSize(bounded, 'x')).toBe(10);
    expect(clampPageSize(bounded, '7.9')).toBe(7);
  });

  it('round-trips the stored value shape', () => {
    const value = paginationValue('NAV', 'f-1', 5, 'date', 'DESC');
    expect(value).toEqual({
      type: 'PAGINATION',
      source: { kind: 'NAV', uuid: 'f-1' },
      pageSize: 5,
      sort: { key: 'date', direction: 'DESC' },
    });
    expect(readPaginationValue(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(readPaginationValue(null)).toBeNull();
    expect(readPaginationValue({ type: 'CATALOG', cards: [] })).toBeNull();
    expect(readPaginationValue({ type: 'PAGINATION', source: {} })).toBeNull();
  });

  it('lists navigation folders depth-first with indentation', () => {
    const options = flattenFolders([
      { uuid: 'a', displayName: 'Blog', children: [{ uuid: 'b', displayName: 'Archive', children: [] }] },
      { uuid: 'c', uid: 'news' },
    ]);
    expect(options.map((o) => o.uuid)).toEqual(['a', 'b', 'c']);
    expect(options[0].label).toBe('Blog');
    expect(options[1].label).toBe('  Archive');
    expect(options[2].label).toBe('news');
  });

  it('maps source kinds to picker types and back', () => {
    expect(pickerTypeFor('NAV')).toBe('NAV_FOLDER');
    expect(pickerTypeFor('DATASET')).toBe('DATASET');
    expect(sourceKindOf('NAV_FOLDER')).toBe('NAV');
    expect(sourceKindOf('DATASET')).toBe('DATASET');
    expect(sourceKindOf('PAGE')).toBeNull();
  });

  it('turns a count into the items → pages hint', () => {
    expect(pageCountHint(7, 2)).toBe('7 items → 4 pages');
    expect(pageCountHint(1, 10)).toBe('1 item → 1 page');
    expect(pageCountHint(0, 10)).toBe('0 items → 1 page');
    expect(pageCountHint(20, 10)).toBe('20 items → 2 pages');
    expect(pageCountHint(4, 2, 1)).toBe('4 items → 2 pages (1 entry points to no page and is skipped)');
    expect(pageCountHint(4, 2, 2)).toBe('4 items → 2 pages (2 entries point to no page and are skipped)');
  });

  it('summarizes a value for read-only views and the visual diff', () => {
    expect(summarizePagination(paginationValue('NAV', 'f-1', 10, 'date', 'DESC'), 'Blog')).toBe(
      'Source: Blog · 10 per page · Date ↓',
    );
    expect(summarizePagination(paginationValue('DATASET', 'd-1', 5, 'title', 'ASC'), null)).toBe(
      'Dataset: d-1 · 5 per page · title ↑',
    );
    expect(summarizePagination(null, null)).toBe('Not paginated');
  });
});
