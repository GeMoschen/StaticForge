import { FormArray, FormControl, FormGroup } from '@angular/forms';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { EditorDefinition } from '../../forms/form.model';
import { buildEditorControl } from '../../forms/form-builder.service';

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

/** Builds a {@link RenderedChange} from a raw {@link FieldChange} and an optional editor. */
export function toRenderedChange(change: FieldChange, editor: EditorDefinition | null): RenderedChange {
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
