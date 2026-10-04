import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { EditorError, EditorStateService } from '../../core/editor/editor-state';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import {
  cdlFields,
  errorCount,
  firstSectionWithErrors,
  sectionsEqual,
  splitDiagnostics,
} from '../../shared/code-editor/cdl-sections';
import {
  descendantProblemsOf,
  diagnosticsOf,
  normalizeDescendants,
  sortDiagnostics,
  templateInUseOf,
} from './inheritance.util';
import { paginationPathsForSave, readPaginationPaths } from './pagination-path.util';
import { TemplatesItemActions } from './templates-item-actions.service';
import { TemplatesLoader } from './templates-loader';
import { EMPTY_TEMPLATES_INDEX, entryOfSummary } from './templates-tree.util';
import { etagFor, TemplatesService, type Diagnostic, type TemplateDetail } from './templates.service';
import { TemplatesStore } from './templates.store';
import { pathMapOf, sameRecord } from './templates.util';

/**
 * What differs from the saved template and what happens to it: the dirty state, the one Save (M34) with its rejections
 * and the translation-discard confirmation (M24.2.2), Ctrl+S, and the delete confirmation. Nothing else writes a
 * template, so this is the one place to change how unsaved edits are tracked and written.
 */
@Injectable()
export class TemplatesSaveCoordinator {
  private readonly store = inject(TemplatesStore);
  private readonly loader = inject(TemplatesLoader);
  private readonly service = inject(TemplatesService);
  private readonly toast = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly actions = inject(TemplatesItemActions);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  readonly saving = signal(false);
  /** The clock time of the last save ("12:04"). */
  readonly lastSaved = signal<string | null>(null);
  /** Why the last save was refused; kept while the edits that were refused are still there. */
  private readonly failure = signal<EditorError | null>(null);
  /**
   * The message of a pending "this discards translations" confirmation (M24.2.2), or `null`. The
   * server refused the save and wrote nothing; confirming re-sends it with `confirmDiscard`.
   */
  readonly pendingDiscard = signal<string | null>(null);

  /** Whether anything differs from the saved template: the Save button and the unsaved hint follow this. */
  readonly dirty = computed(() => {
    const store = this.store;
    const detail = store.detail();
    if (!detail) {
      return false;
    }
    const sameChannels = sameRecord(store.channelSources(), store.savedChannelSources());
    const sameMeta =
      store.displayName() === (detail.displayName ?? '') &&
      store.category() === (detail.category ?? '') &&
      (store.isSection()
        ? store.deprecated() === (detail.deprecated ?? false)
        : store.abstractTemplate() === (detail.abstract ?? false) &&
          sameRecord(paginationPathsForSave(store.paginationPaths()), readPaginationPaths(detail.paginationPath)));
    const saved = store.savedSections();
    return !sameChannels || !sameMeta || saved === null || !sectionsEqual(store.sections(), saved);
  });

  /** Why the template is not saved (compile errors, a missing pagination path, a conflict); `null` when it is. */
  readonly error = computed(() => (this.dirty() ? this.failure() : null));

  /**
   * The template editor as the frame sees it (M35.13): the header's status, Ctrl/Cmd+S, the leave guard and the tab-close
   * prompt read this. It is an explicit-save editor.
   */
  asEditorState(): EditorStateService {
    const store = this.store;
    return {
      name: computed(() => store.displayName() || store.detail()?.displayName || store.detail()?.uid || ''),
      dirty: this.dirty,
      saving: this.saving,
      lastSaved: this.lastSaved,
      error: this.error,
      autosave: false,
      save: () => this.saveAsync(),
      discard: async () => {
        this.failure.set(null);
        this.pendingDiscard.set(null);
        this.loader.discardEdits();
      },
    };
  }

  /** A `409` whose body counts discarded translations is the localization confirmation, not a conflict. */
  private isDiscardConfirmation(err: unknown): boolean {
    const response = err as { status?: number; error?: Record<string, unknown> };
    return response?.status === 409 && response.error?.['discardedLocaleValues'] !== undefined;
  }

  /** Saves again, this time authorising the discard. */
  confirmDiscardAndSave(): void {
    this.pendingDiscard.set(null);
    this.saveTemplate(true);
  }

