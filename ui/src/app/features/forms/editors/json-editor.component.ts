import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-json-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './json-editor.component.html',
  styleUrl: './json-editor.component.scss',
})
export class SfJsonEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  readonly message = computed(() => {
    const errors = this.control().errors;
    if (errors?.['json']) {
      return 'Must be valid JSON';
    }
    if (errors?.['required']) {
      return 'This field is required';
    }
    return null;
  });
}
