import { Injectable, inject, signal, type Signal } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { tap } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { deleteQuestion } from '../release/release-status.util';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { recordMoveTargets, type MoveTarget } from './content-tree.util';
import { ContentStoreRefresh } from './content-store-refresh.service';
import { ContentService, type RecordDetailView } from './content.service';
import { RecordAutosaveService } from './record-autosave.service';

type AssetHistoryEntry = components['schemas']['AssetHistoryEntry'];
type UsageDto = components['schemas']['UsageDto'];

/** What the record editor hands its actions: the record on screen and how to reload it. */
export interface RecordActionsContext {
  projectKey: Signal<string>;
  record: Signal<RecordDetailView | null>;
  readOnly: Signal<boolean>;
  history: Signal<AssetHistoryEntry[]>;
  usages: Signal<UsageDto[]>;
  /** Re-reads the record (live, not a revision) after an action changed it. */
  reload: (uuid: string) => void;
  /** The record's name for messages (never its UUID); defaults to its display name. */
  title?: () => string;
  /** The record was deleted: the editor has nothing left to show and leaves; without it the editor reloads. */
  afterDelete?: (record: RecordDetailView) => void;
}

/**
 * The record editor's delete, restore and move actions (M35.2) with the state of the move dialog.
 * Provided by the record editor, so each open record has its own.
 */
@Injectable()
export class RecordActionsService {
  private readonly api = inject(ApiClient);
  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly confirms = inject(ConfirmService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly refresh = inject(ContentStoreRefresh, { optional: true });
  private readonly autosave = inject(RecordAutosaveService);
  private readonly transloco = inject(TranslocoService);

  readonly moveOpen = signal(false);
  readonly moving = signal(false);
  readonly moveTargets = signal<MoveTarget[]>([]);

  private ctx!: RecordActionsContext;

  bind(ctx: RecordActionsContext): void {
    this.ctx = ctx;
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`content.record.${key}`, params);
  }

  private nameOf(record: RecordDetailView): string {
    return this.ctx.title?.() ?? record.displayName ?? record.uid ?? this.t('actions.thisRecord');
  }

  async remove(): Promise<void> {
    const record = this.ctx.record();
    if (!record?.uuid || this.ctx.readOnly()) {
      return;
    }
    const name = this.nameOf(record);
    const used = this.ctx.usages().length;
    const referenced = used > 0;
    const confirmed = await this.confirms.confirm({
      title: this.t('delete.title', { name }),
      message: deleteQuestion(
        referenced ? this.t('delete.usedBy', { count: used }) : this.t('delete.message'),
        record.release,
      ),
      confirmLabel: this.t('delete.confirm'),
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    const key = this.ctx.projectKey();
    const uuid = record.uuid;
    this.api.deleteAsset(key, uuid, referenced).subscribe({
      next: () => {
        // Undo restores the record from its last live revision.
        this.undo.offer(this.t('delete.undo', { name }), () =>
          restoreDeletedAsset(this.api, key, uuid).pipe(tap(() => this.afterUndo(uuid))),
        );
        this.refresh?.notify();
        if (this.ctx.afterDelete) {
          this.ctx.afterDelete(record);
        } else {
          this.ctx.reload(uuid);
        }
      },
      error: () => this.toasts.show(this.t('delete.failed'), 'error'),
    });
  }

  restore(): void {
    const record = this.ctx.record();
    const lastLive = this.ctx.history().find((entry) => !entry.deleted);
    if (!record?.uuid || lastLive?.revision == null || this.timeTravel.isTimeTravel()) {
      return;
    }
    this.api.restoreAsset(this.ctx.projectKey(), record.uuid, { fromRevision: lastLive.revision }).subscribe({
      next: () => this.done(this.t('toast.restored'), record.uuid!),
      error: () => this.toasts.show(this.t('toast.restoreFailed'), 'error'),
    });
  }

  /** "Move…": the other live sets of this record's dataset, loaded when the dialog opens. */
  openMove(): void {
    const record = this.ctx.record();
    if (!record?.datasetUuid || this.ctx.readOnly() || record.deleted) {
      return;
    }
    this.content.listRecordSets(this.ctx.projectKey(), record.datasetUuid).subscribe({
      next: (sets) => {
        this.moveTargets.set(recordMoveTargets(sets ?? [], record.datasetUuid, record.recordSet?.uuid));
        this.moveOpen.set(true);
      },
      error: () => this.toasts.show(this.t('toast.setsFailed'), 'error'),
    });
  }

  closeMove(): void {
    this.moveOpen.set(false);
  }

  moveTo(setUuid: string | null): void {
    const record = this.ctx.record();
    if (!record?.uuid || !setUuid || this.ctx.readOnly()) {
      return;
    }
    this.autosave.flush();
    this.moving.set(true);
    const key = this.ctx.projectKey();
    const uuid = record.uuid;
    const name = this.nameOf(record);
    const from = record.recordSet?.uuid;
    const target = this.moveTargets().find((t) => t.uuid === setUuid)?.label ?? this.t('actions.theRecordSet');
    this.content.moveAsset(key, uuid, setUuid).subscribe({
      next: () => {
        this.moving.set(false);
        this.moveOpen.set(false);
        if (!from) {
          this.done(this.t('toast.moved'), uuid);
          return;
        }
        // Undo moves the record back into the set it came from.
        this.undo.offer(this.t('move.undo', { name, target }), () =>
          this.content.moveAsset(key, uuid, from).pipe(tap(() => this.afterUndo(uuid))),
        );
        this.refresh?.notify();
        this.ctx.reload(uuid);
      },
      error: () => {
        this.moving.set(false);
        this.toasts.show(this.t('toast.moveFailed'), 'error');
      },
    });
  }

  /** After an Undo: the tree and, while the editor still shows that record, the record itself. */
  private afterUndo(uuid: string): void {
    this.refresh?.notify();
    if (this.ctx.record()?.uuid === uuid) {
      this.ctx.reload(uuid);
    }
  }

  private done(message: string, uuid: string): void {
    this.toasts.show(message, 'success');
    this.refresh?.notify();
    this.ctx.reload(uuid);
  }
}