  cancelDiscard(): void {
    this.pendingDiscard.set(null);
  }

  /**
   * The one Save (M34): the metadata, the CDL sections and every channel's source — added, edited or removed — in one
   * request, so the whole change is one revision. A rejected save keeps every edit and opens the first failing tab.
   */
  saveTemplate(confirmDiscard = false): void {
    void this.saveAsync(confirmDiscard);
  }

  /** The Save as a promise: `{ ok: true }` once written (or when there is nothing to write), else why it was refused. */
  saveAsync(confirmDiscard = false): Promise<SaveResult> {
    const store = this.store;
    const key = store.projectKey();
    const uuid = store.selectedUuid();
    const detail = store.detail();
    if (!key || !uuid || !detail || store.readOnly()) {
      return Promise.resolve({ ok: true });
    }
    if (Object.keys(store.paginationPathErrors()).length > 0) {
      const message = 'A pagination path is missing {pageNumber}';
      this.toast.show(`${message} — fix it before saving.`, 'error');
      this.failure.set({ message, count: 1 });
      return Promise.resolve({ ok: false, message });
    }
    this.saving.set(true);
    return new Promise<SaveResult>((resolve) => this.send(key, uuid, detail, confirmDiscard, resolve));
  }

  private send(key: string, uuid: string, detail: TemplateDetail, confirmDiscard: boolean, resolve: (result: SaveResult) => void): void {
    const store = this.store;
    this.service
      .update(
        store.kind(),
        key,
        uuid,
        {
          displayName: store.displayName(),
          ...cdlFields(store.isSection() ? { ...store.sections(), bodies: '' } : store.sections()),
          category: store.category(),
          deprecated: store.deprecated(),
          channelSources: store.channelSources(),
          ...(store.isSection()
            ? {}
            : {
                outputPath: pathMapOf(detail.outputPath),
                // Edited under "Pagination paths"; blank channels use the default sibling-file path (M21).
                paginationPath: paginationPathsForSave(store.paginationPaths()),
                abstract: store.abstractTemplate(),
              }),
        },
        this.etag(detail),
        confirmDiscard,
      )
      .subscribe({
        next: (updated) => {
          this.loader.applyUpdated(updated);
          this.toast.show('Template saved', 'success');
          this.saving.set(false);
          this.failure.set(null);
          this.lastSaved.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          resolve({ ok: true });
          store.cdlDiagnostics.set([]);
          store.octlDiagnostics.set({});
          store.descendantProblems.set([]);
          store.templateInUse.set(null);
          store.descendantWarnings.set(normalizeDescendants(updated.descendantWarnings));
          this.loader.refreshTemplateStore();
          // Ancestors and inherited editors are derived on save; reload to show them.
          this.loader.reloadDetail(key, uuid, false, this.dirty);
        },
        error: (err) => {
          const problem = (err as { error?: { field?: string; detail?: string } }).error;
          // Taking `localizable` off an editor that has translations is refused until confirmed
          // (M24.2.2); nothing was written, so re-sending with the flag is the whole retry.
          if (!confirmDiscard && this.isDiscardConfirmation(err)) {
            this.saving.set(false);
            const message = problem?.detail ?? 'This change discards translations.';
            this.pendingDiscard.set(message);
            resolve({ ok: false, message });
            return;
          }
          if (problem?.field?.startsWith('paginationPath') && problem.detail) {
            this.toast.show(problem.detail, 'error');
            this.saving.set(false);
            this.failure.set({ message: problem.detail, count: 1 });
            resolve({ ok: false, message: problem.detail });
            return;
          }
          const shown = this.showSaveProblems(err, (diagnostics) => this.showSaveDiagnostics(diagnostics));
          if (!shown) {
            this.toast.show('Could not save template — someone may have edited it, try reloading.', 'error');
          }
          this.saving.set(false);
          const failure = this.failureOf(shown);
          this.failure.set(failure);
          resolve({ ok: false, message: failure.message });
        },
      });
  }

