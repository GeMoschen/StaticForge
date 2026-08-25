import {
  ChangeDetectionStrategy,
  Component,
  Type,
  computed,
  inject,
  input,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { EditorDefinition, EditorType } from './form.model';
import { EDITOR_REGISTRY } from './editor-registry';
import { ExpressionEvaluator } from './expression-evaluator';
import { SF_FORM_CONTEXT } from './form.context';

/** Editor types whose component declares a `projectKey` input (MEDIA/REFERENCE pickers). */
const PROJECT_KEY_EDITOR_TYPES = new Set<EditorType>(['MEDIA', 'REFERENCE', 'CATALOG']);

/**
 * Renders a single editor by resolving its component type from
 * {@link EDITOR_REGISTRY} and dynamically instantiating it with the
 * `definition`/`control` inputs. Skips `hidden` editors and evaluates
 * `visibleWhen` reactively against the shared form value.
 */
@Component({
  selector: 'sf-editor-outlet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet],
  templateUrl: './editor-outlet.component.html',
})
export class SfEditorOutlet {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl | FormGroup | FormArray>();

  private readonly context = inject(SF_FORM_CONTEXT, { optional: true });
  private readonly evaluator = new ExpressionEvaluator();

  readonly resolvedType = computed<Type<unknown> | null>(
    () => EDITOR_REGISTRY.get(this.definition().type) ?? null,
  );

  readonly inputs = computed<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {
      definition: this.definition(),
      control: this.control(),
    };
    if (PROJECT_KEY_EDITOR_TYPES.has(this.definition().type)) {
      base['projectKey'] = this.context?.projectKey();
    }
    return base;
  });

  readonly visible = computed(() => {
    const definition = this.definition();
    if (definition.hidden) {
      return false;
    }
    if (definition.visibleWhen && this.context) {
      return this.evaluator.evaluate(
        definition.visibleWhen,
        this.context.formValue(),
      );
    }
    return true;
  });
}
