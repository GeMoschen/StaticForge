import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';
import { errorMessageFor } from '../form-builder.service';

@Component({
  selector: 'sf-number-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './number-editor.component.html',
  styleUrl: './number-editor.component.scss',
})
export class SfNumberEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  readonly message = computed(() => errorMessageFor(this.definition(), this.control()));
}
