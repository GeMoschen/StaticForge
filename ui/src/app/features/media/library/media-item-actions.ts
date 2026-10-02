import { Injectable, Injector, inject, signal } from '@angular/core';
import { type Observable, firstValueFrom, tap } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { type UndoStep, UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../../shared/components/dialog/delete-confirm';
import { ContextMenuItem, ContextMenuService } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { STAYS_ONLINE_NOTE, isOnline } from '../../release/release-status.util';
import { type MediaView, MediaLibraryStore } from './media-library.store';

/** Everything you can do to a media item of the grid: rename, delete (one or the selection), cut, drag. */
@Injectable()
export class MediaItemActions {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
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
        {
          label: 'Delete',
          icon: 'delete',
          danger: true,
          action: () => void this.deleteMedia({ uuid, label, revision: item.revision, release: item.release }),
        },
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
    this.renameMedia(uuid, item.displayName, displayName, item.revision).subscribe({
      next: () => {
        this.renamingItemName.set(false);
        this.renamingItem.set(null);
        this.library.reloadMedia();
      },
      error: () => {
        this.renamingItemName.set(false);
        this.toasts.show('Could not rename media — try again in a moment.', 'error');
      },
    });
  }

  /**
   * Renames a media item and offers Undo (rename back; the revision the rename produced guards against edits made in
   * between). Without an old name — nothing to rename back to — it is a plain success toast. The caller handles errors.
   */
  renameMedia(
    uuid: string,
    oldName: string | undefined | null,
    displayName: string,
    revision: number | undefined | null,
  ): Observable<unknown> {
    const key = this.library.projectKey();
    return this.api.renameAsset(key, uuid, { displayName }, revision ?? undefined).pipe(
      tap((renamed) => {
        if (oldName) {
          this.undo.offer(`Renamed “${oldName}” to “${displayName}”.`, () =>
            this.api
              .renameAsset(key, uuid, { displayName: oldName }, renamed.revision ?? undefined)
              .pipe(tap(() => this.library.reloadMedia())),
          );
        } else {
          this.toasts.show('Media renamed', 'success');
        }
      }),
    );
  }

  /** Asks, deletes one media item and offers Undo. `true` when it was deleted. */
  async deleteMedia(target: {
    uuid: string;
    label: string;
    revision?: number | null;
    release?: MediaView['release'];
  }): Promise<boolean> {
    if (this.library.readOnly()) {
      return false;
    }
    const { uuid, label } = target;
    const confirmed = await this.confirms.confirm({
      title: `Delete “${label}”?`,
      message: isOnline(target.release) ? STAYS_ONLINE_NOTE : undefined,
      confirmLabel: 'Delete',
      tone: 'danger',
      injector: this.injector,
    });
    if (!confirmed) {
      return false;
    }
    const key = this.library.projectKey();
    try {
      await firstValueFrom(this.api.deleteAsset(key, uuid), { defaultValue: undefined });
    } catch {
      this.toasts.show('Could not delete media — try again in a moment.', 'error');
      return false;
    }
    // The grid and the tree drop the item; a drawer open on another file stays open.
    const openDrawer = this.library.selectedMedia();
    this.library.onDeleted(uuid);
    if (openDrawer && openDrawer.uuid !== uuid) {
      this.library.selectedMedia.set(openDrawer);
    }
    const restore = this.restoreStep(key, uuid, target.revision);
    if (restore) {
      this.undo.offer(`Deleted “${label}”.`, restore);
    } else {
      this.toasts.show('Media deleted', 'success');
    }
    return true;
  }

  /** Undo of a delete: the asset comes back as it was at its last live revision, and the library re-reads. */
  private restoreStep(key: string, uuid: string, revision: number | undefined | null): UndoStep | null {
    return revision == null
      ? null
      : () => this.api.restoreAsset(key, uuid, { fromRevision: revision }).pipe(tap(() => this.library.reloadMedia()));
  }

  async deleteSelection(): Promise<void> {
    const uuids = this.library.selected();
    if (uuids.length === 0 || this.library.readOnly()) {
      return;
    }
    const picked = this.library.items().filter((i) => i.uuid != null && uuids.includes(i.uuid));
    // A published item stays online until its deletion is released (M27.6.1).
    const anyOnline = picked.some((i) => isOnline(i.release));
    const confirmed = await this.confirms.confirm({
      title: `Delete ${uuids.length} ${uuids.length === 1 ? 'file' : 'files'}?`,
      message: anyOnline ? 'Published files stay online until you release their deletion.' : undefined,
      details: picked.map((i) => i.displayName ?? i.uid ?? i.uuid ?? ''),
      confirmLabel: `Delete ${uuids.length} ${uuids.length === 1 ? 'file' : 'files'}`,
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(uuids.length),
      injector: this.injector,
    });
    if (!confirmed) {
      return;
    }
    const key = this.library.projectKey();
    const steps: UndoStep[] = [];
    let failed = 0;
    for (const uuid of uuids) {
      try {
        await firstValueFrom(this.api.deleteAsset(key, uuid), { defaultValue: undefined });
      } catch {
        failed += 1;
        continue;
      }
      const restore = this.restoreStep(key, uuid, picked.find((i) => i.uuid === uuid)?.revision);
      if (restore) {
        steps.push(restore);
      }
      this.library.items.update((list) => list.filter((i) => i.uuid !== uuid));
      this.library.allMedia.update((list) => list.filter((i) => i.uuid !== uuid));
      this.library.totalElements.update((t) => Math.max(0, t - 1));
    }
    this.library.selected.set([]);
    if (failed > 0) {
      this.toasts.show(`Could not delete ${failed} of ${uuids.length} files — try again in a moment.`, 'error');
    }
    const deleted = uuids.length - failed;
    if (deleted > 0) {
      this.undo.offerGroup(deleted === 1 ? 'Deleted 1 file.' : `Deleted ${deleted} files.`, steps);
    }
  }
}
