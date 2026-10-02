import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The DATETIME editor (M35.17): an `sf-date-input` in an `sf-field`; the value keeps the API's format. */
@Component({
  selector: 'sf-datetime-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfDateInputComponent, SfFieldComponent],
  templateUrl: './datetime-editor.component.html',
})
export class SfDatetimeEditor extends SfEditorBase<FormControl> {}
