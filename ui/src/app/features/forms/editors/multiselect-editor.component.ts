import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-multiselect-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './multiselect-editor.component.html',
  styleUrl: './multiselect-editor.component.scss',
})
export class SfMultiselectEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  isChecked(value: string): boolean {
    const current = Array.isArray(this.control().value) ? this.control().value : [];
    return current.includes(value);
  }

  toggle(value: string): void {
    const current = Array.isArray(this.control().value)
      ? ([...this.control().value] as string[])
      : [];
    const index = current.indexOf(value);
    if (index >= 0) {
      current.splice(index, 1);
    } else {
      current.push(value);
    }
    this.control().setValue(current);
    this.control().markAsDirty();
  }
}
