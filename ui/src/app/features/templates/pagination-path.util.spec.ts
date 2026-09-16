import { describe, expect, it } from 'vitest';
import {
  declaresPagination,
  paginationPathError,
  paginationPathsForSave,
  readPaginationPaths,
} from './pagination-path.util';

describe('pagination paths in the template IDE', () => {
  it('shows the section for a template that declares or inherits a pagination editor', () => {
    expect(declaresPagination([{ type: 'TEXT' }, { type: 'PAGINATION' }], '')).toBe(true);
    expect(declaresPagination([{ type: 'GROUP', items: [{ type: 'PAGINATION' }] }], '')).toBe(true);
    expect(declaresPagination([], 'content {\n  editor   pagination posts { }\n}')).toBe(true);
    expect(declaresPagination([{ type: 'TEXT' }], 'content { editor text paginationNote { } }')).toBe(false);
    expect(declaresPagination(null, '')).toBe(false);
  });

  it('requires {pageNumber} in a non-blank pattern', () => {
    expect(paginationPathError('')).toBeNull();
    expect(paginationPathError('   ')).toBeNull();
    expect(paginationPathError('{pagePath}/page/{pageNumber}/index.{ext}')).toBeNull();
    expect(paginationPathError('{pagePath}-page.{ext}')).toContain('{pageNumber}');
  });

  it('reads stored patterns and sends only non-blank ones', () => {
    expect(readPaginationPaths({ html: '{pagePath}-{pageNumber}.{ext}', bad: 3 })).toEqual({
      html: '{pagePath}-{pageNumber}.{ext}',
    });
    expect(readPaginationPaths(null)).toEqual({});
    expect(paginationPathsForSave({ html: ' p/{pageNumber}.html ', markdown: '' })).toEqual({ html: 'p/{pageNumber}.html' });
  });
});
