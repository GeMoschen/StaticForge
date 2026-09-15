import { describe, expect, it } from 'vitest';
import { previewErrorDocument, previewProblem } from './preview-error';

describe('previewProblem', () => {
  it('reads the problem from a text (JSON string) error body', () => {
    const problem = previewProblem({
      status: 422,
      error: JSON.stringify({ title: 'Render limit', code: 'SF-TPL-0135', detail: 'Include cycle: a → b → a' }),
    });
    expect(problem).toEqual({ status: 422, code: 'SF-TPL-0135', title: 'Render limit', detail: 'Include cycle: a → b → a' });
  });

  it('accepts an already parsed body', () => {
    expect(previewProblem({ status: 404, error: { code: 'SF-API-0404', detail: 'Page not found.' } })).toEqual({
      status: 404,
      code: 'SF-API-0404',
      title: 'Preview failed (404)',
      detail: 'Page not found.',
    });
  });

  it('falls back for non-problem bodies and network errors', () => {
    expect(previewProblem({ status: 500, error: '<html>oops</html>' })).toEqual({
      status: 500,
      code: null,
      title: 'Preview failed (500)',
      detail: null,
    });
    expect(previewProblem({ status: 0, error: new ProgressEvent('error') }).title).toBe('Preview unavailable');
    expect(previewProblem(undefined).status).toBe(0);
  });
});

describe('previewErrorDocument', () => {
  it('shows the code, title and detail', () => {
    const html = previewErrorDocument({ status: 422, code: 'SF-TPL-0135', title: 'Render limit', detail: 'Include cycle: a → b → a' });
    expect(html).toContain('SF-TPL-0135');
    expect(html).toContain('Render limit');
    expect(html).toContain('Include cycle: a → b → a');
    expect(html).toContain('role="alert"');
  });

  it('escapes every value', () => {
    const html = previewErrorDocument({ status: 422, code: '<b>', title: '"t"', detail: "<script>alert('x')</script>" });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&quot;t&quot;');
  });
});
