import { Injectable, inject, signal } from '@angular/core';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { DialogService } from '../../../core/ui/dialog.service';
import { STAYS_ONLINE_NOTE, deleteQuestion, isOnline } from '../../release/release-status.util';
import { MediaDrawerStore } from './media-drawer.store';

type UsageDto = components['schemas']['UsageDto'];

/** What references the file, and deleting it — which asks for a typed confirmation while it is referenced. */
@Injectable()
export class MediaDrawerUsagesStore {
  private readonly core = inject(MediaDrawerStore);
  readonly dialog = inject(DialogService);

  readonly DELETE_TOKEN = 'DELETE';

  readonly usages = signal<UsageDto[]>([]);
  readonly usagesLoading = signal(false);
  readonly deleting = signal(false);
  readonly confirmText = signal('');

  loadUsages(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.usagesLoading.set(true);
    this.core.api.assetUsages(this.core.projectKey(), uuid).subscribe({
      next: (usages) => {
        this.usages.set(usages ?? []);
        this.usagesLoading.set(false);
      },
      error: () => this.usagesLoading.set(false),
    });
  }

  confirmDelete(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly()) {
      return;
    }
    const referenced = this.usages().length > 0;
    const release = this.core.media()?.release;
    this.confirmText.set('');
    this.dialog.open({
      title: 'Delete media',
      message: referenced
        ? `This file is referenced by ${this.usages().length} asset(s). Deleting it will break those references.` +
          (isOnline(release) ? ` ${STAYS_ONLINE_NOTE}` : '') +
          ' Type DELETE to confirm.'
        : deleteQuestion('Delete this media file? This cannot be undone.', release),
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  canConfirmDelete(): boolean {
    return this.usages().length === 0 || this.confirmText().trim() === this.DELETE_TOKEN;
  }

  onDeleteInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  cancelDelete(): void {
    this.dialog.close();
    this.confirmText.set('');
  }

  performDelete(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || !this.canConfirmDelete() || this.deleting() || this.core.readOnly()) {
      return;
    }
    this.deleting.set(true);
    this.core.api.deleteAsset(this.core.projectKey(), uuid).subscribe({
      next: () => {
        this.core.toasts.show('Media deleted', 'success');
        this.deleting.set(false);
        this.dialog.close();
        this.confirmText.set('');
        this.core.emitDeleted(uuid);
      },
      error: () => {
        this.deleting.set(false);
        this.core.toasts.show('Could not delete media — it may still be referenced by a page or template.', 'error');
      },
    });
  }
}
