import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { ToastService } from '../../core/ui/toast.service';
import {
  cdlFields,
  errorCount,
  firstSectionWithErrors,
  isSaveShortcut,
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
import { TemplatesLoader } from './templates-loader';
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

  readonly saving = signal(false);
  readonly confirmDelete = signal(false);
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

  /** Ctrl+S / ⌘S saves the template (M34), from anywhere in the editor. */
  onKeydown(event: KeyboardEvent): void {
    if (isSaveShortcut(event)) {
      event.preventDefault();
      if (this.dirty() && !this.saving()) {
        this.saveTemplate();
      }
    }
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
    const store = this.store;
    const key = store.projectKey();
    const uuid = store.selectedUuid();
    const detail = store.detail();
    if (!key || !uuid || !detail || store.readOnly()) {
      return;
    }
    if (Object.keys(store.paginationPathErrors()).length > 0) {
      this.toast.show('A pagination path is missing {pageNumber} — fix it before saving.', 'error');
      return;
    }
    this.saving.set(true);
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
            this.pendingDiscard.set(problem?.detail ?? 'This change discards translations.');
            return;
          }
          if (problem?.field?.startsWith('paginationPath') && problem.detail) {
            this.toast.show(problem.detail, 'error');
            this.saving.set(false);
            return;
          }
          const shown = this.showSaveProblems(err, (diagnostics) => this.showSaveDiagnostics(diagnostics));
          if (!shown) {
            this.toast.show('Could not save template — someone may have edited it, try reloading.', 'error');
          }
          this.saving.set(false);
        },
      });
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

  requestDelete(): void {
    if (this.store.readOnly()) {
      return;
    }
    this.confirmDelete.set(true);
  }

  cancelDelete(): void {
    this.confirmDelete.set(false);
  }

  confirmDeleteAction(): void {
    const store = this.store;
    const key = store.projectKey();
    const uuid = store.selectedUuid();
    if (!key || !uuid || store.readOnly()) {
      return;
    }
    this.service.delete(store.kind(), key, uuid).subscribe({
      next: () => {
        this.toast.show('Template deleted', 'success');
        this.confirmDelete.set(false);
        store.selectedUuid.set(null);
        store.detail.set(null);
        this.loader.reloadList(key);
        this.loader.refreshTemplateStore();
      },
      error: (err) => {
        const detail = err instanceof HttpErrorResponse ? (err.error as { detail?: string } | null)?.detail : undefined;
        this.toast.show(detail ?? 'Could not delete template — it may still be in use by a page.', 'error');
        this.confirmDelete.set(false);
      },
    });
  }
}
