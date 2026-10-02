import { Injectable } from '@angular/core';
import { EditingLocale, valueFor, withValue } from './l10n.util';
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

/** Translates a message key with parameters (Transloco's `translate`, or {@link englishMessage} without one). */
export type MessageTranslator = (key: string, params?: Record<string, unknown>) => string;

/** The English texts of the validation messages (M35.17), used where no Transloco is at hand. Same keys as `en.json`. */
const ENGLISH_MESSAGES: Readonly<Record<string, string>> = {
  'forms.editors.errors.required': 'This field is required',
  'forms.editors.errors.maxlength': 'Must be at most {max} characters',
  'forms.editors.errors.pattern': 'Invalid format',
  'forms.editors.errors.maxchars': 'Must be at most {max} characters',
  'forms.editors.errors.min': 'Must be at least {min}',
  'forms.editors.errors.max': 'Must be at most {max}',
  'forms.editors.errors.listmin': 'At least {required} rows required',
  'forms.editors.errors.listmax': 'At most {required} rows allowed',
  'forms.editors.errors.json': 'Must be valid JSON',
  'forms.editors.errors.invalid': 'Invalid value',
};

/** The English message for `key`, its `{name}` placeholders filled from `params`. */
export function englishMessage(key: string, params: Record<string, unknown> = {}): string {
  return (ENGLISH_MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

/**
 * Returns a user-facing validation message for a control (M35.17: the texts live in `forms.editors.errors.*`; pass
 * Transloco's `translate`, or leave it out for the English default). The required message is the field's own
 * ("This field is required", shown once by `sf-field`), so editors built on `SfEditorBase` do not ask for it here.
 */
export function errorMessageFor(
  definition: EditorDefinition,
  control: AbstractControl,
  translate: MessageTranslator = englishMessage,
): string | null {
  const errors = control?.errors;
  if (!errors) {
    return null;
  }
  const t = (key: string, params?: Record<string, unknown>) => translate(`forms.editors.errors.${key}`, params);
  if (errors['required']) {
    return t('required');
  }
  if (errors['json']) {
    return t('json');
  }
  if (errors['maxlength']) {
    return t('maxlength', { max: errors['maxlength'].requiredLength });
  }
  if (errors['pattern']) {
    return definition.patternMessage ?? t('pattern');
  }
  if (errors['maxchars']) {
    return t('maxchars', { max: errors['maxchars'].max });
  }
  if (errors['min']) {
    return t('min', { min: errors['min'].min });
  }
  if (errors['max']) {
    return t('max', { max: errors['max'].max });
  }
  if (errors['listMin']) {
    return t('listmin', { required: errors['listMin'].required });
  }
  if (errors['listMax']) {
    return t('listmax', { required: errors['listMax'].required });
  }
  return t('invalid');
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
  l10n?: EditingLocale | null,
): AbstractControl {
  switch (editor.type) {
    case 'GROUP':
      return buildRowGroup(editor.items ?? [], seed, editor.readOnly, l10n);
    case 'LIST':
      return buildFormArray(editor, seed, l10n);
    case 'LINK':
      return buildObjectGroup(editor, seed, LINK_FIELDS);
    case 'MEDIA':
      return buildObjectGroup(editor, seed, MEDIA_FIELDS);
    case 'REFERENCE':
      return buildObjectGroup(editor, seed, REFERENCE_FIELDS);
    case 'RICHTEXT':
      return buildRichTextGroup(editor, seed);
    case 'CATALOG':
      // A single FormControl holding the plain `{type:'CATALOG', cards}` value — card
      // sub-schemas are dynamic (each comes from a different section template fetched by
      // UUID), unlike LIST's statically-known `item` schema, so they can't be modeled as typed
      // sub-controls here. `SfCatalogEditor` manages its own internal per-card forms and pushes
      // the consolidated value back via `control.setValue(...)`.
      return buildScalarControl(editor, seed);
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
  l10n?: EditingLocale | null,
): FormGroup {
  const seedObj =
    seed && typeof seed === 'object' && !Array.isArray(seed)
      ? (seed as Record<string, unknown>)
      : {};
  const group = new FormGroup({});
  for (const item of items) {
    group.addControl(item.name, buildEditorControl(item, childSeed(item, seedObj, l10n), l10n));
  }
  if (readOnly) {
    group.disable({ emitEvent: false });
  }
  return group;
}

/**
 * The seed for one editor inside a content object. A GROUP is a transparent display wrapper
 * (docs/editors/group.md): its children live at the same level as the group itself, so the
 * group is seeded with the enclosing object. Values that older UI builds nested under the
 * synthetic `_group_N` key are still read as a fallback; the next save flattens them.
 */
function childSeed(
  editor: EditorDefinition,
  parent: Record<string, unknown>,
  l10n?: EditingLocale | null,
): unknown {
  if (editor.type === 'GROUP') {
    const legacy = parent[editor.name];
    return legacy && typeof legacy === 'object' && !Array.isArray(legacy)
      ? { ...(legacy as Record<string, unknown>), ...parent }
      : parent;
  }
  const stored = parent[editor.name];
  if (l10n && editor.localizable) {
    // Seed with *this* language only: an untranslated field must look empty, so the editor can
    // show the fallback as a placeholder instead of pretending it is already translated (M24.4.1).
    const own = valueFor(stored, l10n.locale);
    return own ?? editor.defaultValue ?? null;
  }
  return stored ?? editor.defaultValue ?? null;
}

/** Writes one editor's raw value into a content object, flattening transparent GROUPs. */
function writeRawValue(
  out: Record<string, unknown>,
  editor: EditorDefinition,
  control: AbstractControl,
  l10n?: EditingLocale | null,
  base?: Record<string, unknown>,
): void {
  const raw = editorRawValue(editor, control, l10n, base);
  if (editor.type === 'GROUP') {
    Object.assign(out, raw as Record<string, unknown>);
  } else if (l10n && editor.localizable) {
    // Write this language into the value that is already stored, so the translations the editor
    // is not looking at survive the save untouched (M24.4.1).
    out[editor.name] = withValue(base?.[editor.name], l10n.locale, raw);
  } else {
    out[editor.name] = raw;
  }
}

function buildFormArray(editor: EditorDefinition, seed: unknown, l10n?: EditingLocale | null): FormArray {
  const validators: ValidatorFn[] = [];
  if (editor.min != null || editor.max != null) {
    validators.push(sfListLength(editor.min, editor.max));
  }
  const array = new FormArray<any>([], validators);
  if (Array.isArray(seed)) {
    for (const rowSeed of seed) {
      array.push(buildRowGroup(editor.items ?? [], rowSeed, false, l10n));
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
  l10n?: EditingLocale | null,
  base?: Record<string, unknown>,
): unknown {
  switch (editor.type) {
    case 'LIST': {
      const array = control as FormArray;
      const storedRows = Array.isArray(base?.[editor.name]) ? (base?.[editor.name] as unknown[]) : [];
      return array.controls.map((row, index) =>
        rawGroupValue(editor.items ?? [], row as FormGroup, l10n, asObject(storedRows[index])),
      );
    }
    case 'GROUP':
      return rawGroupValue(editor.items ?? [], control as FormGroup, l10n, base);
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
  l10n?: EditingLocale | null,
  base?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    const control = group.get(item.name);
    if (control) {
      writeRawValue(out, item, control, l10n, base);
    }
  }
  return out;
}

/** A stored sub-object, or an empty one — the base a language write-back merges into. */
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Builds a typed `FormGroup` for a {@link ContentDefinition}, seeding every
 * control from the persisted value (or the configured `defaultValue`), and
 * wiring all client-side validation.
 */
@Injectable({ providedIn: 'root' })
export class FormBuilderService {
  private lastForm: FormGroup | null = null;

  /**
   * What each built form was built from: the stored content object and the language being edited.
   * {@link valueOf} needs both to merge one language back without dropping the others, and a
   * `WeakMap` keeps that association without changing any caller's signature.
   */
  private readonly context = new WeakMap<
    FormGroup,
    { value: Record<string, unknown>; l10n: EditingLocale | null }
  >();

  build(
    definition: ContentDefinition,
    value: Record<string, unknown> | null | undefined,
    l10n?: EditingLocale | null,
  ): FormGroup {
    const form = new FormGroup({});
    const stored = value ?? {};
    for (const editor of definition.editors ?? []) {
      form.addControl(editor.name, buildEditorControl(editor, childSeed(editor, stored, l10n), l10n));
    }
    this.lastForm = form;
    this.context.set(form, { value: stored, l10n: l10n ?? null });
    return form;
  }

  /** The language a form is currently bound to, or `null` when it was built without languages. */
  bindingOf(form: FormGroup): EditingLocale | null {
    return this.context.get(form)?.l10n ?? null;
  }

  /**
   * Rebuilds `form` for another editing language (M24.4.1).
   *
   * <p>The editing language is baked into every control when the form is built — each localizable
   * editor holds *that* language's value — so a form left in place after the language changed
   * edits the language it was built for, and the next save writes those words into the language
   * now selected. Switching therefore has to rebuild, and rebuilding has to start from
   * {@link valueOf}, which folds the visible language back into the stored object: that keeps
   * unsaved edits in the language being left behind, and the other languages untouched.
   *
   * @returns the new form, and the content object it was seeded from (every language).
   */
  rebind(
    definition: ContentDefinition,
    form: FormGroup,
    l10n: EditingLocale | null,
  ): { form: FormGroup; content: Record<string, unknown> } {
    const content = { ...(this.context.get(form)?.value ?? {}), ...this.valueOf(definition, form) };
    return { form: this.build(definition, content, l10n), content };
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
    const context = this.context.get(group);
    for (const editor of definition.editors ?? []) {
      const control = group.get(editor.name);
      if (control) {
        writeRawValue(out, editor, control, context?.l10n, context?.value);
      }
    }
    return out;
  }
}
