import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, of, catchError } from 'rxjs';
import { ToastService } from '../../core/ui/toast.service';
import { deleteSetQuestion } from './content-tree.util';
import { type ReleaseBlock, deleteQuestion } from '../release/release-status.util';
import { ContentService } from './content.service';

/** What deleting a set needs to know about it. */
export interface DeletableSet {
  uuid: string;
  name: string;
  recordCount: number;
  /** The set's release state (M27.6.1): a published set stays online until the deletion is released. */
  release?: ReleaseBlock;
}

/**
 * Record set actions shared by the Content tree's context menu and the set view (M25.5.1), so both
 * ask the same question and send the same request.
 */
@Injectable({ providedIn: 'root' })
export class RecordSetActions {
  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);

  /**
   * Asks for confirmation — naming how many records go with a non-empty set — and deletes the set,
   * with `cascade` exactly when it has records. Emits `true` once deleted, `false` when the user
   * cancelled or the delete failed (the failure is toasted here).
   */
  delete(projectKey: string, set: DeletableSet): Observable<boolean> {
    if (!window.confirm(deleteQuestion(deleteSetQuestion(set.name, set.recordCount), set.release))) {
      return of(false);
    }
    return this.content.deleteRecordSet(projectKey, set.uuid, set.recordCount > 0).pipe(
      map(() => {
        this.toasts.show('Record set deleted', 'success');
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
