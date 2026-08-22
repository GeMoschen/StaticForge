import { Injectable } from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import {
  ContentDefinition,
  EditorDefinition,
  LINK_FIELDS,
  MEDIA_FIELDS,
  REFERENCE_FIELDS,
  editorValueFromDefinition,
} from './form.model';

/** Strip HTML tags so `maxChars` is measured against visible text. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Custom validator enforcing the `maxChars` cardinality of a richtext value
 * (measured against tag-stripped character count).
 */
export function sfMaxChars(max: number): ValidatorFn {
  return (control: AbstractControl) => {
    const value = control.value;
    if (value == null || value === '') {
      return null;
    }
    const length = stripHtml(String(value)).length;
    return length > max ? { maxchars: { actual: length, max } } : null;
  };
}

/** Custom validator enforcing the min/max cardinality of a LIST form array. */
export function sfListLength(min?: number, max?: number): ValidatorFn {
  return (control: AbstractControl) => {
    const length = (control as FormArray).length;
    if (min != null && length < min) {
      return { listMin: { required: min, actual: length } };
    }
    if (max != null && length > max) {
      return { listMax: { required: max, actual: length } };
    }
    return null;
  };
}

/** Validator requiring a JSON editor's value to be parseable JSON. */
export function sfJson(): ValidatorFn {
  return (control: AbstractControl) => {
    const value = control.value;
    if (value == null || value === '') {
      return null;
    }
    try {
      JSON.parse(String(value));
      return null;
    } catch {
      return { json: true };
    }
  };
}

/** Returns a user-facing validation message for a control (i18n fallback text). */
export function errorMessageFor(
  definition: EditorDefinition,
  control: AbstractControl,
): string | null {
  const errors = control?.errors;
  if (!errors) {
    return null;
  }
  if (errors['required']) {
    return 'This field is required';
  }
  if (errors['maxlength']) {
    return `Must be at most ${errors['maxlength'].requiredLength} characters`;
  }
  if (errors['pattern']) {
    return definition.patternMessage ?? 'Invalid format';
  }
  if (errors['maxchars']) {
    return `Must be at most ${errors['maxchars'].max} characters`;
  }
  if (errors['min']) {
    return `Must be at least ${errors['min'].min}`;
  }
  if (errors['max']) {
    return `Must be at most ${errors['max'].max}`;
  }
  if (errors['listMin']) {
    return `At least ${errors['listMin'].required} rows required`;
  }
  if (errors['listMax']) {
    return `At most ${errors['listMax'].required} rows allowed`;
  }
  return 'Invalid value';
}

function seedFor(editor: EditorDefinition, seed: unknown): unknown {
  if (seed !== undefined && seed !== null) {
    return seed;
  }
  if (editor.defaultValue !== undefined && editor.defaultValue !== null) {
    return editor.defaultValue;
  }
  return editorValueFromDefinition(editor, undefined);
}

/**
 * Builds a single editor's `AbstractControl` from its definition and a seed
 * value. Recurses for GROUP/LIST and builds object FormGroups for the
 * object-typed editors (LINK/MEDIA/REFERENCE/RICHTEXT).
 */
export function buildEditorControl(
  editor: EditorDefinition,
  seed: unknown,
): AbstractControl {
  switch (editor.type) {
    case 'GROUP':
      return buildRowGroup(editor.items ?? [], seed, editor.readOnly);
    case 'LIST':
      return buildFormArray(editor, seed);
    case 'LINK':
      return buildObjectGroup(editor, seed, LINK_FIELDS);
    case 'MEDIA':
      return buildObjectGroup(editor, seed, MEDIA_FIELDS);
    case 'REFERENCE':
      return buildObjectGroup(editor, seed, REFERENCE_FIELDS);
    case 'RICHTEXT':
      return buildRichTextGroup(editor, seed);
    default:
      return buildScalarControl(editor, seed);
  }
}

function buildScalarControl(editor: EditorDefinition, seed: unknown): FormControl {
  const validators: ValidatorFn[] = [];
  if (editor.required) {
    validators.push(Validators.required);
  }
  if (editor.maxLength != null) {
    validators.push(Validators.maxLength(editor.maxLength));
  }
  if (editor.pattern) {
    validators.push(Validators.pattern(editor.pattern));
  }
  if (editor.type === 'NUMBER') {
    if (editor.min != null) {
      validators.push(Validators.min(editor.min));
    }
    if (editor.max != null) {
      validators.push(Validators.max(editor.max));
    }
  }
  if (editor.type === 'JSON') {
    validators.push(sfJson());
  }
  const control = new FormControl(seedFor(editor, seed), validators);
  if (editor.readOnly) {
    control.disable({ emitEvent: false });
  }
  return control;
}

