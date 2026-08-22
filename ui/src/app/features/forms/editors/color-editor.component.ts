import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

const PALETTE = [
  '#101418',
  '#5A6472',
  '#DFE3E8',
  '#FFFFFF',
  '#2B44E8',
  '#6E82FF',
  '#C77A0A',
  '#E0A040',
  '#0E7A5F',
  '#35A585',
  '#B3261E',
  '#E5675E',
];

@Component({
  selector: 'sf-color-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './color-editor.component.html',
  styleUrl: './color-editor.component.scss',
})
export class SfColorEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  readonly palette = PALETTE;

  isActive(color: string): boolean {
    return color === this.control().value;
  }

  pick(color: string): void {
    this.control().setValue(color);
    this.control().markAsDirty();
  }

  pickFrom(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pick(input.value);
  }
}
