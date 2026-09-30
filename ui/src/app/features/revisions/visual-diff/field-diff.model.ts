import { FormArray, FormControl, FormGroup } from '@angular/forms';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { EditorDefinition } from '../../forms/form.model';
import { buildEditorControl } from '../../forms/form-builder.service';
import { isL10n } from '../../forms/l10n.util';

type FieldChange = components['schemas']['FieldChange'];

/** A single field change prepared for rendering: either as read-only editors or JSON. */
export interface RenderedChange {
  path: string;
  add: boolean;
  remove: boolean;
  editor: EditorDefinition | null;
  before: FormControl | FormGroup | FormArray | null;
  after: FormControl | FormGroup | FormArray | null;
  beforeJson?: unknown;
  afterJson?: unknown;
}

/** Returns an editor copy stripped of its label/help and forced read-only. */
export function readonlyEditor(editor: EditorDefinition): EditorDefinition {
  return { ...editor, readOnly: true, label: undefined, help: undefined };
}

/** Builds a disabled (read-only) control seeded with a raw field value. */
export function buildReadonlyControl(
  editor: EditorDefinition,
  value: unknown,
): FormControl | FormGroup | FormArray {
  const control = buildEditorControl(editor, value) as
    | FormControl
    | FormGroup
    | FormArray;
  control.disable({ emitEvent: false });
  return control;
}

/** Formats a raw value for the JSON fallback view. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

/** The minimal shape both a server {@link FieldChange} and the body differ's change share. */
interface PathChange {
  path?: string;
  before?: unknown;
  after?: unknown;
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Splits a change whose value is a whole language-dependent value (`{type: 'L10N', values: {...}}`) into one change per
 * language, at `<path>.values.<locale>` — the path the server differ emits when only one language changed. Rendered
 * as-is, the wrapper object would reach a plain editor and print `[object Object]`. A change that is not
 * language-dependent, or that swaps a plain value for a language-dependent one, is returned unchanged.
 */
export function expandL10nChange<T extends PathChange>(change: T): T[] {
  const { before, after } = change;
  const beforeOk = isAbsent(before) || isL10n(before);
  const afterOk = isAbsent(after) || isL10n(after);
  if (!beforeOk || !afterOk || (isAbsent(before) && isAbsent(after))) {
    return [change];
  }
  const beforeValues = isL10n(before) ? before.values : {};
  const afterValues = isL10n(after) ? after.values : {};
  const locales = [...new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)])];
  return locales.flatMap((locale) => {
    const b = beforeValues[locale];
    const a = afterValues[locale];
    if (JSON.stringify(b) === JSON.stringify(a)) {
      return [];
    }
    return [
      { ...change, path: `${change.path ?? ''}.values.${locale}`, before: b, after: a, add: isAbsent(b), remove: isAbsent(a) } as T,
    ];
  });
}

/** Builds a {@link RenderedChange} from a raw {@link FieldChange} and an optional editor. */
export function toRenderedChange(change: FieldChange, editor: EditorDefinition | null): RenderedChange {
  // A whole language-dependent value that could not be split per language belongs in the JSON view, not in an editor.
  if (editor && (isL10n(change.before) || isL10n(change.after))) {
    editor = null;
  }
  const beforePresent = change.before !== null && change.before !== undefined;
  const afterPresent = change.after !== null && change.after !== undefined;
  if (editor) {
    const def = readonlyEditor(editor);
    return {
      path: change.path ?? '',
      add: change.add === true,
      remove: change.remove === true,
      editor: def,
      before: beforePresent ? buildReadonlyControl(def, change.before) : null,
      after: afterPresent ? buildReadonlyControl(def, change.after) : null,
    };
  }
  return {
    path: change.path ?? '',
    add: change.add === true,
    remove: change.remove === true,
    editor: null,
    before: null,
    after: null,
    beforeJson: change.before,
    afterJson: change.after,
  };
}
