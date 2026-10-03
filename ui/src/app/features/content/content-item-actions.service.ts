import { Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, firstValueFrom, isObservable } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import type { UndoStep } from '../../core/ui/undo.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { isOnline } from '../release/release-status.util';
import { type ContentEntry } from './content-tree.util';
import { ContentService } from './content.service';

/** What a batch of deletes or moves did: the entries it got through, the steps that take it back, whether it stopped early. */
export interface ContentChange {
  readonly done: readonly ContentEntry[];
  /** In the order the operations ran; undone last to first. */
  readonly steps: readonly UndoStep[];
  readonly failed: boolean;
}

/**
 * The changes the Content tree and the folder table share (M35.20): one question before a delete — the typed word from
 * 25 items on — one way to delete, move and take them back, so a tree row and a table row behave the same. Folders go
 * through the folder endpoints, record sets through the record set and generic asset endpoints; a folder delete takes
 * everything inside with it (record sets and their records) and its restore brings it all back in one call.
 */
@Injectable({ providedIn: 'root' })
export class ContentItemActions {
  private readonly api = inject(ApiClient);
  private readonly content = inject(ContentService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Asks before a delete; resolves `true` to go on. A large delete (25 items or records) needs the word typed. */
  confirmDelete(entries: readonly ContentEntry[], injector?: Injector): Promise<boolean> {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const records = entries.filter((entry) => entry.kind === 'set').reduce((sum, entry) => sum + entry.recordCount, 0);
    const messages = [
      entries.some((entry) => entry.kind === 'folder') ? t('content.tree.delete.folderMessage') : null,
      records > 0 ? t('content.tree.delete.records', { count: records }) : null,
      entries.some((entry) => isOnline(entry.release)) ? t('content.tree.delete.online') : null,
    ].filter((message): message is string => message !== null);
    const params = { count: entries.length, name: entries[0]?.name ?? '' };
    return this.confirms.confirm({
      title: t('shared.tree.deleteTitle', params),
      message: messages.join(' ') || undefined,
      confirmLabel: t('shared.tree.deleteConfirm', params),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(Math.max(entries.length, records)),
      details: entries.length > 1 ? entries.slice(0, 12).map((entry) => entry.name) : undefined,
      injector,
    });
  }

  /** Deletes in order and stops at the first failure; what was deleted before it stays deleted and can be undone. */
  async delete(projectKey: string, entries: readonly ContentEntry[]): Promise<ContentChange> {
    const done: ContentEntry[] = [];
    const steps: UndoStep[] = [];
    try {
      for (const entry of entries) {
        await firstValueFrom(this.deleteOne(projectKey, entry), { defaultValue: undefined });
        done.push(entry);
        steps.push(() => this.restoreOne(projectKey, entry));
      }
    } catch {
      return { done, steps, failed: true };
    }
    return { done, steps, failed: false };
  }

  /** Moves into the folder `target` (`null` = the store root); `back` says where each entry goes on Undo. */
  async move(
    projectKey: string,
    entries: readonly ContentEntry[],
    target: string | null,
    back: (entry: ContentEntry) => string | null,
  ): Promise<ContentChange> {
    const done: ContentEntry[] = [];
    const steps: UndoStep[] = [];
    try {
      for (const entry of entries) {
        await firstValueFrom(this.moveOne(projectKey, entry, target), { defaultValue: undefined });
        done.push(entry);
        const origin = back(entry);
        steps.push(() => this.moveOne(projectKey, entry, origin));
      }
    } catch {
      return { done, steps, failed: true };
    }
    return { done, steps, failed: false };
  }

  /** Runs the steps of an Undo last to first and says how it went (the tree's own Undo toast calls this). */
  async runUndo(steps: readonly UndoStep[]): Promise<void> {
    try {
      for (const step of [...steps].reverse()) {
        const result = step();
        await (isObservable(result) ? firstValueFrom(result, { defaultValue: undefined }) : result);
      }
      this.toasts.show(this.transloco.translate('shared.undo.done'), 'info');
    } catch {
      this.toasts.show(this.transloco.translate('shared.undo.failed'), 'error');
    }
  }

  /** Folders move through the folder endpoint, record sets through the generic asset move. */
  moveOne(projectKey: string, entry: ContentEntry, target: string | null): Observable<unknown> {
    return entry.kind === 'set'
      ? this.content.moveAsset(projectKey, entry.uuid, target ?? undefined)
      : this.content.moveFolder(projectKey, entry.uuid, target ?? undefined);
  }

  private deleteOne(projectKey: string, entry: ContentEntry): Observable<unknown> {
    return entry.kind === 'set'
      ? this.content.deleteRecordSet(projectKey, entry.uuid, entry.recordCount > 0)
      : this.api.deleteFolder(projectKey, entry.uuid, true);
  }

  /** A set is restored from its last live revision (with the records the delete took along), a folder with its subtree. */
  private restoreOne(projectKey: string, entry: ContentEntry): Observable<unknown> {
    return entry.kind === 'set' ? restoreDeletedAsset(this.api, projectKey, entry.uuid) : this.api.restoreFolder(projectKey, entry.uuid);
  }
}
