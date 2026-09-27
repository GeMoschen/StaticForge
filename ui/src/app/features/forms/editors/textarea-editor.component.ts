import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';
import { errorMessageFor } from '../form-builder.service';
import { controlChanges } from '../control-changes';

@Component({
  selector: 'sf-textarea-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './textarea-editor.component.html',
  styleUrl: './textarea-editor.component.scss',
})
export class SfTextareaEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  /** Re-runs the computeds below when the control changes (a form control is not a signal). */
  private readonly changes = controlChanges(() => this.control());

  readonly message = computed(() => {
    this.changes();
    return errorMessageFor(this.definition(), this.control());
  });
}
