import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-date-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './date-editor.component.html',
})
export class SfDateEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();
}
