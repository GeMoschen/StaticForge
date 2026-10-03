import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { catchError, firstValueFrom, from, map, Observable, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { type UndoStep, UndoService } from '../../core/ui/undo.service';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { type ReleaseBlock, deleteQuestion, isOnline } from '../release/release-status.util';
import { recordMoveTargets, type MoveTarget } from './content-tree.util';
import { ContentService } from './content.service';

/** What deleting a set needs to know about it. */
export interface DeletableSet {
  uuid: string;
  name: string;
  recordCount: number;
  /** The set's release state (M27.6.1): a published set stays online until the deletion is released. */
  release?: ReleaseBlock;
  /** Runs after an Undo restored the set, so the screen reloads. */
  afterUndo?: () => void;
}

/** A record the bulk actions work on: its name is what every message shows, never its uuid. */
export interface BulkRecord {
  uuid: string;
  name: string;
  /** The record's release state: a published record stays online until the deletion is released. */
  release?: ReleaseBlock;
}

/**
 * Record set actions shared by the Content tree's context menu and the set view (M25.5.1), so both
 * ask the same question and send the same request — and the bulk actions of the record table (M35.20): delete (with
 * Undo) and move, each one request per record, one Undo for the group.
 */
@Injectable({ providedIn: 'root' })
export class RecordSetActions {
  private readonly content = inject(ContentService);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`content.recordSet.${key}`, params);
  }

  /**
   * Asks for confirmation — naming how many records go with a non-empty set — and deletes the set,
   * with `cascade` exactly when it has records. Emits `true` once deleted, `false` when the user
   * cancelled or the delete failed (the failure is toasted here).
   */
  delete(projectKey: string, set: DeletableSet): Observable<boolean> {
    const confirmed = this.confirms.confirm({
      title: this.t('deleteSet.title', { name: set.name }),
      message: deleteQuestion(this.t('deleteSet.message', { count: set.recordCount }), set.release),
      confirmLabel: this.t('deleteSet.confirm'),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(set.recordCount),
    });
    return from(confirmed).pipe(
      switchMap((yes) => (yes ? this.remove(projectKey, set) : of(false))),
    );
  }

  private remove(projectKey: string, set: DeletableSet): Observable<boolean> {
    return this.content.deleteRecordSet(projectKey, set.uuid, set.recordCount > 0).pipe(
      map(() => {
        // Undo restores the set from its last live revision; the restore brings back the records the delete took with it.
        this.undo.offer(this.t('deleteSet.done', { name: set.name, count: set.recordCount }), () =>
          restoreDeletedAsset(this.api, projectKey, set.uuid).pipe(tap(() => set.afterUndo?.())),
        );
        return true;
      }),
      catchError((err: unknown) => {
        const body = err instanceof HttpErrorResponse ? ((err.error ?? {}) as { recordCount?: number }) : {};
        this.toasts.show(
          body.recordCount ? this.t('deleteSet.changed', { count: body.recordCount }) : this.t('deleteSet.failed'),
          'error',
        );
        return of(false);
      }),
    );
  }

  // ── Bulk actions on records ────────────────────────────────────────────────

  /**
   * Confirms (the word `delete` from 25 records on) and deletes the records one after the other. What was deleted stays
   * undoable as one group, even when a later record fails (that one is reported). Resolves `true` when anything was deleted.
   */
  async deleteRecords(projectKey: string, records: readonly BulkRecord[], afterUndo?: () => void): Promise<boolean> {
    if (records.length === 0) {
      return false;
    }
    const names = records.map((record) => record.name);
    const confirmed = await this.confirms.confirm({
      title: this.t(records.length === 1 ? 'bulk.deleteTitleOne' : 'bulk.deleteTitle', { count: records.length, name: names[0] }),
      message: deleteQuestion(this.t('bulk.deleteMessage'), records.find((record) => isOnline(record.release))?.release ?? null),
      confirmLabel: this.t(records.length === 1 ? 'bulk.deleteConfirmOne' : 'bulk.deleteConfirm', { count: records.length }),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(records.length),
      details: names.slice(0, 12),
    });
    if (!confirmed) {
      return false;
    }
    const done: BulkRecord[] = [];
    let failed = 0;
    for (const record of records) {
      try {
        await firstValueFrom(this.api.deleteAsset(projectKey, record.uuid), { defaultValue: undefined });
        done.push(record);
      } catch {
        failed++;
      }
    }
    if (done.length > 0) {
      const steps: UndoStep[] = done.map((record) => () =>
        restoreDeletedAsset(this.api, projectKey, record.uuid).pipe(tap(() => afterUndo?.())),
      );
      this.undo.offerGroup(this.t('bulk.deleted', { count: done.length, name: done[0].name }), steps);
    }
    if (failed > 0) {
      this.toasts.show(this.t('bulk.deleteFailed', { count: failed }), 'error');
    }
    return done.length > 0;
  }

  /** The sets records of `datasetUuid` can move to: its other live sets (a record never leaves its dataset). */
  moveTargets(projectKey: string, datasetUuid: string, currentSetUuid: string): Observable<MoveTarget[]> {
    return this.content
      .listRecordSets(projectKey, datasetUuid)
      .pipe(map((sets) => recordMoveTargets(sets ?? [], datasetUuid, currentSetUuid)));
  }

  /**
   * Moves the records into the set `target`, one request each; what moved stays undoable as one group (the records go
   * back into `fromSetUuid`). Resolves `true` when anything moved.
   */
  async moveRecords(
    projectKey: string,
    records: readonly BulkRecord[],
    fromSetUuid: string,
    target: MoveTarget,
    afterUndo?: () => void,
  ): Promise<boolean> {
    if (!target.uuid) {
      return false;
    }
    const done: BulkRecord[] = [];
    let failed = 0;
    for (const record of records) {
      try {
        await firstValueFrom(this.content.moveAsset(projectKey, record.uuid, target.uuid), { defaultValue: undefined });
        done.push(record);
      } catch {
        failed++;
      }
    }
    if (done.length > 0) {
      const steps: UndoStep[] = done.map((record) => () =>
        this.content.moveAsset(projectKey, record.uuid, fromSetUuid).pipe(tap(() => afterUndo?.())),
      );
      this.undo.offerGroup(this.t('bulk.moved', { count: done.length, name: done[0].name, target: target.label }), steps);
    }
    if (failed > 0) {
      this.toasts.show(this.t('bulk.moveFailed', { count: failed }), 'error');
    }
    return done.length > 0;
  }
}
