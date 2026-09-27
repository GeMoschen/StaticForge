import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormArray, FormControl, FormGroup } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { EditorDefinition } from '../form.model';
import { buildRowGroup, errorMessageFor } from '../form-builder.service';
import { controlChanges } from '../control-changes';
import { SfEditorOutlet } from '../editor-outlet.component';

@Component({
  selector: 'sf-list-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent, SfIconComponent, SfEditorOutlet],
  templateUrl: './list-editor.component.html',
  styleUrl: './list-editor.component.scss',
})
export class SfListEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormArray>();

  /** Re-runs the computeds below when the control changes (a form control is not a signal). */
  private readonly changes = controlChanges(() => this.control());

  readonly message = computed(() => {
    this.changes();
    return errorMessageFor(this.definition(), this.control());
  });

  readonly canAdd = computed(() => {
    const max = this.definition().max;
    this.changes();
    return max == null || this.control().length < max;
  });

  readonly canRemove = computed(() => {
    const min = this.definition().min ?? 0;
    this.changes();
    return this.control().length > min;
  });

  rowControl(row: unknown, item: EditorDefinition): FormControl | FormGroup | FormArray {
    return (row as FormGroup).get(item.name) as FormControl | FormGroup | FormArray;
  }

  addRow(): void {
    this.control().push(buildRowGroup(this.definition().items ?? []));
  }

  removeRow(index: number): void {
    this.control().removeAt(index);
  }

  move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.control().length) {
      return;
    }
    const array = this.control();
    const control = array.controls[index];
    array.removeAt(index);
    array.insert(target, control);
  }
}
