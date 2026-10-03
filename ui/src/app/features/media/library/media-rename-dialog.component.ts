import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { SfDialogRef, injectDialogData } from '../../../shared/components/dialog/dialog-ref';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfUidRenameComponent } from '../../../shared/components/sf-uid-rename.component';
import { MAX_FILE_NAME_LENGTH, fileExtension, fileNameProblem } from './media-file-name.util';

/** What the UID section of the dialog (developer mode) needs: the item and what the library does with a new UID. */
export interface MediaRenameUidData {
  readonly projectKey: string;
  readonly uuid: string;
  /** The item's current UID. */
  readonly uid: string;
  /** The UID was changed (the dialog is still open): the library shows the new one. */
  readonly changed: (uid: string) => void;
  /** The UID was changed back by Undo, possibly after the dialog closed. */
  readonly undone: (uid: string) => void;
}

export interface MediaRenameDialogData {
  /** A file (default) or a folder: a folder's name has no extension and is unique among its siblings. */
  readonly kind?: 'file' | 'folder';
  /** The item's current name. */
  readonly name: string;
  /** A file's folder name, for the "already exists" message. */
  readonly folder: string;
  /** The other files' (a folder: the sibling folders') names, lower case. */
  readonly taken: readonly string[];
  /** Present when the UID can be changed here; the section shows in developer mode only. */
  readonly uid?: MediaRenameUidData;
}

/**
 * The Rename dialog of a media file (decision 93): one name field, checked as you type — required, no `/ \ : * ? " < > |`,
 * at most 100 characters, the same extension (the file type stays), not a name that is taken in the folder. An error
 * shows as soon as the name differs from the current one. **Apply** is disabled until the name is valid and changed;
 * Enter applies. Closes with the new name; Escape, × and Cancel close without one.
 *
 * A folder (`kind: 'folder'`) has the same dialog without the extension rule: its name is required and free among its
 * siblings. In developer mode the dialog also carries the item's UID (decision 107) with the shared `sf-uid-rename`:
 * it acts on its own — its own button and server call, with Undo — and leaves the name part alone.
 */
@Component({
  selector: 'sf-media-rename-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, SfUidRenameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sf-dialog size="sm" [title]="t('title', { name: data.name })">
      <form (submit)="$event.preventDefault(); apply()">
        <sf-field [label]="t(prefix + 'label')" [hint]="t(prefix + 'hint')" required [error]="error()">
          <sf-input autocomplete="off" [spellcheck]="false" [value]="value()" (valueChange)="value.set($event)" />
        </sf-field>
      </form>
      @if (data.uid; as item) {
        @if (developerMode()) {
          <section class="uid" aria-labelledby="media-rename-uid">
            <h3 class="uid__heading" id="media-rename-uid">{{ t('uid.heading') }}</h3>
            <p class="uid__hint">{{ t('uid.hint') }}</p>
            <sf-uid-rename
              [projectKey]="item.projectKey"
              [uuid]="item.uuid"
              [uid]="uid()"
              [undoable]="true"
              [onUndone]="item.undone"
              (uidChanged)="onUidChanged($event)"
            />
          </section>
        }
      }
      <ng-container sfDialogFooter>
        <sf-button variant="ghost" (click)="cancel()">{{ t('cancel') }}</sf-button>
        <sf-button [disabled]="!valid()" (click)="apply()">{{ t('apply') }}</sf-button>
      </ng-container>
    </sf-dialog>
  `,
  styles: `
    .uid {
      display: flex;
      flex-direction: column;
      gap: var(--sf-space-2);
      margin-block-start: var(--sf-space-4);
      padding-block-start: var(--sf-space-4);
      border-block-start: 1px solid var(--sf-border);
    }

    .uid__heading {
      margin: 0;
      color: var(--sf-text-subtle);
      font-size: var(--sf-fs-12);
      line-height: var(--sf-lh-12);
      font-weight: var(--sf-weight-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .uid__hint {
      margin: 0;
      color: var(--sf-text-muted);
      font-size: var(--sf-fs-12);
      line-height: var(--sf-lh-12);
    }
  `,
})
export class MediaRenameDialogComponent {
  protected readonly data = injectDialogData<MediaRenameDialogData>();
  private readonly ref = inject<SfDialogRef<string>>(SfDialogRef);
  private readonly transloco = inject(TranslocoService);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  private readonly isFolder = this.data.kind === 'folder';
  /** The key prefix of the name field's strings: a folder has its own wording. */
  protected readonly prefix = this.isFolder ? 'folder.' : '';
  /** The UID as it is now (the section shows the new one after a change). */
  protected readonly uid = signal(this.data.uid?.uid ?? '');

  protected readonly value = signal(this.data.name);
  private readonly trimmed = computed(() => this.value().trim());
  private readonly changed = computed(() => this.trimmed() !== this.data.name);
  private readonly problem = computed(() =>
    this.isFolder ? this.folderNameProblem() : fileNameProblem(this.value(), this.data.name, new Set(this.data.taken)),
  );

  /** Why the name is wrong; `null` while it is unchanged or fine. */
  protected readonly error = computed<string | null>(() => {
    const problem = this.problem();
    if (problem === null || !this.changed()) {
      return null;
    }
    return this.t(this.prefix + problem, {
      max: MAX_FILE_NAME_LENGTH,
      extension: fileExtension(this.data.name),
      name: this.trimmed(),
      folder: this.data.folder,
    });
  });
  protected readonly valid = computed(() => this.changed() && this.problem() === null);

  private folderNameProblem(): 'required' | 'taken' | null {
    const name = this.trimmed();
    if (!name) {
      return 'required';
    }
    return this.data.taken.includes(name.toLowerCase()) ? 'taken' : null;
  }

  protected onUidChanged(uid: string): void {
    this.uid.set(uid);
    this.data.uid?.changed(uid);
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`media.rename.${key}`, params);
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
