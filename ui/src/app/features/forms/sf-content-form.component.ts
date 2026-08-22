import {
  ChangeDetectionStrategy,
  Component,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { ContentDefinition, EditorDefinition } from './form.model';
import { SfEditorOutlet } from './editor-outlet.component';
import { SF_FORM_CONTEXT, SfFormContext } from './form.context';

/**
 * Host component of the CDL-driven dynamic form engine. Renders the top-level
 * editors (flattening GROUPs by delegating their items to {@link SfGroupEditor},
 * and expanding LIST rows inside {@link SfListEditor}) via {@link SfEditorOutlet}.
 *
 * Provides the shared {@link SF_FORM_CONTEXT} so nested editors can reactively
 * evaluate their own `visibleWhen` expressions and resolve the project key.
 */
@Component({
  selector: 'sf-content-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfEditorOutlet],
  providers: [
    {
      provide: SF_FORM_CONTEXT,
      useFactory: () => {
        const host = inject(forwardRef(() => SfContentFormComponent));
        return {
          formValue: host.formValue,
          projectKey: host.projectKey,
        } satisfies SfFormContext;
      },
    },
  ],
  templateUrl: './sf-content-form.component.html',
  styleUrl: './sf-content-form.component.scss',
})
export class SfContentFormComponent {
  readonly definition = input.required<ContentDefinition>();
  readonly formGroup = input.required<FormGroup>();
  readonly projectKey = input<string>();

  readonly formValue = signal<Record<string, unknown>>({});

  constructor() {
    effect(
      (onCleanup) => {
        const form = this.formGroup();
        const update = () => this.formValue.set(form.getRawValue() as Record<string, unknown>);
        update();
        const subscription = form.valueChanges.subscribe(update);
        onCleanup(() => subscription.unsubscribe());
      },
      { allowSignalWrites: true },
    );
  }

  controlFor(editor: EditorDefinition): FormControl | FormGroup | FormArray {
    return this.formGroup().get(editor.name) as FormControl | FormGroup | FormArray;
  }
}
