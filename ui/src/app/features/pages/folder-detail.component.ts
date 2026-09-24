import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';

type FolderView = components['schemas']['FolderView'];

/**
 * Metadata panel for a selected folder — display name / UID rename, path,
 * and contents summary, plus delete — mirroring the media detail drawer's
 * "identity + metadata + delete" shape for the pages tree's folder nodes.
 */
@Component({
  selector: 'sf-folder-detail',
  standalone: true,
  imports: [SfButtonComponent, SfFieldComponent, SfIconComponent, SfUidRenameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-detail.component.html',
  styleUrl: './folder-detail.component.scss',
})
export class FolderDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly projectKey = input.required<string>();
  readonly folder = input.required<FolderView>();
  readonly pageCount = input(0);
  readonly folderCount = input(0);

  readonly close = output<void>();
  readonly renamed = output<void>();
  readonly deleted = output<void>();

  protected readonly savingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly editingName = signal(false);

  protected readonly parentPath = computed(() => {
    const path = this.folder().path ?? '/';
    return path === '/' ? '/' : path;
  });

  protected startEditName(): void {
    this.nameDraft.set(this.folder().displayName ?? '');
    this.editingName.set(true);
  }

  protected cancelEditName(): void {
    this.editingName.set(false);
  }

  protected onNameInput(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
  }

  protected saveName(): void {
    const name = this.nameDraft().trim();
    const uuid = this.folder().uuid;
    if (!name || !uuid || this.savingName() || this.readOnly()) {
      return;
    }
    this.savingName.set(true);
    this.api.renameFolder(this.projectKey(), uuid, { displayName: name }, this.folder().revision).subscribe({
      next: () => {
        this.savingName.set(false);
        this.editingName.set(false);
        this.toast.show('Folder renamed', 'success');
        this.renamed.emit();
      },
      error: () => {
        this.savingName.set(false);
        this.toast.show('Could not rename folder — try again in a moment.', 'error');
      },
    });
  }

  protected onUidChanged(): void {
    this.toast.show('Folder UID changed', 'success');
    this.renamed.emit();
  }

  protected requestDelete(): void {
    const uuid = this.folder().uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    const name = this.folder().displayName ?? this.folder().uid ?? 'this folder';
    const hasContents = this.pageCount() > 0 || this.folderCount() > 0;
    const message = hasContents
      ? `Delete "${name}" and everything inside it (${this.pageCount()} page(s), ${this.folderCount()} sub-folder(s))? This cannot be undone.`
      : `Delete "${name}"? This cannot be undone.`;
    if (!window.confirm(message)) {
      return;
    }
    this.api.deleteFolder(this.projectKey(), uuid, true).subscribe({
      next: () => {
        this.toast.show('Folder deleted', 'success');
        this.deleted.emit();
      },
      error: () => this.toast.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }
}
