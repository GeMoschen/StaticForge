import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The NUMBER editor (M35.17): an `sf-number-input` (`min`/`max` of the definition) in an `sf-field`. */
@Component({
  selector: 'sf-number-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfNumberInputComponent],
  templateUrl: './number-editor.component.html',
})
export class SfNumberEditor extends SfEditorBase<FormControl> {}
