import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { etagFor, NavigationService, type NavigationFolderView, type NavTreeView } from './navigation.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ReleaseBarComponent } from '../release/release-bar.component';
import type { ReleaseMode } from '../release/release-choice.util';
import { type ReleaseBlock, deleteQuestion } from '../release/release-status.util';

interface StartNodeOption {
  value: string;
  label: string;
  kind: 'PAGE_REFERENCE' | 'FOLDER';
  assetUuid: string;
}

/**
 * Detail drawer for a selected navigation folder — rename, the `startNode`
 * picker (constrained to this folder's own direct children, per `M8.1.2`'s
 * server-side validation — the options are derived from the already-loaded
 * tree data rather than a separate fetch), and delete.
 *
 * The fixed, protected "All Navigation" root folder (`folder().protectedFolder`)
 * is shown here like any other folder, but rename/UID-change/delete are
 * hidden — it's the project's one shared navigation root and must never be
 * renamed, re-uid'd, or deleted. The entry-page picker stays fully
 * available for it though — that's the whole point of a real root asset.
 */
@Component({
  selector: 'sf-nav-folder-detail',
  standalone: true,
  imports: [SfButtonComponent, SfFieldComponent, SfIconComponent, SfUidRenameComponent, ReleaseBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-folder-detail.component.html',
  styleUrl: './nav-folder-detail.component.scss',
})
export class NavFolderDetailComponent {
  readonly projectKey = input.required<string>();
  readonly folder = input.required<NavigationFolderView>();
  /** This folder's direct children in the tree — the only valid `startNode` targets. */
  readonly children = input<NavTreeView[]>([]);
  /** The folder's release state from the tree (M27.6.1), for the delete question. */
  readonly release = input<ReleaseBlock>(null);

  readonly closed = output<void>();
  readonly changed = output<void>();
  readonly deleted = output<string>();

  private readonly nav = inject(NavigationService);
  private readonly toast = inject(ToastService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly savingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly editingName = signal(false);
  protected readonly savingStartNode = signal(false);
  protected readonly deleting = signal(false);

  protected readonly isProtected = computed<boolean>(() => this.folder().protectedFolder === true);

  protected readonly startNodeOptions = computed<StartNodeOption[]>(() =>
    this.children()
      .filter((c) => c.type === 'FOLDER' || c.type === 'PAGE_REFERENCE')
      .map((c) => ({
        value: `${c.type}:${c.uuid}`,
        label: c.displayName ?? c.uid ?? c.uuid ?? '',
        kind: c.type as 'PAGE_REFERENCE' | 'FOLDER',
        assetUuid: c.uuid ?? '',
      })),
  );

  protected readonly selectedStartNodeValue = computed(() => {
    const startNode = this.folder().startNode;
    if (!startNode || !startNode.kind || !startNode.assetUuid) {
      return '';
    }
    return `${startNode.kind}:${startNode.assetUuid}`;
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
    if (!name || !uuid || this.savingName() || this.isProtected() || this.readOnly()) {
      return;
    }
    this.savingName.set(true);
    this.nav.renameFolder(this.projectKey(), uuid, name, this.etag()).subscribe({
      next: () => {
        this.savingName.set(false);
        this.editingName.set(false);
        this.toast.show('Folder renamed', 'success');
        this.changed.emit();
      },
      error: () => {
        this.savingName.set(false);
        this.toast.show('Could not rename folder — try again in a moment.', 'error');
      },
    });
  }

  protected onStartNodeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const uuid = this.folder().uuid;
    if (!uuid || this.savingStartNode() || this.readOnly()) {
      return;
    }
    this.savingStartNode.set(true);
    const startNode = value === '' ? null : this.parseOption(value);
    this.nav.updateFolder(this.projectKey(), uuid, { startNode }, this.etag()).subscribe({
      next: () => {
        this.savingStartNode.set(false);
        this.toast.show(startNode ? 'Entry page set' : 'Entry page cleared', 'success');
        this.changed.emit();
      },
      error: () => {
        this.savingStartNode.set(false);
        this.toast.show('Could not update entry page — try again in a moment.', 'error');
      },
    });
  }

  /** A discard wrote the released folder back as the draft: the navigation reloads it (M27.6.1). */
  protected onReleaseChanged(mode: ReleaseMode): void {
    if (mode === 'discard') {
      this.changed.emit();
    }
  }

  protected requestDelete(): void {
    const uuid = this.folder().uuid;
    if (!uuid || this.isProtected() || this.readOnly()) {
      return;
    }
    const name = this.folder().displayName ?? this.folder().uid ?? 'this folder';
    const childCount = this.children().length;
    const message = childCount > 0
      ? `Delete "${name}" and everything inside it (${childCount} item(s))? This cannot be undone.`
      : `Delete "${name}"? This cannot be undone.`;
    if (!window.confirm(deleteQuestion(message, this.release()))) {
      return;
    }
    this.deleting.set(true);
    this.nav.deleteFolder(this.projectKey(), uuid, true).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toast.show('Folder deleted', 'success');
        this.deleted.emit(uuid);
      },
      error: () => {
        this.deleting.set(false);
        this.toast.show('Could not delete folder — try again in a moment.', 'error');
      },
    });
  }

  protected closeDrawer(): void {
    this.closed.emit();
  }

  private parseOption(value: string): StartNodeInputLike {
    const [kind, assetUuid] = value.split(':');
    return { kind: kind as 'PAGE_REFERENCE' | 'FOLDER', assetUuid };
  }

  private etag(): string | undefined {
    const revision = this.folder().revision;
    return revision != null ? etagFor(revision) : undefined;
  }
}

interface StartNodeInputLike {
  kind: 'PAGE_REFERENCE' | 'FOLDER';
  assetUuid: string;
}
