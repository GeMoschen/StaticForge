/**
 * One group of run diagnostics as persisted on `GenerationRunView.diagnostics` and sent with the
 * final progress event: `{ errors: [{ code, count, messages }], warnings: [...] }`.
 */
export interface DiagnosticGroup {
  severity: 'error' | 'warning';
  code: string;
  count: number;
  messages: string[];
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