  /** What a refused save comes to: the compile errors on the tabs, the descendants it would break, or a conflict. */
  private failureOf(shown: boolean): EditorError {
    if (!shown) {
      return { message: 'someone may have edited it in the meantime' };
    }
    const count = errorCount(this.store.cdlDiagnostics()) + Object.values(this.store.octlDiagnostics()).reduce((n, list) => n + errorCount(list), 0);
    return count > 0
      ? { message: `${count} compile ${count === 1 ? 'error' : 'errors'}`, count }
      : { message: 'it would break other templates or pages' };
  }

  private etag(detail: TemplateDetail): string | undefined {
    const revision = detail.revision;
    return revision != null ? etagFor(revision) : undefined;
  }

  /** The descendants a rejected save names, or its compile diagnostics; `true` when the error was one of those. */
  private showSaveProblems(err: unknown, diagnosticsTarget: (d: Diagnostic[]) => void): boolean {
    const descendants = descendantProblemsOf(err);
    if (descendants) {
      this.store.descendantProblems.set(descendants);
      this.toast.show('Not saved: the change would break templates that extend this one — see below.', 'error');
      return true;
    }
    const inUse = templateInUseOf(err);
    if (inUse) {
      this.store.templateInUse.set(inUse);
      this.toast.show('Not saved: pages still use this template, so it can\'t be abstract.', 'error');
      return true;
    }
    const diagnostics = diagnosticsOf(err) as Diagnostic[];
    if (diagnostics.length > 0) {
      diagnosticsTarget(diagnostics);
      return true;
    }
    return false;
  }

  /** A rejected save's compile errors: each on its CDL tab or channel tab, and the first failing tab opened. */
  private showSaveDiagnostics(diagnostics: Diagnostic[]): void {
    const store = this.store;
    const { cdl, channels } = splitDiagnostics(diagnostics);
    store.cdlDiagnostics.set(sortDiagnostics(cdl) as Diagnostic[]);
    store.octlDiagnostics.update((all) => {
      const next = { ...all };
      for (const [channel, list] of Object.entries(channels)) {
        next[channel] = sortDiagnostics(list) as Diagnostic[];
      }
      return next;
    });
    const section = firstSectionWithErrors(cdl, store.cdlTabs());
    if (section) {
      store.cdlTab.set(section);
    }
    const failingChannel = Object.keys(channels).find((channel) => errorCount(channels[channel]) > 0);
    if (failingChannel && failingChannel in store.channelSources()) {
      store.selectedChannel.set(failingChannel);
    }
    const where = section ? `the ${section} tab` : failingChannel ? `channel ${failingChannel}` : 'the diagnostics';
    this.toast.show(
      `Not saved: the template has compile errors — see ${where}. Removing content a channel uses breaks that channel until it is updated too.`,
      'error',
    );
  }

  /**
   * Deletes the open template (the header's *Delete*): the confirmation names what uses it (gate decision 156), then one
   * Undo restores it from its last live version, and the area goes back to the folder it was in.
   */
  async requestDelete(): Promise<void> {
    const store = this.store;
    const key = store.projectKey();
    const uuid = store.selectedUuid();
    const detail = store.detail();
    if (!key || !uuid || !detail || store.readOnly()) {
      return;
    }
    const row = store.templates().find((t) => t.uuid === uuid);
    const entry = entryOfSummary({ ...(row ?? {}), uuid, uid: detail.uid, assetType: detail.assetType, displayName: detail.displayName, folderPath: detail.folderPath });
    if (!(await this.actions.confirmDelete(key, [entry], EMPTY_TEMPLATES_INDEX))) {
      return;
    }
    const change = await this.actions.delete(key, [entry]);
    if (change.failed || change.done.length === 0) {
      this.toast.show(this.transloco.translate('templates.toast.deleteFailed', { name: entry.name }), 'error');
      return;
    }
    // Undo brings the template back as its last live version was.
    this.undo.offerGroup(this.transloco.translate('templates.toast.deleted', { name: entry.name }), [
      async () => {
        this.loader.reloadList(key);
        this.loader.refreshTemplateStore();
      },
      ...change.steps,
    ]);
    void this.router.navigate(['/p', key, 'templates'], { queryParams: detail.folderUuid ? { folder: detail.folderUuid } : {} });
    this.loader.reloadList(key);
    this.loader.refreshTemplateStore();
  }
}
