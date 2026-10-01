import { InjectionToken, Signal } from '@angular/core';

/**
 * What an `sf-field` tells the control inside it (M35.6). A control that injects this renders `controlId` on its
 * focusable element (the field's `<label for>` points at it) — or, for a group control, labels its group with
 * `labelId` — and puts `describedBy` / `invalid` / `required` on it as `aria-describedby` / `aria-invalid` /
 * `aria-required`.
 */
export interface SfFieldContext {
  /** The id the control's focusable element must carry. */
  readonly controlId: string;
  /** The id of the field's label text (for `aria-labelledby` on group controls). */
  readonly labelId: string;
  /** The space-separated ids of the field's hint and error, `null` when it shows neither. */
  readonly describedBy: Signal<string | null>;
  readonly invalid: Signal<boolean>;
  readonly required: Signal<boolean>;
  /**
   * Called once by a control that wires itself. `group` controls (radio group, segmented control) are labelled by the
   * field label through `aria-labelledby`; the label then is no `<label for>`.
   */
  registerControl(kind: 'single' | 'group'): void;
}

export const SF_FIELD = new InjectionToken<SfFieldContext>('SF_FIELD');

let nextControlId = 0;

/** A document-unique id for a control or one of its parts. */
export function sfUniqueId(prefix: string): string {
  return `${prefix}-${nextControlId++}`;
}
