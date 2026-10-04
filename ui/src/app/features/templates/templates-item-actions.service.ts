import { Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { type Observable, catchError, firstValueFrom, forkJoin, isObservable, of, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import { EMPTY_SECTIONS, cdlFields } from '../../shared/code-editor/cdl-sections';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { typeToConfirmFor } from '../../shared/components/dialog/delete-confirm';
import { ContentService } from '../content/content.service';
import { type TemplateEntry, type TemplatesIndex, templatesInside } from './templates-tree.util';
import { TemplatesService, type TemplateKind } from './templates.service';

type UsageDto = components['schemas']['UsageDto'];

/** What a new dataset starts with: one field, so its first record already has something to fill in. */
export const NEW_DATASET_CONTENT = `editor text name { label "Name" required }
`;

/** What a batch of deletes or moves did: the entries it got through, the steps that take it back, whether it stopped early. */
export interface TemplatesChange {
  readonly done: readonly TemplateEntry[];
  /** In the order the operations ran; undone last to first. */
  readonly steps: readonly UndoStep[];
  readonly failed: boolean;
}

/** What the New template dialog asks for. */
export interface NewTemplateRequest {
  readonly kind: 'page' | 'section' | 'dataset';
  readonly name: string;
  readonly uid: string;
  /** The folder it is created in (never the top level). */
  readonly parentFolderUuid?: string;
  /** *Based on*: the template or dataset whose contents (fields, rules, channel templates) the new one starts with (a copy; the two stay independent). */
  readonly basedOn?: TemplateEntry;
}

export interface CreatedTemplate {
  readonly uuid: string;
  readonly uid: string;
  /** `false`: it was created, but the UID the person typed could not be applied (it keeps the one the server derived). */
  readonly uidApplied: boolean;
}

const kindOf = (entry: TemplateEntry): TemplateKind => (entry.kind === 'section' ? 'section' : 'page');

/**
 * The changes the Templates tree, the folder table and the shell's dialogs share (M35.21), after `ContentItemActions`:
 * one question before a delete — naming what uses the items, the typed word from 25 items on — and one way to delete,
 * move, rename, duplicate and take them back, so a tree row and a table row behave the same. Page and section templates go
 * through the template endpoints, datasets through the dataset endpoints, folders through the folder endpoints (a folder
 * delete takes everything inside with it and its restore brings it all back in one call).
 */
@Injectable({ providedIn: 'root' })
export class TemplatesItemActions {
  private readonly api = inject(ApiClient);
  private readonly templates = inject(TemplatesService);
  private readonly content = inject(ContentService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly transloco = inject(TranslocoService);

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`templates.${key}`, params);
  }

  // ── Used by ────────────────────────────────────────────────────────────────

  /** What uses a template or dataset: the pages, the templates that extend it, the record sets of a dataset. */
  usages(projectKey: string, uuid: string): Observable<UsageDto[]> {
    return this.api.assetUsages(projectKey, uuid);
  }

  /**
   * What the items' deletion would leave without its template: the distinct things that use any template inside the
   * entries (a folder counts its contents), apart from the items being deleted themselves.
   */
  async usersOf(projectKey: string, entries: readonly TemplateEntry[], index: TemplatesIndex): Promise<UsageDto[]> {
    const affected = this.affected(entries, index);
    const doomed = new Set(affected.map((entry) => entry.uuid));
    const lookups = affected.filter((entry) => entry.usedByCount !== 0).map((entry) => this.api.assetUsages(projectKey, entry.uuid).pipe(catchError(() => of([] as UsageDto[]))));
    if (lookups.length === 0) {
      return [];
    }
    const all = (await firstValueFrom(forkJoin(lookups), { defaultValue: [] })).flat();
    const seen = new Set<string>();
    return all.filter((usage) => {
      const key = `${usage.fromType}:${usage.fromUuid}`;
      if (seen.has(key) || (usage.fromUuid && doomed.has(usage.fromUuid))) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /** Every template and dataset an action on `entries` touches. */
  private affected(entries: readonly TemplateEntry[], index: TemplatesIndex): TemplateEntry[] {
    const found = new Map<string, TemplateEntry>();
    for (const entry of entries) {
      for (const inner of entry.kind === 'folder' ? templatesInside(index, entry.uuid) : [entry]) {
        found.set(inner.uuid, inner);
      }
    }
    return [...found.values()];
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /** Asks before a delete, naming what uses the items; resolves `true` to go on. A large delete (25 items) needs the word typed. */
  async confirmDelete(projectKey: string, entries: readonly TemplateEntry[], index: TemplatesIndex, injector?: Injector): Promise<boolean> {
    const users = await this.usersOf(projectKey, entries, index);
    const pages = users.filter((usage) => usage.fromType === 'PAGE').length;
    const others = users.length - pages;
    const inside = this.affected(entries, index).length;
    const messages = [
      entries.some((entry) => entry.kind === 'folder') ? this.t('delete.folders') : null,
      users.length > 0 ? this.t('delete.inUse', { pages, others }) : null,
      this.t('delete.restore'),
    ].filter((message): message is string => message !== null);
    const params = { count: entries.length, name: entries[0]?.name ?? '' };
    return this.confirms.confirm({
      title: this.t('delete.title', params),
      message: messages.join(' '),
      confirmLabel: this.t('delete.confirm', params),
      tone: 'danger',
      typeToConfirm: typeToConfirmFor(Math.max(entries.length, inside)),
      details:
        entries.length > 1 || entries.some((entry) => (entry.usedByCount ?? 0) > 0)
          ? entries.slice(0, 12).map((entry) => ((entry.usedByCount ?? 0) > 0 ? `${entry.name} — ${this.t('folder.usedByCount', { count: entry.usedByCount })}` : entry.name))
          : undefined,
      injector,
    });
  }

  /** Deletes in order and stops at the first failure; what was deleted before it stays deleted and can be undone. */
  async delete(projectKey: string, entries: readonly TemplateEntry[]): Promise<TemplatesChange> {
    const done: TemplateEntry[] = [];
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

  private deleteOne(projectKey: string, entry: TemplateEntry): Observable<unknown> {
    switch (entry.kind) {
      case 'folder':
        return this.api.deleteFolder(projectKey, entry.uuid, true);
      case 'dataset':
        return this.content.deleteDataset(projectKey, entry.uuid);
      default:
        return this.templates.delete(kindOf(entry), projectKey, entry.uuid);
    }
  }

  /** A template or dataset comes back as its last live version was, a folder with its whole subtree. */
  private restoreOne(projectKey: string, entry: TemplateEntry): Observable<unknown> {
    switch (entry.kind) {
      case 'folder':
        return this.api.restoreFolder(projectKey, entry.uuid);
      case 'dataset':
        return this.content.restoreDataset(projectKey, entry.uuid);
      default:
        return this.templates.restore(kindOf(entry), projectKey, entry.uuid);
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  /** Moves into the folder `target`; `back` says where each entry goes on Undo. */
  async move(
    projectKey: string,
    entries: readonly TemplateEntry[],
    target: string | null,
    back: (entry: TemplateEntry) => string | null,
  ): Promise<TemplatesChange> {
    const done: TemplateEntry[] = [];
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

  /** The generic move endpoint dispatches by asset type, so folders, templates and datasets go the same way. */
  moveOne(projectKey: string, entry: TemplateEntry, target: string | null): Observable<unknown> {
    return this.api.moveAsset(projectKey, entry.uuid, target ? { folderUuid: target } : {});
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

  // ── Rename ─────────────────────────────────────────────────────────────────

  /** Renames the display name; the observable emits the revision it produced (the etag of the Undo). */
  rename(projectKey: string, entry: TemplateEntry, name: string, etag?: number): Observable<{ revision?: number }> {
    return entry.kind === 'folder'
      ? this.api.renameFolder(projectKey, entry.uuid, { displayName: name }, etag)
      : this.api.renameAsset(projectKey, entry.uuid, { displayName: name }, etag);
  }

  // ── Create and duplicate ───────────────────────────────────────────────────

  /** Creates a page template, section template or dataset; a UID the person edited is applied after creating (the create calls derive their own). */
  async create(projectKey: string, request: NewTemplateRequest): Promise<CreatedTemplate> {
    let created: { uuid?: string; uid?: string };
    const source = request.basedOn;
    if (request.kind === 'dataset') {
      const copy = source ? await this.datasetCopy(projectKey, source) : null;
      created = await firstValueFrom(
        this.content.createDataset(projectKey, {
          ...(copy ?? { contentCdl: NEW_DATASET_CONTENT, titleEditor: 'name' }),
          displayName: request.name,
          parentFolderUuid: request.parentFolderUuid,
        }),
      );
    } else {
      const copy = source ? await this.templateCopy(projectKey, source) : null;
      created = await firstValueFrom(
        this.templates.create(request.kind, projectKey, {
          ...(copy ?? { ...cdlFields(EMPTY_SECTIONS), channelSources: {} }),
          displayName: request.name,
          parentFolderUuid: request.parentFolderUuid,
        }),
      );
    }
    const uuid = created.uuid ?? '';
    let uid = created.uid ?? '';
    let uidApplied = true;
    if (request.uid && request.uid !== uid) {
      try {
        const changed = await firstValueFrom(this.api.changeUid(projectKey, uuid, { uid: request.uid }));
        uid = changed.newUid ?? request.uid;
      } catch {
        uidApplied = false;
      }
    }
    return { uuid, uid, uidApplied };
  }

  /**
   * *Duplicate*: there is no copy endpoint for templates, so the copy is made by reading the original and creating a new
   * one named "<name> copy" next to it. Offers Undo (the copy is deleted again). Resolves the copy's uuid, `null` on a failure.
   */
  async duplicate(projectKey: string, entry: TemplateEntry, parentFolderUuid: string | undefined, changed: () => void): Promise<string | null> {
    try {
      const displayName = this.t('duplicate.name', { name: entry.name });
      let copyUuid: string | undefined;
      if (entry.kind === 'dataset') {
        const copy = await firstValueFrom(
          this.content.createDataset(projectKey, { ...(await this.datasetCopy(projectKey, entry)), displayName, parentFolderUuid }),
        );
        copyUuid = copy.uuid;
      } else {
        const copy = await firstValueFrom(
          this.templates.create(kindOf(entry), projectKey, { ...(await this.templateCopy(projectKey, entry)), displayName, parentFolderUuid }),
        );
        copyUuid = copy.uuid;
      }
      if (!copyUuid) {
        throw new Error('no uuid');
      }
      const uuid = copyUuid;
      const copied: TemplateEntry = { ...entry, uuid, name: displayName };
      this.undo.offer(this.t('duplicate.done', { name: entry.name }), () => this.deleteOne(projectKey, copied).pipe(tap(() => changed())));
      changed();
      return uuid;
    } catch {
      this.toasts.show(this.t('duplicate.failed', { name: entry.name }), 'error');
      return null;
    }
  }
  /** A dataset's contents as a create request carries them (without name and folder). */
  private async datasetCopy(projectKey: string, entry: TemplateEntry) {
    const original = await firstValueFrom(this.content.getDataset(projectKey, entry.uuid));
    return {
      contentCdl: original.contentCdl,
      rulesCdl: original.rulesCdl,
      titleEditor: original.titleEditor,
      description: original.description,
      channelTemplates: recordTemplatesOf(original.channelTemplates),
    };
  }

  /** A page or section template's contents as a create request carries them (without name and folder). */
  private async templateCopy(projectKey: string, entry: TemplateEntry) {
    const original = await firstValueFrom(this.templates.get(kindOf(entry), projectKey, entry.uuid));
    return {
      contentCdl: original.contentCdl,
      bodiesCdl: original.bodiesCdl,
      rulesCdl: original.rulesCdl,
      channelSources: channelSourcesOf(original.channelTemplates),
      category: original.category,
      deprecated: original.deprecated,
      outputPath: stringMap(original.outputPath),
      paginationPath: stringMap(original.paginationPath),
      abstract: original.abstract,
    };
  }
}

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries((value as Record<string, unknown> | null | undefined) ?? {})) {
    if (typeof entry === 'string') {
      out[key] = entry;
    }
  }
  return out;
}

function channelSourcesOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries((value as Record<string, unknown> | null | undefined) ?? {})) {
    out[key] = typeof entry === 'string' ? entry : ((entry as { source?: string } | null)?.source ?? '');
  }
  return out;
}

/** A dataset's record templates as the create request sends them: the source per channel. */
function recordTemplatesOf(value: unknown): Record<string, string> {
  return channelSourcesOf(value);
}
