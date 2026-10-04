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
import { type NavIndex, type NavEntry, folderRevision, navChildren } from './navigation-tree.util';
import { NavigationService, etagFor } from './navigation.service';

/** What a batch of deletes or moves did: the entries it got through, the steps that take it back, whether it stopped early. */
export interface NavChange {
  readonly done: readonly NavEntry[];
  /** In the order the operations ran; undone last to first. */
  readonly steps: readonly UndoStep[];
  readonly failed: boolean;
}

/** Why a reorder did not happen: the write was refused, or the order was not known to change. */
export interface NavReorder {
  readonly ok: boolean;
  /** Puts the folder's stored order back to what it was before (the reorder's Undo). */
  readonly undo?: UndoStep;
}

/**
 * The changes the Navigation tree and the folder table share (M35.22): one question before a delete, one way to delete,
 * move, reorder and take them back — so a tree row and a table row behave the same. Folders go through the folder
 * endpoints, items through the reference and generic asset endpoints; a folder delete takes everything inside with it
 * and its restore brings it all back in one call. A reorder writes the folder's stored child order (one revision of the
 * folder); its Undo writes the previous list.
 */
@Injectable({ providedIn: 'root' })
export class NavigationItemActions {
  private readonly api = inject(ApiClient);
  private readonly nav = inject(NavigationService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** The order writes run one after the other: each reads the revision the one before produced. */
  private writes: Promise<unknown> = Promise.resolve();
  /** The revision of a folder after our own latest order write, until the next read of the menu replaces it. */
  private readonly revisions = new Map<string, number>();

  /** Asks before a delete; resolves `true` to go on. A large delete (25 entries) needs the word typed. */
  confirmDelete(entries: readonly NavEntry[], index: NavIndex, injector?: Injector): Promise<boolean> {
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const inside = entries.reduce((sum, entry) => sum + (entry.kind === 'folder' ? this.countInside(index, entry.uuid) : 0), 0);
    const messages = [
      entries.some((entry) => entry.kind === 'folder') ? t('navigation.delete.folderMessage') : null,
      inside > 0 ? t('navigation.delete.inside', { count: inside }) : null,
      entries.some((entry) => isOnline(entry.release)) ? t('navigation.delete.online') : null,
    ].filter((message): message is string => message !== null);
    const params = { count: entries.length, name: entries[0]?.label ?? '' };
    return this.confirms.confirm({
      title: t('shared.tree.deleteTitle', params),
      message: messages.join(' ') || undefined,
      confirmLabel: t('shared.tree.deleteConfirm', params),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(entries.length + inside),
      details: entries.length > 1 ? entries.slice(0, 12).map((entry) => entry.label) : undefined,
      injector,
    });
  }

  /** Deletes in order and stops at the first failure; what was deleted before it stays deleted and can be undone. */
  async delete(projectKey: string, entries: readonly NavEntry[]): Promise<NavChange> {
    const done: NavEntry[] = [];
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

  /** Moves into the folder `target` (`null` = the top level); `back` says where each entry goes on Undo. */
  async move(
    projectKey: string,
    entries: readonly NavEntry[],
    target: string | null,
    back: (entry: NavEntry) => string | null,
  ): Promise<NavChange> {
    const done: NavEntry[] = [];
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

  /**
   * Stores `order` as the order of `folderId`'s children (`null` = the top level, the wrapper); `previous` is what
   * Undo writes back. A stale folder revision (someone else changed the folder) fails like any write.
   */
  reorder(
    projectKey: string,
    index: NavIndex,
    folderId: string | null,
    order: readonly string[],
    previous: readonly string[],
  ): Promise<NavReorder> {
    const folder = folderId ?? index.rootUuid;
    if (!folder) {
      return Promise.resolve({ ok: false });
    }
    const known = folderRevision(index, folderId);
    const write = async (children: readonly string[]): Promise<void> => {
      const revision = this.revisions.get(folder) ?? known;
      const result = await firstValueFrom(
        this.nav.reorderChildren(projectKey, folder, children, revision == null ? undefined : etagFor(revision)),
      );
      if (result.revision != null) {
        this.revisions.set(folder, result.revision);
      }
    };
    const run = this.writes.then(
      async (): Promise<NavReorder> => {
        try {
          await write(order);
          return { ok: true, undo: () => this.queue(() => write(previous)) };
        } catch {
          this.revisions.delete(folder);
          return { ok: false };
        }
      },
    );
    this.writes = run;
    return run;
  }

  /** The menu was read again: revisions from then on come from it. */
  forgetRevisions(): void {
    this.revisions.clear();
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

  /** Folders move through the folder endpoint, items through the generic asset move. */
  moveOne(projectKey: string, entry: NavEntry, target: string | null): Observable<unknown> {
    return entry.kind === 'item'
      ? this.nav.moveReference(projectKey, entry.uuid, target ?? undefined)
      : this.nav.moveFolder(projectKey, entry.uuid, target ?? undefined);
  }

  private queue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writes.then(task, task);
    this.writes = run.catch(() => undefined);
    return run;
  }

  private deleteOne(projectKey: string, entry: NavEntry): Observable<unknown> {
    return entry.kind === 'item' ? this.nav.deleteReference(projectKey, entry.uuid) : this.api.deleteFolder(projectKey, entry.uuid, true);
  }

  /** An item is restored from its last live revision, a folder with its subtree. */
  private restoreOne(projectKey: string, entry: NavEntry): Observable<unknown> {
    return entry.kind === 'item' ? restoreDeletedAsset(this.api, projectKey, entry.uuid) : this.api.restoreFolder(projectKey, entry.uuid);
  }

  private countInside(index: NavIndex, folder: string): number {
    return navChildren(index, folder).reduce((sum, entry) => sum + 1 + (entry.kind === 'folder' ? this.countInside(index, entry.uuid) : 0), 0);
  }
}
