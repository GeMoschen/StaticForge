import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';
import { FormControl, ValidationErrors } from '@angular/forms';
import { SfCodeEditorComponent } from '../../../shared/code-editor/code-editor.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-json-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfFieldComponent, SfCodeEditorComponent],
  templateUrl: './json-editor.component.html',
  styleUrl: './json-editor.component.scss',
})
export class SfJsonEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormControl>();

  /** The control's text, kept in step with changes from outside (a rebuilt form, a live fill). */
  protected readonly text = signal('');
  /** Read-only by definition, or disabled by a rule (M33). */
  protected readonly readOnly = signal(false);
  private readonly errors = signal<ValidationErrors | null>(null);

  readonly message = computed(() => {
    const errors = this.errors();
    if (errors?.['json']) {
      return 'Must be valid JSON';
    }
    if (errors?.['required']) {
      return 'This field is required';
    }
    return null;
  });

  constructor() {
    effect((onCleanup) => {
      const control = this.control();
      const readOnlyDefinition = !!this.definition().readOnly;
      const sync = () =>
        untracked(() => {
          this.text.set(control.value == null ? '' : String(control.value));
          this.readOnly.set(readOnlyDefinition || control.disabled);
          this.errors.set(control.errors);
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
