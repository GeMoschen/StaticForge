import type { components } from '../../core/api/generated/schema.d.ts';

type Diagnostic = components['schemas']['Diagnostic'];

/**
 * Pure helpers behind the media drawer's text editor (M18.4.1), kept free of Angular so their specs
 * run without the `templateUrl` component runner.
 */

/** Files above this size open read-only: a plain textarea gets sluggish with multi-megabyte bundles. */
export const TEXT_EDITOR_MAX_BYTES = 1_000_000;

/** Debounce for live validation while typing. */
export const VALIDATE_DEBOUNCE_MS = 400;

/**
 * The character offset of a 1-based `line`/`column` diagnostic position in `text`, clamped to the
 * text. Columns count characters the way the OCTL lexer does: a `\r` of a CRLF line ending takes no
 * column. Column 0 (position unknown) is the start of the line.
 */
export function offsetForPosition(text: string, line: number, column: number): number {
  let offset = 0;
  let currentLine = 1;
  while (currentLine < line) {
    const newline = text.indexOf('\n', offset);
    if (newline < 0) {
      return text.length;
    }
    offset = newline + 1;
    currentLine++;
  }
  let remaining = Math.max(0, column - 1);
  while (remaining > 0 && offset < text.length && text[offset] !== '\n') {
    if (text[offset] !== '\r') {
      remaining--;
    }
    offset++;
  }
  return offset;
}

/** Inserts a tab over the selection; returns the new value and the caret position after the tab. */
export function insertTab(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; caret: number } {
  return {
    value: value.slice(0, selectionStart) + '\t' + value.slice(selectionEnd),
    caret: selectionStart + 1,
  };
}

export function hasErrors(diagnostics: readonly Diagnostic[] | null | undefined): boolean {
  return (diagnostics ?? []).some((d) => d.severity === 'ERROR');
}

/** `line:column` for a diagnostic, or an empty string when its position is unknown. */
export function positionLabel(diagnostic: Diagnostic): string {
  return diagnostic.line ? `${diagnostic.line}:${diagnostic.column ?? 0}` : '';
}

/** The `diagnostics` of a 422 problem body, or an empty list for anything else. */
export function diagnosticsOf(error: unknown): Diagnostic[] {
  const body = (error as { error?: unknown } | null)?.error;
  const diagnostics = (body as { diagnostics?: unknown } | null)?.diagnostics;
  return Array.isArray(diagnostics) ? (diagnostics as Diagnostic[]) : [];
}

export type LineEnding = 'LF' | 'CRLF' | 'MIXED';

/** The line endings of a file: a `<textarea>` hands back LF only, so CRLF has to be restored on save. */
export function lineEndingOf(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length;
  if (crlf === 0) {
    return 'LF';
  }
  return crlf === lf ? 'CRLF' : 'MIXED';
}

/**
 * Restores a file's line endings on text read back from a `<textarea>` (whose value is always
 * LF). A CRLF file gets CRLF back; a file with mixed endings can't be reproduced and is saved as LF.
 */
export function withLineEnding(editorValue: string, ending: LineEnding): string {
  return ending === 'CRLF' ? editorValue.replace(/\r?\n/g, '\r\n') : editorValue;
}
