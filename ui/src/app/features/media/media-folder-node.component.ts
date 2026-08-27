import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';

type FolderView = components['schemas']['FolderView'];

/** Folder drag-and-drop move event (source moved into target). */
export interface FolderMoveEvent {
  source: string;
  target: string;
}

/**
 * Recursive folder-tree node for the media library sidebar. Modeled on
 * `sf-folder-node` (pages) — same project-wide folder tree/endpoints, expand
 * /collapse, native drag-move (folders or media items dropped onto a
 * folder), and a right-click menu — but without embedding any page-specific
 * children; media items themselves are rendered in the library's grid, not
 * as tree leaves.
 */
@Component({
  selector: 'sf-media-folder-node',
  standalone: true,
  imports: [SfIconComponent, SfCreateAssetDialogComponent, SfRenameAssetDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-folder-node.component.html',
  styleUrl: './media-folder-node.component.scss',
})
export class MediaFolderNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);

  readonly node = input.required<FolderView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);
  readonly projectKey = input<string>('');

  readonly select = output<string>();
  readonly move = output<FolderMoveEvent>();
  /** Emitted after this folder (or something inside it) was created/renamed/moved/deleted, so the parent reloads. */
  readonly changed = output<void>();

  protected readonly expanded = signal(true);
  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  private pendingNewFolderParentUuid: string | null = null;

  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected hasChildren(): boolean {
    return (this.node().children ?? []).length > 0;
  }

  protected isSelected(): boolean {
    const uuid = this.node().uuid;
    return uuid != null && this.selectedUuid() === uuid;
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  protected onSelect(): void {
    if (this.node().uuid != null) {
      this.select.emit(this.node().uuid as string);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect();
    } else if (event.key === 'ArrowRight' && !this.expanded()) {
      this.expanded.set(true);
    } else if (event.key === 'ArrowLeft' && this.expanded()) {
      this.expanded.set(false);
    }
  }

  protected onDragStart(event: DragEvent): void {
    const uuid = this.node().uuid;
    if (uuid == null) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
    this.expanded.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer?.getData('text/plain');
    const target = this.node().uuid;
    if (source && target && source !== target) {
      this.move.emit({ source, target });
    }
  }

  protected onDragEnd(): void {
    // No-op; sibling visual state is managed by the parent.
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.node().uuid;
    if (!uuid) {
      return;
    }
    const clip = this.clipboard.entry();
    const items: ContextMenuItem[] = [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.newSubfolder(uuid) },
      { label: 'Rename', icon: 'edit', action: () => this.renameOpen.set(true) },
      { label: '', separator: true },
      {
        label: 'Cut',
        icon: 'content_cut',
        action: () => this.clipboard.cut('FOLDER', uuid, this.node().displayName ?? this.node().uid ?? 'folder'),
      },
      { label: 'Paste', icon: 'content_paste', disabled: !clip, action: () => this.paste(uuid) },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteFolder(uuid) },
    ];
    this.menu.open(event, items);
  }

  private newSubfolder(parentUuid: string): void {
    this.pendingNewFolderParentUuid = parentUuid;
    this.newFolderOpen.set(true);
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    const parentUuid = this.pendingNewFolderParentUuid;
    if (!parentUuid) {
      return;
    }
    this.creatingFolder.set(true);
    this.api
      .createFolder(this.projectKey(), { displayName: value.displayName, parentFolderUuid: parentUuid, scope: 'MEDIA' })
      .subscribe({
        next: () => {
          this.creatingFolder.set(false);
          this.newFolderOpen.set(false);
          this.toast.show('Folder created', 'success');
          this.changed.emit();
        },
        error: () => {
          this.creatingFolder.set(false);
          this.toast.show('Could not create folder — a folder with that name may already exist here.', 'error');
        },
      });
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const uuid = this.node().uuid;
    if (!uuid) {
      return;
    }
    this.renamingName.set(true);
    this.api.renameFolder(this.projectKey(), uuid, { displayName }).subscribe({
      next: () => {
        this.renamingName.set(false);
        this.renameOpen.set(false);
        this.toast.show('Folder renamed', 'success');
        this.changed.emit();
      },
      error: () => {
        this.renamingName.set(false);
        this.toast.show('Could not rename folder — try again in a moment.', 'error');
      },
    });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }

  private deleteFolder(uuid: string): void {
    const name = this.node().displayName ?? this.node().uid ?? 'this folder';
    if (!window.confirm(`Delete "${name}" and everything inside it? This cannot be undone.`)) {
      return;
    }
    this.api.deleteFolder(this.projectKey(), uuid, true).subscribe({
      next: () => {
        this.toast.show('Folder deleted', 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }

  private paste(targetUuid: string): void {
    const entry = this.clipboard.entry();
    if (!entry) {
      return;
    }
    if (entry.mode !== 'cut') {
      this.toast.show('Only Cut items can be pasted here — no duplicate exists for this item.', 'error');
      return;
    }
    this.api.moveAsset(this.projectKey(), entry.uuid, { folderUuid: targetUuid }).subscribe({
      next: () => {
        this.clipboard.clear();
        this.toast.show(`Moved "${entry.label}"`, 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not move — try again in a moment.', 'error'),
    });
  }
}
