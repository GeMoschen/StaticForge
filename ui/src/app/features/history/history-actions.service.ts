import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ReleaseEventsStore } from '../release/release-events.store';
import { COMPACTED_ASSET_RESTORE_NOTICE, COMPACTED_RESTORE_NOTICE } from '../revisions/compaction.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { HistoryDrawerStore } from './history-drawer.store';
import { HistoryService } from './history.service';
import { HistoryAssetRef, HistoryRow } from './history-rows';
import { NO_HISTORY_FILTER } from './history-model';

/**
 * What a person can do with a revision (M35.12), shared by the History drawer, the page and the time-travel banner:
 * **view** it (time travel), **restore** one item to it (confirm, then Undo), or **roll the project back** to it (a
 * danger action: the project key is typed, the toast offers Undo). Every restore appends a revision — history is never
 * rewritten — and tells the screens to re-read what they show.
 */
@Injectable({ providedIn: 'root' })
export class HistoryActions {
  private readonly service = inject(HistoryService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly frame = inject(FrameContextStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly drawer = inject(HistoryDrawerStore);
  private readonly events = inject(ReleaseEventsStore);

  /** *View*: time travel to the revision — the drawer closes, the banner shows, every screen is read-only. */
  view(row: HistoryRow): void {
    this.drawer.close();
    this.timeTravel.enter(row.id);
  }

  /**
   * *Restore* `asset` to its state in `row`. `currentRevision` is the revision of the item's current version — Undo
   * restores it again (omit it and the toast has no Undo).
   */
  async restoreAsset(row: HistoryRow, asset: HistoryAssetRef, currentRevision?: number): Promise<boolean> {
    const projectKey = this.frame.projectKey();
    if (projectKey === null || asset.uuid === null) {
      return false;
    }
    const ok = await this.confirms.confirm({
      title: this.t('confirm.restoreTitle', { name: asset.name, n: row.id }),
      message: row.compacted ? `${this.t('confirm.restoreMessage')} ${COMPACTED_ASSET_RESTORE_NOTICE}` : this.t('confirm.restoreMessage'),
      confirmLabel: this.t('confirm.restoreConfirm'),
    });
    if (!ok) {
      return false;
    }
    try {
      await firstValueFrom(this.service.restoreAsset(projectKey, asset.uuid, row.id));
    } catch {
      this.toasts.show(this.t('confirm.restoreFailed', { name: asset.name }), 'error');
      return false;
    }
    this.events.changed();
    const message = this.t('confirm.restored', { name: asset.name, n: row.id });
    if (currentRevision === undefined) {
      this.toasts.show(message, 'success');
    } else {
      this.toasts.undo(message, () => void this.undoAssetRestore(projectKey, asset, currentRevision));
    }
    return true;
  }

  /** *Roll back*: the project goes back to the state at `row`; Undo rolls it forward to where it was. */
  async rollBack(row: HistoryRow): Promise<boolean> {
    const projectKey = this.frame.projectKey();
    if (projectKey === null) {
      return false;
    }
    const affected = await this.newerItemNames(projectKey, row.id);
    const ok = await this.confirms.confirm({
      title: this.t('confirm.rollbackTitle', { n: row.id }),
      message: row.compacted
        ? `${this.t('confirm.rollbackMessage', { n: row.id })} ${COMPACTED_RESTORE_NOTICE}`
        : this.t('confirm.rollbackMessage', { n: row.id }),
      confirmLabel: this.t('confirm.rollbackConfirm', { n: row.id }),
      tone: 'danger',
      typeToConfirm: projectKey,
      details: affected,
    });
    if (!ok) {
      return false;
    }
    const head = await this.headRevision(projectKey);
    try {
      await firstValueFrom(this.service.rollBack(projectKey, row.id));
    } catch {
      this.toasts.show(this.t('confirm.rollbackFailed'), 'error');
      return false;
    }
    this.timeTravel.exit();
    this.events.changed();
    const message = this.t('confirm.rolledBack', { n: row.id });
    if (head === null) {
      this.toasts.show(message, 'success');
    } else {
      this.toasts.undo(message, () => void this.undoRollBack(projectKey, head));
    }
    return true;
  }

  private async undoAssetRestore(projectKey: string, asset: HistoryAssetRef, toRevision: number): Promise<void> {
    try {
      await firstValueFrom(this.service.restoreAsset(projectKey, asset.uuid!, toRevision));
      this.events.changed();
      this.toasts.show(this.t('confirm.undone', { name: asset.name }), 'info');
    } catch {
      this.toasts.show(this.t('confirm.undoFailed'), 'error');
    }
  }

  private async undoRollBack(projectKey: string, toRevision: number): Promise<void> {
    try {
      await firstValueFrom(this.service.rollBack(projectKey, toRevision));
      this.events.changed();
      this.toasts.show(this.t('confirm.undone', { name: projectKey }), 'info');
    } catch {
      this.toasts.show(this.t('confirm.undoFailed'), 'error');
    }
  }

  private async headRevision(projectKey: string): Promise<number | null> {
    try {
      const page = await firstValueFrom(this.service.list(projectKey, { filter: NO_HISTORY_FILTER, page: 0, size: 1 }));
      return page.rows[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  /** The names of the items changed after `revision` — what a roll-back to it changes. */
  private async newerItemNames(projectKey: string, revision: number): Promise<string[]> {
    try {
      const page = await firstValueFrom(this.service.list(projectKey, { filter: NO_HISTORY_FILTER, page: 0, size: 200 }));
      return [...new Set(page.rows.filter((r) => r.id > revision).flatMap((r) => r.assets.map((a) => a.name)))].slice(0, 50);
    } catch {
      return [];
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`history.${key}`, params);
  }
}
