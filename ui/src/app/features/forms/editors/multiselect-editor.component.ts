import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfComboboxComponent } from '../../../shared/components/forms/sf-combobox.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The MULTISELECT editor (M35.17): a multiple `sf-combobox` (chips, type to filter) in an `sf-field`. */
@Component({
  selector: 'sf-multiselect-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfComboboxComponent, SfFieldComponent, TranslocoPipe],
  templateUrl: './multiselect-editor.component.html',
})
export class SfMultiselectEditor extends SfEditorBase<FormControl> {
  readonly options = computed(() => this.definition().options ?? []);
}
