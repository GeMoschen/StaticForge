import { Injectable, inject, signal, type Signal } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
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
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly refresh = inject(ContentStoreRefresh, { optional: true });
  private readonly autosave = inject(RecordAutosaveService);

  readonly moveOpen = signal(false);
  readonly moving = signal(false);
  readonly moveTargets = signal<MoveTarget[]>([]);

  private ctx!: RecordActionsContext;

  bind(ctx: RecordActionsContext): void {
    this.ctx = ctx;
  }

  remove(): void {
    const record = this.ctx.record();
    if (!record?.uuid || this.ctx.readOnly()) {
      return;
    }
    const name = record.displayName ?? record.uid ?? 'this record';
    const used = this.ctx.usages().length;
    const referenced = used > 0;
    const question = referenced
      ? `"${name}" is used by ${used} page(s) or template(s). Delete it anyway?`
      : `Delete "${name}"? You can restore it from its history.`;
    if (!window.confirm(deleteQuestion(question, record.release))) {
      return;
    }
    this.api.deleteAsset(this.ctx.projectKey(), record.uuid, referenced).subscribe({
      next: () => this.done('Record deleted', record.uuid!),
      error: () => this.toasts.show('Could not delete the record — try again in a moment.', 'error'),
    });
  }

  restore(): void {
    const record = this.ctx.record();
    const lastLive = this.ctx.history().find((entry) => !entry.deleted);
    if (!record?.uuid || lastLive?.revision == null || this.timeTravel.isTimeTravel()) {
      return;
    }
    this.api.restoreAsset(this.ctx.projectKey(), record.uuid, { fromRevision: lastLive.revision }).subscribe({
      next: () => this.done('Record restored', record.uuid!),
      error: () => this.toasts.show('Could not restore the record — try again in a moment.', 'error'),
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
      error: () => this.toasts.show('Could not load the record sets — try again in a moment.', 'error'),
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
    this.content.moveAsset(this.ctx.projectKey(), record.uuid, setUuid).subscribe({
      next: () => {
        this.moving.set(false);
        this.moveOpen.set(false);
        this.done('Record moved', record.uuid!);
      },
      error: () => {
        this.moving.set(false);
        this.toasts.show('Could not move the record — try again in a moment.', 'error');
      },
    });
  }

  private done(message: string, uuid: string): void {
    this.toasts.show(message, 'success');
    this.refresh?.notify();
    this.ctx.reload(uuid);
  }
}
