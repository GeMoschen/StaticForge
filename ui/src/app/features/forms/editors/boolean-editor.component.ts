import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-boolean-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './boolean-editor.component.html',
  styleUrl: './boolean-editor.component.scss',
})
export class SfBooleanEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();
}
