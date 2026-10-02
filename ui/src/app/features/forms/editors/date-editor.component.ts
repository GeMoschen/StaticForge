import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfDateInputComponent } from '../../../shared/components/forms/sf-date-input.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The DATE editor (M35.17): an `sf-date-input` in an `sf-field`; the value keeps the API's format. */
@Component({
  selector: 'sf-date-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfDateInputComponent, SfFieldComponent],
  templateUrl: './date-editor.component.html',
})
export class SfDateEditor extends SfEditorBase<FormControl> {}
