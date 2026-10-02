import { Directive, Signal, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { AbstractControl, FormControl } from '@angular/forms';
import type { SfFieldTag } from '../../shared/components/sf-field.component';
import type { SfFinding } from '../../shared/components/forms/sf-finding.component';
import { controlChanges } from './control-changes';
import { errorMessageFor } from './form-builder.service';
import type { EditorDefinition } from './form.model';

/**
 * What the form knows about one top-level editor besides its control (M35.17), handed to the editor so the field shows
 * it in place — the language chip on the label line, the rule and server findings under the control — instead of the form
 * drawing it around the editor.
 */
export interface EditorChrome {
  /** Badges right of the label: the language chip ("English" / "All languages"), a "Computed" cue. */
  readonly tags: readonly SfFieldTag[];
  /** The findings of the rules and the server for this field, at the four levels. */
  readonly findings: readonly SfFinding[];
  /** A rule (`requiredWhen`) makes the field required. */
  readonly required: boolean;
}

/** Whether a control's value counts as "nothing entered" (for the one required error). */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

/**
 * The base of every editor component (M35.17): the `definition`, the `control` and the form's `chrome`, plus what the
 * editor's `sf-field` needs from them — the required marker, the "empty" flag that makes the field say "This field is
 * required" **once**, the label tags and the findings (the form's rule and server findings, then the control's own
 * validation message). Bind them on the editor's field:
 *
 * ```html
 * <sf-field [label]="definition().label" [hint]="definition().help" [required]="fieldRequired()"
 *           [empty]="fieldEmpty()" [tags]="fieldTags()" [findings]="fieldFindings()">
 * ```
 *
 * An editor whose "empty" differs from the control value being blank (a list without rows) overrides {@link isEmpty}.
 */
@Directive()
export abstract class SfEditorBase<C extends AbstractControl = FormControl> {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<C>();
  /** What the form shows for this field; `null` where an editor is used outside a form (a nested editor). */
  readonly chrome = input<EditorChrome | null>(null);

  /** Re-runs the computeds below when the control changes (a form control is not a signal). */
  protected readonly changes: Signal<number> = controlChanges(() => this.control());
  protected readonly transloco = inject(TranslocoService);
  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly fieldRequired = computed(() => !!this.definition().required || !!this.chrome()?.required);
  readonly fieldTags = computed<readonly SfFieldTag[]>(() => this.chrome()?.tags ?? []);
  readonly fieldEmpty = computed(() => {
    this.changes();
    return this.isEmpty(this.control().value);
  });
  /** The control's own validation message (length, pattern, range …) as an error finding; "required" is the field's. */
  protected readonly ownFinding = computed<SfFinding | null>(() => {
    this.changes();
    const errors = this.control().errors;
    if (!errors || errors['required']) {
      return null;
    }
    this.language();
    const message = errorMessageFor(this.definition(), this.control(), (key, params) => this.transloco.translate(key, params));
    return message ? { level: 'error', message } : null;
  });
  readonly fieldFindings = computed<readonly SfFinding[]>(() => {
    const own = this.ownFinding();
    return own ? [...(this.chrome()?.findings ?? []), own] : (this.chrome()?.findings ?? []);
  });

  protected isEmpty(value: unknown): boolean {
    return isEmptyValue(value);
  }
}
