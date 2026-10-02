import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The BOOLEAN editor (M35.17): an `sf-switch` in an `sf-field`. Off is a value, so it is never "empty". */
@Component({
  selector: 'sf-boolean-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfSwitchComponent],
  templateUrl: './boolean-editor.component.html',
})
export class SfBooleanEditor extends SfEditorBase<FormControl> {
  protected override isEmpty(): boolean {
    return false;
  }
}
