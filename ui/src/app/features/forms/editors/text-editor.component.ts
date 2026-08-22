import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';
import { errorMessageFor } from '../form-builder.service';

@Component({
  selector: 'sf-text-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './text-editor.component.html',
  styleUrl: './text-editor.component.scss',
})
export class SfTextEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  readonly count = computed(() => String(this.control().value ?? '').length);
  readonly message = computed(() => errorMessageFor(this.definition(), this.control()));
}
