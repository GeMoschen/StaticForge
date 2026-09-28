import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { AssetPicked, SfAssetPickerDialogComponent } from '../../../shared/components/sf-asset-picker-dialog.component';
import { SfDropTargetDirective } from '../../../shared/directives/sf-drop-target.directive';
import { EditorDefinition } from '../form.model';

@Component({
  selector: 'sf-media-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent, SfDropTargetDirective, SfAssetPickerDialogComponent],
  templateUrl: './media-editor.component.html',
  styleUrl: './media-editor.component.scss',
})
export class SfMediaEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();
  readonly projectKey = input<string>();

  /** The shared asset picker, limited to media. */
  protected readonly pickerOpen = signal(false);

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  onDrop(event: DragEvent): void {
    const data =
      event.dataTransfer?.getData('application/json') ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!data) {
      return;
    }
    try {
      const parsed = JSON.parse(data) as { uuid?: string };
      if (parsed.uuid) {
        this.select(parsed.uuid);
      }
    } catch {
      this.select(data);
    }
  }

  choose(): void {
    if (this.projectKey() && !this.definition().readOnly) {
      this.pickerOpen.set(true);
    }
  }

  protected onPicked(picked: AssetPicked): void {
    this.select(picked.uuid);
    this.pickerOpen.set(false);
  }

  select(uuid: string): void {
    this.field('uuid').setValue(uuid);
    this.field('uuid').markAsDirty();
  }
}
