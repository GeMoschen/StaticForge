import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';
import { errorMessageFor } from '../form-builder.service';

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

  readonly message = computed(() => errorMessageFor(this.definition(), this.control()));
}
