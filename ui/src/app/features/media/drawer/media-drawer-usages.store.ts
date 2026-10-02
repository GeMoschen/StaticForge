import { Injectable, Injector, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { ReleaseEventsStore } from '../../release/release-events.store';
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
  private readonly undo = inject(UndoService);
  private readonly releaseEvents = inject(ReleaseEventsStore);

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
      injector: this.injector,
    });
    if (confirmed) {
      this.performDelete();
    }
  }

  private performDelete(): void {
    const media = this.core.media();
    const uuid = media?.uuid;
    if (!uuid || this.deleting() || this.core.readOnly()) {
      return;
    }
    const key = this.core.projectKey();
    const label = media.displayName ?? media.uid ?? 'the file';
    const revision = media.revision;
    this.deleting.set(true);
    this.core.api.deleteAsset(key, uuid).subscribe({
      next: () => {
        if (revision == null) {
          this.core.toasts.show('Media deleted', 'success');
        } else {
          // Undo restores the file at its last live revision; the library re-reads through the release events.
          this.undo.offer(`Deleted “${label}”.`, () =>
            this.core.api
              .restoreAsset(key, uuid, { fromRevision: revision })
              .pipe(tap(() => this.releaseEvents.changed())),
          );
        }
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
