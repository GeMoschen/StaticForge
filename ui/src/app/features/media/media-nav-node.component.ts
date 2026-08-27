import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import type { components } from '../../core/api/generated/schema.d.ts';

type MediaSummaryView = components['schemas']['MediaSummaryView'];

/**
 * One media item, as a leaf in the media library tree — the media-store equivalent of
 * `sf-template-nav-node`/`sf-page-nav-node`'s leaf rows: a name row that opens the item's detail
 * drawer on click, with a context menu mirroring the grid card's own (Open, Rename, Cut, Delete —
 * see `MediaLibraryComponent.onItemContextMenu`). Moving a media item between folders goes
 * through native drag-and-drop (matches the grid card's own `draggable`), not cut/paste, since
 * the media tree already supports drag-move onto a folder row.
 */
@Component({
  selector: 'sf-media-nav-node',
  standalone: true,
  imports: [SfIconComponent, SfRenameAssetDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './media-nav-node.component.html',
  styleUrl: './media-nav-node.component.scss',
})
export class MediaNavNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);

  readonly projectKey = input.required<string>();
  readonly summary = input.required<MediaSummaryView>();
  readonly depth = input<number>(0);
  readonly selected = input<boolean>(false);

  /** Emitted with this item's uuid on click — the parent opens its detail drawer. */
  readonly select = output<string>();
  /** Emitted after a rename/delete succeeds, so the parent reloads the tree/grid. */
  readonly changed = output<void>();

  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected mediaIcon(): string {
    const mime = this.summary().mimeType ?? '';
    if (mime.startsWith('image/')) {
      return 'image';
    }
    if (mime.startsWith('video/')) {
      return 'movie';
    }
    if (mime.startsWith('audio/')) {
      return 'audiotrack';
    }
    return 'perm_media';
  }

  protected onSelect(): void {
    const uuid = this.summary().uuid;
    if (uuid) {
      this.select.emit(uuid);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect();
    }
  }

  protected onDragStart(event: DragEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const label = this.summary().displayName ?? this.summary().uid ?? 'media';
    this.menu.open(event, [
      { label: 'Open', icon: 'open_in_new', action: () => this.onSelect() },
      { label: 'Rename', icon: 'edit', action: () => this.renameOpen.set(true) },
      { label: '', separator: true },
      { label: 'Cut', icon: 'content_cut', action: () => this.clipboard.cut('MEDIA', uuid, label) },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.delete() },
    ]);
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const key = this.projectKey();
    const uuid = this.summary().uuid;
    if (!key || !uuid) {
      return;
    }
    this.renamingName.set(true);
    this.api
      .renameAsset(key, uuid, { displayName }, this.summary().revision ?? undefined)
      .subscribe({
        next: () => {
          this.renamingName.set(false);
          this.renameOpen.set(false);
          this.toast.show('Media renamed', 'success');
          this.changed.emit();
        },
        error: () => {
          this.renamingName.set(false);
          this.toast.show('Could not rename media — try again in a moment.', 'error');
        },
      });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }

  private delete(): void {
    const uuid = this.summary().uuid;
    if (!uuid) {
      return;
    }
    const name = this.summary().displayName ?? this.summary().uid ?? 'this media item';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
      return;
    }
    this.api.deleteAsset(this.projectKey(), uuid).subscribe({
      next: () => {
        this.toast.show('Media deleted', 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not delete media — try again in a moment.', 'error'),
    });
  }
}
