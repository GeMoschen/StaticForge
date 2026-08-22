import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-select-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './select-editor.component.html',
  styleUrl: './select-editor.component.scss',
})
export class SfSelectEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  readonly useRadios = computed(() => (this.definition().options?.length ?? 0) <= 4);
}