/**
 * Builds a FormGroup from a set of item editors (used for GROUP editors and
 * for each LIST row — item editors open their own namespace).
 */
export function buildRowGroup(
  items: EditorDefinition[],
  seed?: unknown,
  readOnly = false,
): FormGroup {
  const seedObj =
    seed && typeof seed === 'object' && !Array.isArray(seed)
      ? (seed as Record<string, unknown>)
      : {};
  const group = new FormGroup({});
  for (const item of items) {
    group.addControl(
      item.name,
      buildEditorControl(item, seedObj[item.name] ?? item.defaultValue ?? null),
    );
  }
  if (readOnly) {
    group.disable({ emitEvent: false });
  }
  return group;
}

function buildFormArray(editor: EditorDefinition, seed: unknown): FormArray {
  const validators: ValidatorFn[] = [];
  if (editor.min != null || editor.max != null) {
    validators.push(sfListLength(editor.min, editor.max));
  }
  const array = new FormArray<any>([], validators);
  if (Array.isArray(seed)) {
    for (const rowSeed of seed) {
      array.push(buildRowGroup(editor.items ?? [], rowSeed));
    }
  }
  if (editor.readOnly) {
    array.disable({ emitEvent: false });
  }
  return array;
}

function buildObjectGroup(
  editor: EditorDefinition,
  seed: unknown,
  fields: Record<string, unknown>,
): FormGroup {
  const seedObj =
    seed && typeof seed === 'object' && !Array.isArray(seed)
      ? (seed as Record<string, unknown>)
      : {};
  const group = new FormGroup({});
  for (const key of Object.keys(fields)) {
    group.addControl(
      key,
      new FormControl(seedObj[key] ?? fields[key]),
    );
  }
  if (editor.readOnly) {
    group.disable({ emitEvent: false });
  }
  return group;
}

function buildRichTextGroup(editor: EditorDefinition, seed: unknown): FormGroup {
  const seedObj =
    seed && typeof seed === 'object' && !Array.isArray(seed)
      ? (seed as Record<string, unknown>)
      : {};
  const valueControl = new FormControl(
    seedObj['value'] ?? '',
    editor.maxChars != null ? sfMaxChars(editor.maxChars) : null,
  );
  const group = new FormGroup({
    format: new FormControl(seedObj['format'] ?? 'html'),
    value: valueControl,
  });
  if (editor.readOnly) {
    group.disable({ emitEvent: false });
  }
  return group;
}

/** Reconstructs the raw content value for a single editor from its control. */
export function editorRawValue(
  editor: EditorDefinition,
  control: AbstractControl,
): unknown {
  switch (editor.type) {
    case 'LIST': {
      const array = control as FormArray;
      return array.controls.map((row) =>
        rawGroupValue(editor.items ?? [], row as FormGroup),
      );
    }
    case 'GROUP':
      return rawGroupValue(editor.items ?? [], control as FormGroup);
    case 'LINK':
    case 'MEDIA':
    case 'REFERENCE':
    case 'RICHTEXT':
      return (control as FormGroup).getRawValue();
    default:
      return control.value;
  }
}

function rawGroupValue(
  items: EditorDefinition[],
  group: FormGroup,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    const control = group.get(item.name);
    if (control) {
      out[item.name] = editorRawValue(item, control);
    }
  }
  return out;
}

/**
 * Builds a typed `FormGroup` for a {@link ContentDefinition}, seeding every
 * control from the persisted value (or the configured `defaultValue`), and
 * wiring all client-side validation.
 */
@Injectable({ providedIn: 'root' })
export class FormBuilderService {
  private lastForm: FormGroup | null = null;

  build(
    definition: ContentDefinition,
    value: Record<string, unknown> | null | undefined,
  ): FormGroup {
    const form = new FormGroup({});
    for (const editor of definition.editors ?? []) {
      form.addControl(
        editor.name,
        buildEditorControl(editor, value?.[editor.name] ?? editor.defaultValue ?? null),
      );
    }
    this.lastForm = form;
    return form;
  }

  /**
   * Reconstructs the raw content object from the form so callers can produce
   * the payload to persist. Uses the most recent form from {@link build} unless
   * one is passed explicitly.
   */
  valueOf(
    definition: ContentDefinition,
    form?: FormGroup,
  ): Record<string, unknown> {
    const group = form ?? this.lastForm;
    const out: Record<string, unknown> = {};
    if (!group) {
      return out;
    }
    for (const editor of definition.editors ?? []) {
      const control = group.get(editor.name);
      if (control) {
        out[editor.name] = editorRawValue(editor, control);
      }
    }
    return out;
  }
}
