import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogRef, injectDialogData } from '../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { injectSampleText } from './changes/sample-area.util';

export interface SampleContentRenameData {
  /** The folder's or record set's name and UID. */
  readonly name: string;
  readonly uid: string;
  /** Developer mode adds the UID section. */
  readonly developer: boolean;
}

/** What the dialog closes with: the new name, or (developer mode, on its own) the new UID. */
export interface SampleContentRenameResult {
  readonly name?: string;
  readonly uid?: string;
}

/**
 * The Rename dialog of a record set or folder (M35.20, gate round 11; the app's `sf-rename-asset-dialog`): a **Name**
 * field with **Save**, and — in developer mode only — a **UID** section with its own **Change UID** that works apart
 * from the name (decision 107). Both are disabled until something changed; a blank name is refused. Enter saves the
 * name; Escape, × and Close leave without a result.
 */
@Component({
  selector: 'sf-sample-content-rename-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-content-rename-dialog.component.html',
  styleUrl: './sample-content-rename-dialog.component.scss',
})
export class SampleContentRenameDialogComponent {
  protected readonly data = injectDialogData<SampleContentRenameData>();
  private readonly ref = inject<SfDialogRef<SampleContentRenameResult>>(SfDialogRef);
  protected readonly t = injectSampleText('styleguide.sample.contentRename');

  protected readonly name = signal(this.data.name);
  protected readonly uid = signal(this.data.uid);
  private readonly touched = signal(false);

  private readonly trimmedName = computed(() => this.name().trim());
  protected readonly nameError = computed(() => (this.touched() && this.trimmedName() === '' ? this.t('nameRequired') : null));
  protected readonly nameValid = computed(() => this.trimmedName() !== '' && this.trimmedName() !== this.data.name);
  protected readonly uidValid = computed(() => /^[a-z][a-z0-9_]*$/.test(this.uid()) && this.uid() !== this.data.uid);
  protected readonly uidError = computed(() =>
    this.uid() !== this.data.uid && !/^[a-z][a-z0-9_]*$/.test(this.uid()) ? this.t('uidInvalid') : null,
  );

  protected setName(value: string): void {
    this.touched.set(true);
    this.name.set(value);
  }

  protected saveName(): void {
    if (this.nameValid()) {
      this.ref.close({ name: this.trimmedName() });
    }
  }

  protected changeUid(): void {
    if (this.uidValid()) {
      this.ref.close({ uid: this.uid() });
    }
  }

  protected close(): void {
    this.ref.close();
  }
}
