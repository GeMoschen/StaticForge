/**
 * Turns a failed preview request into a document the preview frame can show instead of a blank
 * page. The preview endpoint answers render failures with an RFC 9457 problem (e.g. `422` with
 * `code: "SF-TPL-0135"` and `detail: "Include cycle: a → b → a"`), which the frame requests as text.
 */
export interface PreviewProblem {
  status: number;
  code: string | null;
  title: string;
  detail: string | null;
}

interface HttpErrorLike {
  status?: number;
  error?: unknown;
  message?: string;
}

/** Extracts status/code/title/detail from an `HttpErrorResponse` whose body may be a JSON string or object. */
export function previewProblem(error: unknown): PreviewProblem {
  const http = (error ?? {}) as HttpErrorLike;
  const status = typeof http.status === 'number' ? http.status : 0;
  const body = parseBody(http.error);
  const code = typeof body?.['code'] === 'string' ? (body['code'] as string) : null;
  const detail = typeof body?.['detail'] === 'string' ? (body['detail'] as string) : null;
  const title =
    typeof body?.['title'] === 'string'
      ? (body['title'] as string)
      : status === 0
        ? 'Preview unavailable'
        : `Preview failed (${status})`;
  return { status, code, title, detail };
}

/** A self-contained HTML document describing the problem; every value is HTML-escaped. */
export function previewErrorDocument(problem: PreviewProblem): string {
  const code = problem.code ? `<p class="sf-preview-error__code">${escapeHtml(problem.code)}</p>` : '';
  const detail = problem.detail ? `<p class="sf-preview-error__detail">${escapeHtml(problem.detail)}</p>` : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preview error</title><style>' +
    'body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;color:#7a1f1f;background:#fff5f5}' +
    '.sf-preview-error__code{font:600 13px ui-monospace,monospace;margin:0 0 4px}' +
    '.sf-preview-error__title{font-size:16px;font-weight:600;margin:0 0 8px}' +
    '.sf-preview-error__detail{margin:0;white-space:pre-wrap}' +
    '</style></head><body><div class="sf-preview-error" role="alert">' +
    code +
    `<p class="sf-preview-error__title">${escapeHtml(problem.title)}</p>` +
    detail +
    '</div></body></html>'
  );
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object') {
    return body as Record<string, unknown>;
  }
  if (typeof body === 'string' && body.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
