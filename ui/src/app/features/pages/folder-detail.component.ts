import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { ApiClient } from '../../core/api/api.client';
import { tap } from 'rxjs';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { PagesTreeRefresh } from './pages-tree-refresh.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ReleaseBarComponent } from '../release/release-bar.component';
import { deleteQuestion } from '../release/release-status.util';

type FolderView = components['schemas']['FolderView'];

/**
 * Metadata panel for a selected folder — display name / UID rename, path,
 * and contents summary, plus delete — mirroring the media detail drawer's
 * "identity + metadata + delete" shape for the pages tree's folder nodes.
 */
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
@Component({
  selector: 'sf-folder-detail',
  standalone: true,
  imports: [SfAssetFavoriteComponent, SfButtonComponent, SfFieldComponent, SfIconComponent, SfUidRenameComponent, ReleaseBarComponent, SfAssetUrlsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-detail.component.html',
  styleUrl: './folder-detail.component.scss',
})
export class FolderDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly treeRefresh = inject(PagesTreeRefresh);

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
    const key = this.projectKey();
    const oldName = this.folder().displayName ?? this.folder().uid ?? '';
    this.api.renameFolder(key, uuid, { displayName: name }, this.folder().revision).subscribe({
      next: (renamed) => {
        this.savingName.set(false);
        this.editingName.set(false);
        // Undo renames back; the etag is the revision the rename produced.
        this.undo.offer(`Renamed “${oldName}” to “${name}”.`, () =>
          this.api.renameFolder(key, uuid, { displayName: oldName }, renamed.revision).pipe(tap(() => this.treeRefresh.notify())),
        );
        this.renamed.emit();
      },
      error: () => {
        this.savingName.set(false);
        this.toast.show('Could not rename folder — try again in a moment.', 'error');
      },
    });
  }

  protected onUidChanged(): void {
    this.renamed.emit();
  }

  protected async requestDelete(): Promise<void> {
    const uuid = this.folder().uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    const name = this.folder().displayName ?? this.folder().uid ?? 'this folder';
    const hasContents = this.pageCount() > 0 || this.folderCount() > 0;
    const message = hasContents
      ? `The folder and everything inside it (${this.pageCount()} page(s), ${this.folderCount()} sub-folder(s)) is deleted.`
      : 'The folder is deleted.';
    const confirmed = await this.confirms.confirm({
      title: `Delete “${name}”?`,
      message: deleteQuestion(message, this.folder().release),
      confirmLabel: 'Delete folder',
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(this.pageCount() + this.folderCount()),
    });
    if (!confirmed) {
      return;
    }
    const key = this.projectKey();
    this.api.deleteFolder(key, uuid, true).subscribe({
      next: () => {
        // One restore brings back the folder with its whole subtree.
        this.undo.offer(`Deleted “${name}”${hasContents ? ' and everything inside it' : ''}.`, () =>
          this.api.restoreFolder(key, uuid).pipe(tap(() => this.treeRefresh.notify())),
        );
        this.deleted.emit();
      },
      error: () => this.toast.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }
}
