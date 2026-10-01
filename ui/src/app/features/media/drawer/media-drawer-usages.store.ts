import { Injectable, Injector, inject, signal } from '@angular/core';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { STAYS_ONLINE_NOTE, deleteQuestion, isOnline } from '../../release/release-status.util';
import { MediaDrawerStore } from './media-drawer.store';

type UsageDto = components['schemas']['UsageDto'];

/** What the user types to delete a file other assets still reference. */
const DELETE_TOKEN = 'DELETE';

/** What references the file, and deleting it — which asks for a typed confirmation while it is referenced. */
@Injectable()
export class MediaDrawerUsagesStore {
  private readonly core = inject(MediaDrawerStore);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);

  readonly usages = signal<UsageDto[]>([]);
  readonly usagesLoading = signal(false);
  readonly deleting = signal(false);

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

  /** Asks before deleting; while other assets reference the file, the user must type DELETE. */
  async confirmDelete(): Promise<void> {
    const uuid = this.core.media()?.uuid;
    // Whether the file is referenced decides the typed DELETE gate: never ask before the usages have loaded.
    if (!uuid || this.core.readOnly() || this.usagesLoading()) {
      return;
    }
    const usages = this.usages();
    const referenced = usages.length > 0;
    const release = this.core.media()?.release;
    const confirmed = await this.confirms.confirm({
      title: 'Delete media',
      message: referenced
        ? `This file is referenced by ${usages.length} asset(s). Deleting it will break those references.` +
          (isOnline(release) ? ` ${STAYS_ONLINE_NOTE}` : '')
        : deleteQuestion('Delete this media file?', release),
      details: usages.map((usage) => `${usage.fromUid} (${usage.fromType})`),
      confirmLabel: 'Delete',
      tone: 'danger',
      typeToConfirm: referenced ? DELETE_TOKEN : undefined,
      irreversible: true,
      injector: this.injector,
    });
    if (confirmed) {
      this.performDelete();
    }
  }

  private performDelete(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.deleting() || this.core.readOnly()) {
      return;
    }
    this.deleting.set(true);
    this.core.api.deleteAsset(this.core.projectKey(), uuid).subscribe({
      next: () => {
        this.core.toasts.show('Media deleted', 'success');
        this.deleting.set(false);
        this.core.emitDeleted(uuid);
      },
      error: () => {
        this.deleting.set(false);
        this.core.toasts.show('Could not delete media — it may still be referenced by a page or template.', 'error');
      },
    });
  }
}
