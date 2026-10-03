import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfDialogRef, injectDialogData } from '../../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { injectSampleDevMode, injectSampleText } from '../changes/sample-area.util';
import { fileExtension } from './sample-media-data';

export interface SampleRenameDialogData {
  /** A file (default) or a folder: a folder's name has no extension and is unique among its sibling folders. */
  readonly kind?: 'file' | 'folder';
  /** The item's current name. */
  readonly name: string;
  /** The folder's name, for the "already exists" message. */
  readonly folder: string;
  /** The other files' (a folder: the sibling folders') names, lower case. */
  readonly taken: readonly string[];
  /** The item's UID; the dialog's UID section (developer mode only) shows it. */
  readonly uid?: string;
}

/** What a UID can be: lower case letters, digits and underscores, starting with a letter. */
const UID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Characters a file name can't have (they would break links or file systems). */
const INVALID_CHARACTERS = /[\\/:*?"<>|]/;
const MAX_LENGTH = 100;

/**
 * The Rename dialog of a media file (decision 93): one name field, checked as you type — required, no `/ \ : * ? " < > |`,
 * at most 100 characters, the same extension (the file type stays), not a name that is taken in the folder. An error
 * shows as soon as the name differs from the current one. **Apply** is disabled until the name is valid and changed;
 * Enter applies. Closes with the new name; Escape, × and Cancel close without one.
 *
 * A folder (`kind: 'folder'`) has the same dialog without the extension rule: its name is required and free among its
 * siblings (gate round 12; opened by *Rename…* in the tree's menu and *Rename folder…* in the page header's ⋮; F2 in the tree
 * stays the quick inline edit). **In developer mode** the dialog also carries the item's **UID** (decision 107, a file's and a
 * folder's): it shows the UID with *Change UID…*, warns that links written with it break, and changes it **on its own** — with its
 * own button and an Undo toast — leaving the name's Apply alone.
 */
@Component({
  selector: 'sf-sample-media-rename-dialog',
  standalone: true,
  imports: [SfBannerComponent, SfButtonComponent, SfCopyableComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-media-rename-dialog.component.html',
  styleUrl: './sample-media-rename-dialog.component.scss',
})
export class SampleMediaRenameDialogComponent {
  protected readonly data = injectDialogData<SampleRenameDialogData>();
  private readonly ref = inject<SfDialogRef<string>>(SfDialogRef);
  private readonly toasts = inject(ToastService);
  protected readonly t = injectSampleText('styleguide.sample.media');
  protected readonly dev = injectSampleDevMode();

  protected readonly isFolder = this.data.kind === 'folder';

  // The UID section (developer mode): applies at once, with Undo.
  protected readonly uid = signal(this.data.uid ?? '');
  protected readonly changingUid = signal(false);
  protected readonly uidDraft = signal('');
  protected readonly uidValid = computed(() => UID_PATTERN.test(this.uidDraft()) && this.uidDraft() !== this.uid());

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
      return this.t(this.isFolder ? 'rename.folderRequired' : 'rename.required');
    }
    if (this.isFolder) {
      return this.data.taken.includes(name.toLowerCase()) ? this.t('rename.folderTaken') : null;
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

  protected startUid(): void {
    this.uidDraft.set(this.uid());
    this.changingUid.set(true);
  }

  /** The UID change applies at once; Undo changes it back, also after the dialog is closed. */
  protected applyUid(): void {
    if (!this.uidValid()) {
      return;
    }
    const previous = this.uid();
    const next = this.uidDraft();
    this.uid.set(next);
    this.changingUid.set(false);
    this.toasts.undo(this.t('rename.uid.changed', { uid: next }), () => {
      this.uid.set(previous);
      this.toasts.show(this.t('rename.uid.undone', { uid: previous }), 'info');
    });
  }

  protected apply(): void {
    if (this.valid()) {
      this.ref.close(this.trimmed());
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
