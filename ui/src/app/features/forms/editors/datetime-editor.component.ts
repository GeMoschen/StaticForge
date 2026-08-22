import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-datetime-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './datetime-editor.component.html',
})
export class SfDatetimeEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();
}
