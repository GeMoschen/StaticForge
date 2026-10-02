import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfColorInputComponent } from '../../../shared/components/forms/sf-color-input.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The COLOR editor (M35.17): an `sf-color-input` (swatch + hex) in an `sf-field`. */
@Component({
  selector: 'sf-color-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfColorInputComponent, SfFieldComponent],
  templateUrl: './color-editor.component.html',
})
export class SfColorEditor extends SfEditorBase<FormControl> {}
