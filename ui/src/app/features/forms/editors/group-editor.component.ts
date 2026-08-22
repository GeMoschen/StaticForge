import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, FormArray, FormControl, FormGroup } from '@angular/forms';
import { EditorDefinition } from '../form.model';
import { SfEditorOutlet } from '../editor-outlet.component';

@Component({
  selector: 'sf-group-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfEditorOutlet],
  templateUrl: './group-editor.component.html',
  styleUrl: './group-editor.component.scss',
})
export class SfGroupEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();

  controlFor(item: EditorDefinition): FormControl | FormGroup | FormArray {
    return this.control().get(item.name) as FormControl | FormGroup | FormArray;
  }
}
