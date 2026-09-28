import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ReleaseBarComponent } from '../release/release-bar.component';
import { deleteQuestion } from '../release/release-status.util';
import { type StartPageFailure, startPageFailure } from './start-page.util';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

/**
 * Metadata panel for a selected folder — display name / UID rename, path,
 * contents summary and the folder's start page (M31), plus delete — mirroring
 * the media detail drawer's "identity + metadata + delete" shape for the pages
 * tree's folder nodes.
 *
 * The fixed, protected "All Pages" root (`pages_root`, the site root) opens here
 * too: rename, UID change and delete are hidden for it, the start page picker
 * stays — naming the site's home page is the point of opening it.
 */
@Component({
  selector: 'sf-folder-detail',
  standalone: true,
  imports: [SfButtonComponent, SfFieldComponent, SfIconComponent, SfUidRenameComponent, ReleaseBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-detail.component.html',
  styleUrl: './folder-detail.component.scss',
})
export class FolderDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  /** Setting a start page is an editor's write, like renaming the folder (`PATCH /folders/{uuid}`). */
  protected readonly canEditStartPage = inject(ProjectPermissionsStore).canEditContent;

  readonly projectKey = input.required<string>();
  readonly folder = input.required<FolderView>();
  /** The pages directly in this folder — the only valid start pages. */
  readonly pages = input<AssetSummaryView[]>([]);
  readonly folderCount = input(0);

  readonly close = output<void>();
  readonly renamed = output<void>();
  readonly deleted = output<void>();
  /** The start page changed, or the folder must be re-read after a conflict: the tree reloads. */
  readonly changed = output<void>();

  protected readonly savingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly editingName = signal(false);
  protected readonly savingStartPage = signal(false);
  protected readonly startPageProblem = signal<StartPageFailure | null>(null);

  protected readonly isProtected = computed(() => this.folder().protectedFolder === true);

  protected readonly parentPath = computed(() => {
    const path = this.folder().path ?? '/';
    return path === '/' ? '/' : path;
  });

  protected readonly startPageUuid = computed(() => this.folder().startPageUuid ?? '');

  /** The pointer names a page that is no longer in this folder (moved or deleted): the index UID rule applies. */
  protected readonly startPageMissing = computed(
    () => this.startPageUuid() !== '' && !this.pages().some((page) => page.uuid === this.startPageUuid()),
  );

  constructor() {
    // The panel stays mounted while another folder is selected: a conflict shown for one folder isn't the next one's.
    effect(() => {
      this.folder().uuid;
      untracked(() => this.startPageProblem.set(null));
    });
  }

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
    if (!name || !uuid || this.savingName() || this.readOnly() || this.isProtected()) {
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

  /** Saves the chosen start page (`""` clears it) against the folder's revision; a refused choice puts the select back. */
  protected onStartPageChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const uuid = this.folder().uuid;
    if (!uuid || this.savingStartPage() || !this.canEditStartPage()) {
      select.value = this.startPageUuid();
      return;
    }
    const startPage = select.value === '' ? null : select.value;
    this.savingStartPage.set(true);
    this.startPageProblem.set(null);
    this.api.updateFolder(this.projectKey(), uuid, { startPage }, this.folder().revision).subscribe({
      next: () => {
        this.savingStartPage.set(false);
        this.toast.show(startPage ? 'Start page set' : 'Start page cleared', 'success');
        this.changed.emit();
      },
      error: (err: unknown) => {
        this.savingStartPage.set(false);
        select.value = this.startPageUuid();
        const failure = startPageFailure(err, this.pages());
        if (failure.kind === 'other') {
          this.toast.show(failure.message, 'error');
        } else {
          this.startPageProblem.set(failure);
        }
      },
    });
  }

  /** "Reload" after a stale revision: the tree re-reads the folder, the next choice saves against its new revision. */
  protected reloadFolder(): void {
    this.startPageProblem.set(null);
    this.changed.emit();
  }

  protected pageLabel(page: AssetSummaryView): string {
    return page.displayName || page.uid || 'Untitled';
  }

  protected requestDelete(): void {
    const uuid = this.folder().uuid;
    if (!uuid || this.readOnly() || this.isProtected()) {
      return;
    }
    const name = this.folder().displayName ?? this.folder().uid ?? 'this folder';
    const pageCount = this.pages().length;
    const hasContents = pageCount > 0 || this.folderCount() > 0;
    const message = hasContents
      ? `Delete "${name}" and everything inside it (${pageCount} page(s), ${this.folderCount()} sub-folder(s))? This cannot be undone.`
      : `Delete "${name}"? This cannot be undone.`;
    if (!window.confirm(deleteQuestion(message, this.folder().release))) {
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
