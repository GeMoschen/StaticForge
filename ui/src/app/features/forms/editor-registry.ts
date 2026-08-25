import { Type } from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { EditorDefinition, EditorType } from './form.model';
import { SfTextEditor } from './editors/text-editor.component';
import { SfTextareaEditor } from './editors/textarea-editor.component';
import { SfNumberEditor } from './editors/number-editor.component';
import { SfBooleanEditor } from './editors/boolean-editor.component';
import { SfDateEditor } from './editors/date-editor.component';
import { SfDatetimeEditor } from './editors/datetime-editor.component';
import { SfSelectEditor } from './editors/select-editor.component';
import { SfMultiselectEditor } from './editors/multiselect-editor.component';
import { SfColorEditor } from './editors/color-editor.component';
import { SfLinkEditor } from './editors/link-editor.component';
import { SfRichTextEditor } from './editors/rich-text-editor.component';
import { SfMarkdownEditor } from './editors/markdown-editor.component';
import { SfJsonEditor } from './editors/json-editor.component';
import { SfMediaEditor } from './editors/media-editor.component';
import { SfReferenceEditor } from './editors/reference-editor.component';
import { SfListEditor } from './editors/list-editor.component';
import { SfGroupEditor } from './editors/group-editor.component';
import { SfCatalogEditor } from './editors/catalog-editor.component';

/**
 * The contract every editor component exposes. Editors declare these as
 * signal `input()`s (`definition` and `control`), so a component class that
 * declares `definition: InputSignal<EditorDefinition>` is structurally
 * compatible with this shape at the `ngComponentOutlet` boundary.
 */
export interface EditorComponent {
  definition: EditorDefinition;
  control: FormControl | FormGroup | FormArray;
}

/** Maps every {@link EditorType} to its editor component type. */
export const EDITOR_REGISTRY: Map<EditorType, Type<unknown>> = new Map<
  EditorType,
  Type<unknown>
>([
  ['TEXT', SfTextEditor],
  ['TEXTAREA', SfTextareaEditor],
  ['RICHTEXT', SfRichTextEditor],
  ['MARKDOWN', SfMarkdownEditor],
  ['NUMBER', SfNumberEditor],
  ['BOOLEAN', SfBooleanEditor],
  ['DATE', SfDateEditor],
  ['DATETIME', SfDatetimeEditor],
  ['SELECT', SfSelectEditor],
  ['MULTISELECT', SfMultiselectEditor],
  ['COLOR', SfColorEditor],
  ['LINK', SfLinkEditor],
  ['MEDIA', SfMediaEditor],
  ['REFERENCE', SfReferenceEditor],
  ['LIST', SfListEditor],
  ['GROUP', SfGroupEditor],
  ['JSON', SfJsonEditor],
  ['CATALOG', SfCatalogEditor],
]);

/** Provider list for a hosting route — add these to the route's `imports`. */
export function provideSfFormEngine(): Type<unknown>[] {
  return Array.from(EDITOR_REGISTRY.values());
}
