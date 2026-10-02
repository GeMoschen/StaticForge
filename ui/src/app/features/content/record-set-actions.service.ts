import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, from, map, Observable, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { type ReleaseBlock, deleteQuestion } from '../release/release-status.util';
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

/**
 * Record set actions shared by the Content tree's context menu and the set view (M25.5.1), so both
 * ask the same question and send the same request.
 */
@Injectable({ providedIn: 'root' })
export class RecordSetActions {
  private readonly content = inject(ContentService);
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);

  /**
   * Asks for confirmation — naming how many records go with a non-empty set — and deletes the set,
   * with `cascade` exactly when it has records. Emits `true` once deleted, `false` when the user
   * cancelled or the delete failed (the failure is toasted here).
   */
  delete(projectKey: string, set: DeletableSet): Observable<boolean> {
    const records = set.recordCount === 1 ? '1 record' : `${set.recordCount} records`;
    const base = set.recordCount > 0 ? `The set and its ${records} are deleted.` : 'The set is deleted.';
    const confirmed = this.confirms.confirm({
      title: `Delete “${set.name}”?`,
      message: deleteQuestion(base, set.release),
      confirmLabel: 'Delete record set',
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
        const message = `Deleted “${set.name}”${set.recordCount > 0 ? ` and its ${set.recordCount === 1 ? '1 record' : `${set.recordCount} records`}` : ''}.`;
        // Undo restores the set from its last live revision; the restore brings back the records the delete took with it.
        this.undo.offer(message, () => restoreDeletedAsset(this.api, projectKey, set.uuid).pipe(tap(() => set.afterUndo?.())));
        return true;
      }),
      catchError((err: unknown) => {
        const body = err instanceof HttpErrorResponse ? ((err.error ?? {}) as { recordCount?: number }) : {};
        this.toasts.show(
          body.recordCount
            ? `The set has ${body.recordCount} records now — reload and try again.`
            : 'Could not delete the record set — you may need the editor role.',
          'error',
        );
        return of(false);
      }),
    );
  }
}
