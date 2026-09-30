import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { ContextMenuItem, ContextMenuService } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { deleteQuestion, isOnline } from '../../release/release-status.util';
import { type MediaView, MediaLibraryStore } from './media-library.store';

/** Everything you can do to a media item of the grid: rename, delete (one or the selection), cut, drag. */
@Injectable()
export class MediaItemActions {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly library = inject(MediaLibraryStore);

  readonly renamingItem = signal<MediaView | null>(null);
  readonly renamingItemName = signal(false);

  onItemDragStart(uuid: string | undefined, event: DragEvent): void {
    if (!uuid) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  onItemContextMenu(item: MediaView, event: MouseEvent): void {
    const uuid = item.uuid;
    if (!uuid) {
      return;
    }
    const label = item.displayName ?? uuid;
    const items: ContextMenuItem[] = [
      { label: 'Open details', icon: 'info', action: () => this.library.openDetail(uuid) },
    ];
    if (!this.library.readOnly()) {
      items.push(
        { label: 'Rename', icon: 'edit', action: () => this.renamingItem.set(item) },
        { label: 'Cut', icon: 'content_cut', action: () => this.clipboard.cut('MEDIA', uuid, label) },
        { label: '', separator: true },
        { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteOne(uuid, label) },
      );
    }
    this.menu.open(event, items);
  }

  closeRenameItem(): void {
    this.renamingItem.set(null);
  }

  submitRenameItemDisplayName(displayName: string): void {
    const item = this.renamingItem();
    const uuid = item?.uuid;
    if (!uuid || this.library.readOnly()) {
      return;
    }
    this.renamingItemName.set(true);
    this.api.renameAsset(this.library.projectKey(), uuid, { displayName }, item.revision ?? undefined).subscribe({
      next: () => {
        this.renamingItemName.set(false);
        this.renamingItem.set(null);
        this.toasts.show('Media renamed', 'success');
        this.library.reloadMedia();
      },
      error: () => {
        this.renamingItemName.set(false);
        this.toasts.show('Could not rename media — try again in a moment.', 'error');
      },
    });
  }

  private deleteOne(uuid: string, label: string): void {
    if (this.library.readOnly()) {
      return;
    }
    const release = this.library.items().find((i) => i.uuid === uuid)?.release;
    if (!window.confirm(deleteQuestion(`Delete "${label}"? This cannot be undone.`, release))) {
      return;
    }
    this.api.deleteAsset(this.library.projectKey(), uuid).subscribe({
      next: () => {
        this.library.onDeleted(uuid);
        this.toasts.show('Media deleted', 'success');
      },
      error: () => this.toasts.show('Could not delete media — try again in a moment.', 'error'),
    });
  }

  deleteSelection(): void {
    const uuids = this.library.selected();
    if (uuids.length === 0 || this.library.readOnly()) {
      return;
    }
    this.toasts.show(`Deleting ${uuids.length} media item(s)`, 'warning');
    // A published item stays online until its deletion is released (M27.6.1).
    const anyOnline = this.library.items().some((i) => i.uuid != null && uuids.includes(i.uuid) && isOnline(i.release));
    const confirmed = window.confirm(
      anyOnline
        ? `Delete ${uuids.length} media item(s)? Published items stay online until you release their deletion.`
        : `Delete ${uuids.length} media item(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    let remaining = uuids.length;
    for (const uuid of uuids) {
      this.api.deleteAsset(this.library.projectKey(), uuid).subscribe({
        next: () => {
          this.library.items.update((list) => list.filter((i) => i.uuid !== uuid));
          this.library.allMedia.update((list) => list.filter((i) => i.uuid !== uuid));
          this.library.totalElements.update((t) => Math.max(0, t - 1));
          remaining -= 1;
          if (remaining === 0) {
            this.library.selected.set([]);
            this.toasts.show('Media deleted', 'success');
          }
        },
        error: () => {
          remaining -= 1;
          if (remaining === 0) {
            this.library.selected.set([]);
          }
        },
      });
    }
  }
}
