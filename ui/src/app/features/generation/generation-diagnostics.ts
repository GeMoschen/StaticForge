/**
 * One group of run diagnostics as persisted on `GenerationRunView.diagnostics` and sent with the
 * final progress event: `{ errors: [{ code, count, messages }], warnings: [...], heldBack?: [...] }`.
 */
export interface DiagnosticGroup {
  severity: 'error' | 'warning';
  code: string;
  count: number;
  messages: string[];
}

/** The file error a page held back by an `ERROR` quality finding gets (M30.1.3, epic decision 5). */
export const HELD_BACK_CODE = 'SF-GEN-0125';

/**
 * A page the quality checks held back in one channel and language (M30.6.2): an entry of the run diagnostics'
 * `heldBack`, the `SF-GEN-0125` errors as data, in the same order as their messages. `uid` is `null` when the
 * snapshot no longer had the page, `locale` in a project without languages.
 */
export interface HeldBackPage {
  asset: string;
  uid: string | null;
  channel: string;
  locale: string | null;
  codes: string[];
}

/** The held-back pages of a run's `diagnostics`; empty for a run from before M30.6.2 and for malformed entries. */
export function parseHeldBack(diagnostics: unknown): HeldBackPage[] {
  const value = diagnostics && typeof diagnostics === 'object' ? (diagnostics as Record<string, unknown>)['heldBack'] : null;
  if (!Array.isArray(value)) {
    return [];
  }
  const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .filter((entry) => text(entry['asset']) !== null && text(entry['channel']) !== null)
    .map((entry) => ({
      asset: entry['asset'] as string,
      uid: text(entry['uid']),
      channel: entry['channel'] as string,
      locale: text(entry['locale']),
      codes: Array.isArray(entry['codes']) ? entry['codes'].filter((c): c is string => typeof c === 'string') : [],
    }));
}

/**
 * Flattens a run's `diagnostics` JSON into display groups, errors first. Tolerates `null` and
 * malformed shapes (returns what it can read) since the column is free-form JSON.
 */
export function parseDiagnostics(diagnostics: unknown): DiagnosticGroup[] {
  if (!diagnostics || typeof diagnostics !== 'object') {
    return [];
  }
  const source = diagnostics as Record<string, unknown>;
  return [...readGroups(source['errors'], 'error'), ...readGroups(source['warnings'], 'warning')];
}

function readGroups(value: unknown, severity: DiagnosticGroup['severity']): DiagnosticGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => {
      const messages = Array.isArray(entry['messages'])
        ? entry['messages'].filter((m): m is string => typeof m === 'string')
        : [];
      const count = typeof entry['count'] === 'number' ? entry['count'] : messages.length;
      return {
        severity,
        code: typeof entry['code'] === 'string' ? entry['code'] : '',
        count,
        messages,
      };
    });
}
