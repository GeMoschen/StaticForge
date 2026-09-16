/** Preview headers of a paginated page (M21.3.1). */
export const TOTAL_PAGES_HEADER = 'X-SF-Total-Pages';
export const PAGE_HEADER = 'X-SF-Page';

/** The page number rendered and the page count, from the preview response headers; `1 of 1` when absent. */
export function readPageHeaders(headers: { get(name: string): string | null }): { page: number; total: number } {
  const total = positive(headers.get(TOTAL_PAGES_HEADER)) ?? 1;
  const page = Math.min(positive(headers.get(PAGE_HEADER)) ?? 1, total);
  return { page, total };
}

/** Pages `1..total`, for the page select. */
export function pageNumbers(total: number): number[] {
  return Array.from({ length: Math.max(1, total) }, (_, i) => i + 1);
}

/**
 * The page a message from the preview frame asks for: `{type: 'sf-preview-page', page}` with a positive integer page,
 * posted by the frame script when a pagination link is clicked. `null` for anything else.
 */
export function requestedPage(data: unknown): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const message = data as { type?: unknown; page?: unknown };
  return message.type === 'sf-preview-page' ? positive(String(message.page)) : null;
}

function positive(raw: string | null): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}
