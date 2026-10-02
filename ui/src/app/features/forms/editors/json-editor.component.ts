import { ChangeDetectionStrategy, Component, effect, signal, untracked } from '@angular/core';
import { FormControl } from '@angular/forms';
import { SfCodeEditorComponent } from '../../../shared/code-editor/code-editor.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/** The JSON editor (M35.17): the code panel in an `sf-field`; "Must be valid JSON" is the field's own finding. */
@Component({
  selector: 'sf-json-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfFieldComponent, SfCodeEditorComponent],
  templateUrl: './json-editor.component.html',
  styleUrl: './json-editor.component.scss',
})
export class SfJsonEditor extends SfEditorBase<FormControl> {
  /** The control's text, kept in step with changes from outside (a rebuilt form, a live fill). */
  protected readonly text = signal('');
  /** Read-only by definition, or disabled by a rule (M33). */
  protected readonly readOnly = signal(false);

  constructor() {
    super();
    effect((onCleanup) => {
      const control = this.control();
      const readOnlyDefinition = !!this.definition().readOnly;
      const sync = () =>
        untracked(() => {
          this.text.set(control.value == null ? '' : String(control.value));
          this.readOnly.set(readOnlyDefinition || control.disabled);
        });
      sync();
      const values = control.valueChanges.subscribe(sync);
      const status = control.statusChanges.subscribe(sync);
      onCleanup(() => {
        values.unsubscribe();
        status.unsubscribe();
      });
    });
  }

  /** An edit in the code editor (M33: JSON highlighting, bracket matching, folding). */
  protected onInput(text: string): void {
    const control = this.control();
    if (control.value === text) {
      return;
    }
    control.setValue(text);
    control.markAsDirty();
  }
}
