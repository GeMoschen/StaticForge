import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { ReleaseEventsStore } from '../../release/release-events.store';
import { MediaDrawerStore } from './media-drawer.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';

type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];

/**
 * The file's history (`GET /assets/{uuid}/history`): the Versions tab lists it, the Details tab reads who uploaded the
 * file and when it last changed from it, and Restore (`POST /assets/{uuid}/restore`) makes an earlier version the
 * current one again — as a new revision, so nothing is lost.
 */
@Injectable()
export class MediaDrawerVersionsStore {
  private readonly core = inject(MediaDrawerStore);
  private readonly text = inject(MediaDrawerTextStore);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly releaseEvents = inject(ReleaseEventsStore);

  /** Every revision of the file, newest first. */
  readonly entries = signal<AssetHistoryEntry[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly restoring = signal<number | null>(null);

  /** The current version: the newest one that is not a deletion. */
  readonly current = computed(() => this.entries().find((entry) => !entry.deleted)?.revision ?? null);
  /** Who made the first version, and when (the file's upload). */
  readonly uploaded = computed(() => this.entries().at(-1) ?? null);
  /** Who made the current version, and when. */
  readonly modified = computed(() => this.entries().find((entry) => !entry.deleted) ?? null);

  private loadedFor: string | null = null;

  /** Reads the history of the open file; once per file and revision unless `force`. */
  load(force = false): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    const key = `${uuid}|${this.core.media()?.revision ?? ''}`;
    if (!force && key === this.loadedFor) {
      return;
    }
    this.loadedFor = key;
    this.loading.set(true);
    this.failed.set(false);
    this.core.api.assetHistory(this.core.projectKey(), uuid).subscribe({
      next: (entries) => {
        if (this.loadedFor === key) {
          this.entries.set([...(entries ?? [])].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0)));
          this.loading.set(false);
        }
      },
      error: () => {
        if (this.loadedFor === key) {
          this.loading.set(false);
          this.failed.set(true);
        }
      },
    });
  }

  /** Asks, then makes `entry`'s version the current one again. */
  async restore(entry: AssetHistoryEntry): Promise<void> {
    const media = this.core.media();
    const uuid = media?.uuid;
    const revision = entry.revision;
    if (!uuid || revision == null || this.core.readOnly() || this.restoring() !== null) {
      return;
    }
    const confirmed = await this.confirms.confirm({
      title: this.core.t('versions.restoreTitle', { version: revision }),
      message: this.core.t('versions.restoreMessage', { name: media.displayName ?? media.uid ?? '' }),
      confirmLabel: this.core.t('versions.restoreConfirm'),
      injector: this.injector,
    });
    if (!confirmed) {
      return;
    }
    this.restoring.set(revision);
    try {
      const key = this.core.projectKey();
      await firstValueFrom(this.core.api.restoreAsset(key, uuid, { fromRevision: revision }));
      const view = await firstValueFrom(this.core.api.mediaDetail(key, uuid));
      this.text.resetText();
      this.core.applyUpdated(view);
      this.releaseEvents.changed();
      this.core.toasts.show(this.core.t('versions.restored', { version: revision }), 'success');
      this.load(true);
    } catch (err) {
      this.core.toasts.show(problemOf(err, this.core.t('versions.failed')).detail, 'error');
    } finally {
      this.restoring.set(null);
    }
  }
}
