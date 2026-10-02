import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';
import { SfEditorCountComponent } from './editor-count.component';

/** The TEXT editor (M35.17): one `sf-input` in an `sf-field`, with the length counter when the editor has a limit. */
@Component({
  selector: 'sf-text-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfEditorCountComponent, SfFieldComponent, SfInputComponent],
  templateUrl: './text-editor.component.html',
})
export class SfTextEditor extends SfEditorBase<FormControl> {
  readonly count = computed(() => {
    this.changes();
    return String(this.control().value ?? '').length;
  });
}
