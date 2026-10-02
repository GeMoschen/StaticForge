import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';
import { SfEditorCountComponent } from './editor-count.component';

/** The TEXTAREA editor (M35.17): an `sf-textarea` in an `sf-field`, with the length counter when the editor has a limit. */
@Component({
  selector: 'sf-textarea-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfEditorCountComponent, SfFieldComponent, SfTextareaComponent],
  templateUrl: './textarea-editor.component.html',
})
export class SfTextareaEditor extends SfEditorBase<FormControl> {
  readonly count = computed(() => {
    this.changes();
    return String(this.control().value ?? '').length;
  });
}
