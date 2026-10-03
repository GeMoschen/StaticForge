import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogRef, injectDialogData } from '../../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { injectSampleText } from '../changes/sample-area.util';
import { fileExtension } from './sample-media-data';

export interface SampleRenameDialogData {
  /** The file's current name. */
  readonly name: string;
  /** The folder's name, for the "already exists" message. */
  readonly folder: string;
  /** The other files' names in the folder, lower case. */
  readonly taken: readonly string[];
}

/** Characters a file name can't have (they would break links or file systems). */
const INVALID_CHARACTERS = /[\\/:*?"<>|]/;
const MAX_LENGTH = 100;

/**
 * The Rename dialog of a media file (decision 93): one name field, checked as you type — required, no `/ \ : * ? " < > |`,
 * at most 100 characters, the same extension (the file type stays), not a name that is taken in the folder. An error
 * shows as soon as the name differs from the current one. **Apply** is disabled until the name is valid and changed;
 * Enter applies. Closes with the new name; Escape, × and Cancel close without one.
 */
@Component({
  selector: 'sf-sample-media-rename-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-rename-dialog.component.html',
})
export class SampleMediaRenameDialogComponent {
  protected readonly data = injectDialogData<SampleRenameDialogData>();
  private readonly ref = inject<SfDialogRef<string>>(SfDialogRef);
  protected readonly t = injectSampleText('styleguide.sample.media');

  protected readonly value = signal(this.data.name);
  private readonly trimmed = computed(() => this.value().trim());
  protected readonly changed = computed(() => this.trimmed() !== this.data.name);

  /** Why the name is wrong; `null` while it is unchanged or fine. */
  protected readonly error = computed<string | null>(() => {
    const name = this.trimmed();
    if (!this.changed()) {
      return null;
    }
    if (name === '') {
      return this.t('rename.required');
    }
    if (INVALID_CHARACTERS.test(name)) {
      return this.t('rename.characters');
    }
    if (name.length > MAX_LENGTH) {
      return this.t('rename.tooLong', { max: MAX_LENGTH });
    }
    if (fileExtension(name) !== fileExtension(this.data.name)) {
      return this.t('rename.extension', { extension: fileExtension(this.data.name) });
    }
    if (this.data.taken.includes(name.toLowerCase())) {
      return this.t('rename.taken', { name, folder: this.data.folder });
    }
    return null;
  });
  protected readonly valid = computed(() => this.changed() && this.error() === null);

  protected apply(): void {
    if (this.valid()) {
      this.ref.close(this.trimmed());
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
