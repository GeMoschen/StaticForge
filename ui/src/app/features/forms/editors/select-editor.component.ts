import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfRadioGroupComponent } from '../../../shared/components/forms/sf-radio-group.component';
import { SfSelectComponent } from '../../../shared/components/forms/sf-select.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The SELECT editor (M35.17): up to four options as a radio group, more as an `sf-select`, in an `sf-field`. */
@Component({
  selector: 'sf-select-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfRadioGroupComponent, SfSelectComponent, TranslocoPipe],
  templateUrl: './select-editor.component.html',
})
export class SfSelectEditor extends SfEditorBase<FormControl> {
  readonly useRadios = computed(() => (this.definition().options?.length ?? 0) <= 4);
  readonly options = computed(() => this.definition().options ?? []);
}
