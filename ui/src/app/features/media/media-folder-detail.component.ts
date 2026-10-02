import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MediaFolderActions } from './library/media-folder-actions';
import { ToastService } from '../../core/ui/toast.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ReleaseBarComponent } from '../release/release-bar.component';

type FolderView = components['schemas']['FolderView'];

/**
 * Overlay detail drawer for a media folder — display name / UID rename,
 * path, contents summary, and delete. A near-copy of the pages tree's
 * `sf-folder-detail` (see `folder-detail.component.ts`), but rendered as a
 * scrim + drawer (mirroring `sf-media-detail-drawer`) since media folders
 * are otherwise only "navigate into" targets, not a persistently selected
 * node with its own always-visible detail panel.
 */
@Component({
  selector: 'sf-media-folder-detail',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, SfUidRenameComponent, ReleaseBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-folder-detail.component.html',
  styleUrl: './media-folder-detail.component.scss',
})
export class MediaFolderDetailComponent {
  private readonly actions = inject(MediaFolderActions);
  private readonly toast = inject(ToastService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly projectKey = input.required<string>();
  readonly folder = input.required<FolderView>();
  readonly mediaCount = input(0);
  readonly folderCount = input(0);

  readonly close = output<void>();
  readonly renamed = output<void>();
  readonly deleted = output<void>();

  protected readonly savingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly editingName = signal(false);

  protected readonly folderPath = computed(() => {
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
    this.actions.renameFolderTo(this.folder(), name).subscribe({
      next: () => {
        this.savingName.set(false);
        this.editingName.set(false);
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

  /** The confirmation (with what is inside), the delete and its Undo live in {@link MediaFolderActions}. */
  protected async requestDelete(): Promise<void> {
    if (this.folder().uuid && !this.readOnly() && (await this.actions.deleteFolder(this.folder()))) {
      this.deleted.emit();
    }
  }

  protected closeDrawer(): void {
    this.close.emit();
  }
}
