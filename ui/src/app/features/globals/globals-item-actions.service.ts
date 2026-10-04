import { Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, firstValueFrom, isObservable } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import type { UndoStep } from '../../core/ui/undo.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { restoreDeletedAsset } from '../../shared/restore-deleted-asset';
import { isOnline } from '../release/release-status.util';
import type { GlobalEntry } from './globals-tree.util';
import { GlobalsService } from './globals.service';

/** What a batch of deletes or moves did: the entries it got through, the steps that take it back, whether it stopped early. */
export interface GlobalsChange {
  readonly done: readonly GlobalEntry[];
  /** In the order the operations ran; undone last to first. */
  readonly steps: readonly UndoStep[];
  readonly failed: boolean;
}

/**
 * The changes the Globals tree makes (M35.22): one question before a delete, one way to delete and move and one way to
 * take them back (`UndoService`). Sets go through the property-set and generic asset endpoints, folders through the
 * folder endpoints; a folder delete takes everything inside with it and its restore brings it all back.
 */
@Injectable({ providedIn: 'root' })
export class GlobalsItemActions {
  private readonly api = inject(ApiClient);
  private readonly globals = inject(GlobalsService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Asks before a delete; resolves `true` to go on. */
  confirmDelete(entries: readonly GlobalEntry[], injector?: Injector): Promise<boolean> {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const messages = [
      entries.some((entry) => entry.kind === 'folder') ? t('globals.tree.delete.folderMessage') : null,
      entries.some((entry) => entry.kind === 'set') ? t('globals.tree.delete.inUse') : null,
      entries.some((entry) => isOnline(entry.release)) ? t('globals.tree.delete.online') : null,
    ].filter((message): message is string => message !== null);
    const params = { count: entries.length, name: entries[0]?.name ?? '' };
    return this.confirms.confirm({
      title: t('shared.tree.deleteTitle', params),
      message: messages.join(' ') || undefined,
      confirmLabel: t('shared.tree.deleteConfirm', params),
      tone: 'danger',
      details: entries.length > 1 ? entries.slice(0, 12).map((entry) => entry.name) : undefined,
      injector,
    });
  }

  /** Deletes in order and stops at the first failure; what was deleted before it stays deleted and can be undone. */
  async delete(projectKey: string, entries: readonly GlobalEntry[]): Promise<GlobalsChange> {
    const done: GlobalEntry[] = [];
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
    entries: readonly GlobalEntry[],
    target: string | null,
    back: (entry: GlobalEntry) => string | null,
  ): Promise<GlobalsChange> {
    const done: GlobalEntry[] = [];
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

  /** Runs the steps of an Undo last to first and says how it went. */
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

  moveOne(projectKey: string, entry: GlobalEntry, target: string | null): Observable<unknown> {
    return entry.kind === 'set'
      ? this.globals.moveSet(projectKey, entry.uuid, target ?? undefined)
      : this.globals.moveFolder(projectKey, entry.uuid, target ?? undefined);
  }

  private deleteOne(projectKey: string, entry: GlobalEntry): Observable<unknown> {
    return entry.kind === 'set' ? this.globals.delete(projectKey, entry.uuid) : this.globals.deleteFolder(projectKey, entry.uuid, true);
  }

  /** A set is restored from its last live revision, a folder with its subtree. */
  private restoreOne(projectKey: string, entry: GlobalEntry): Observable<unknown> {
    return entry.kind === 'set' ? restoreDeletedAsset(this.api, projectKey, entry.uuid) : this.api.restoreFolder(projectKey, entry.uuid);
  }
}
