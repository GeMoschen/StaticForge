import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom, tap } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { UndoService } from '../../../core/ui/undo.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { ReleaseEventsStore } from '../../release/release-events.store';
import { isOnline } from '../../release/release-status.util';
import { MediaDrawerStore } from './media-drawer.store';

type UsageDto = components['schemas']['UsageDto'];

/** What references the file, and deleting it (a confirmation that says what breaks, then Undo). */
@Injectable()
export class MediaDrawerUsagesStore {
  private readonly core = inject(MediaDrawerStore);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly undo = inject(UndoService);
  private readonly releaseEvents = inject(ReleaseEventsStore);

  readonly usages = signal<UsageDto[]>([]);
  readonly usagesLoading = signal(false);
  readonly usagesFailed = signal(false);
  readonly deleting = signal(false);
  /** How many places use the file; the Used by tab's count note. */
  readonly count = computed(() => this.usages().length);

  private loadedFor: string | null = null;

  /** Reads what references the open file; once per file and revision unless `force`. */
  loadUsages(force = false): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    const key = `${uuid}|${this.core.media()?.revision ?? ''}`;
    if (!force && key === this.loadedFor) {
      return;
    }
    this.loadedFor = key;
    this.usagesLoading.set(true);
    this.usagesFailed.set(false);
    this.core.api.assetUsages(this.core.projectKey(), uuid).subscribe({
      next: (usages) => {
        if (this.loadedFor === key) {
          this.usages.set(usages ?? []);
          this.usagesLoading.set(false);
        }
      },
      error: () => {
        if (this.loadedFor === key) {
          this.usagesLoading.set(false);
          this.usagesFailed.set(true);
        }
      },
    });
  }

  /** Asks before deleting: a file that is used says where, and that the links will break. `true` when it was deleted. */
  async confirmDelete(): Promise<boolean> {
    const media = this.core.media();
    const uuid = media?.uuid;
    if (!uuid || this.core.readOnly() || this.deleting()) {
      return false;
    }
    // What references the file is read again now: the message must not rest on a list that is a few minutes old.
    const usages = await firstValueFrom(this.core.api.assetUsages(this.core.projectKey(), uuid), {
      defaultValue: this.usages(),
    }).catch(() => this.usages());
    const label = media.displayName ?? media.uid ?? '';
    const parts = [
      usages.length > 0 ? this.core.t('delete.used', { count: usages.length }) : null,
      isOnline(media.release) ? this.core.t('delete.online') : null,
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) {
      parts.push(this.core.t('delete.plain'));
    }
    const confirmed = await this.confirms.confirm({
      title: this.core.t('delete.title', { name: label }),
      message: parts.join(' '),
      details: usages.map((usage) => `${usage.fromUid} (${usage.fromType})`),
      confirmLabel: this.core.t('delete.confirm'),
      tone: 'danger',
      injector: this.injector,
    });
    if (!confirmed) {
      return false;
    }
    return this.performDelete();
  }

  private async performDelete(): Promise<boolean> {
    const media = this.core.media();
    const uuid = media?.uuid;
    if (!uuid || this.deleting() || this.core.readOnly()) {
      return false;
    }
    const key = this.core.projectKey();
    const label = media.displayName ?? media.uid ?? '';
    const revision = media.revision;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.core.api.deleteAsset(key, uuid), { defaultValue: undefined });
    } catch {
      this.deleting.set(false);
      this.core.toasts.show(this.core.t('delete.failed'), 'error');
      return false;
    }
    this.deleting.set(false);
    if (revision == null) {
      this.core.toasts.show(this.core.t('delete.deleted'), 'success');
    } else {
      // Undo restores the file at its last live revision; the library re-reads through the release events.
      this.undo.offer(this.core.t('delete.undo', { name: label }), () =>
        this.core.api.restoreAsset(key, uuid, { fromRevision: revision }).pipe(tap(() => this.releaseEvents.changed())),
      );
    }
    this.core.emitDeleted(uuid);
    return true;
  }
}
