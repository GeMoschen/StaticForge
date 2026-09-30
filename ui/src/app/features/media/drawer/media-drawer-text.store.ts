import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { TimeTravelStore } from '../../revisions/time-travel.store';
import type { ConflictInfo } from '../../pages/types';
import {
  type LineEnding,
  TEXT_EDITOR_MAX_BYTES,
  VALIDATE_DEBOUNCE_MS,
  diagnosticsOf,
  hasErrors,
  lineEndingOf,
  withLineEnding,
} from '../text-media.util';
import { type Diagnostic, MediaDrawerStore, type MediaDrawerTab } from './media-drawer.store';

/** Source and Rendered tabs of text media (M18.4.1), the "Process CMS syntax" switch and live validation. */
@Injectable()
export class MediaDrawerTextStore implements OnDestroy {
  private readonly core = inject(MediaDrawerStore);
  private readonly timeTravel = inject(TimeTravelStore);

  readonly togglingProcess = signal(false);

  /** The file content as last loaded or saved; `null` until the Source tab loads it. */
  readonly savedText = signal<string | null>(null);
  /** The editor content, with the file's own line endings. */
  readonly sourceText = signal('');
  /** What the editor is (re)initialized with — only on load, never while typing (keeps the caret). */
  readonly editorSeed = signal('');
  readonly lineEnding = signal<LineEnding>('LF');
  readonly sourceUtf8 = signal(true);
  readonly sourceLoading = signal(false);
  readonly sourceSaving = signal(false);
  readonly sourceDiagnostics = signal<Diagnostic[]>([]);
  readonly conflict = signal<ConflictInfo | null>(null);

  readonly renderedText = signal<string | null>(null);
  readonly renderedLoading = signal(false);
  readonly renderedDiagnostics = signal<Diagnostic[]>([]);

  /** The language the Source tab edits for localized text media; `null` follows the editing language. */
  private readonly textLocaleChoice = signal<string | null>(null);
  readonly textLocale = computed<string | null>(() =>
    this.core.localized() && this.core.showLocalization()
      ? (this.textLocaleChoice() ?? this.core.editingLocale.locale())
      : null,
  );

  readonly tooLarge = computed(() => (this.core.media()?.sizeBytes ?? 0) > TEXT_EDITOR_MAX_BYTES);
  readonly dirty = computed(() => this.savedText() !== null && this.sourceText() !== this.savedText());
  readonly sourceHasErrors = computed(() => hasErrors(this.sourceDiagnostics()));
  readonly canSaveSource = computed(
    () => !this.core.readOnly() && this.dirty() && !this.sourceSaving() && !this.sourceHasErrors() && !this.tooLarge(),
  );

  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private validateSequence = 0;

  ngOnDestroy(): void {
    this.clearValidateTimer();
  }

  /**
   * `true` when there are no unsaved source edits, or the user agrees to drop them. The library calls
   * this before switching the drawer to another file.
   */
  confirmDiscard(): boolean {
    if (!this.dirty()) {
      return true;
    }
    const media = this.core.media();
    const name = media?.displayName ?? media?.uid ?? 'this file';
    return window.confirm(`Discard your unsaved changes to "${name}"?`);
  }

  // ── Tabs ────────────────────────────────────────────────────────────────

  openTab(tab: MediaDrawerTab): void {
    this.core.tab.set(tab);
    if (tab === 'source' && this.savedText() !== null) {
      // The editor is recreated with the tab: seed it with the edits, not the loaded text.
      this.editorSeed.set(this.sourceText());
    } else if (tab === 'source' && !this.tooLarge()) {
      this.loadSource();
    } else if (tab === 'rendered') {
      this.loadRendered();
    }
  }

  /** Another file: forget the language picked for the Source tab. */
  resetLocaleChoice(): void {
    this.textLocaleChoice.set(null);
  }

  resetText(): void {
    this.clearValidateTimer();
    this.validateSequence++;
    this.savedText.set(null);
    this.sourceText.set('');
    this.editorSeed.set('');
    this.sourceDiagnostics.set([]);
    this.renderedText.set(null);
    this.renderedDiagnostics.set([]);
    this.conflict.set(null);
  }

  // ── Process toggle ──────────────────────────────────────────────────────

  onProcessToggle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    const uuid = this.core.media()?.uuid;
    const wanted = checkbox.checked;
    if (!uuid || this.core.readOnly()) {
      checkbox.checked = this.core.processCms();
      return;
    }
    this.togglingProcess.set(true);
    this.core.api
      .setMediaProcessCms(this.core.projectKey(), uuid, wanted, this.core.revision() ?? undefined)
      .subscribe({
        next: (response) => {
          const updated = response.media!;
          this.core.revision.set(updated.revision ?? null);
          this.core.processCms.set(updated.processCms ?? false);
          this.core.processDiagnostics.set(response.warnings ?? []);
          this.togglingProcess.set(false);
          this.core.toasts.show(wanted ? 'CMS processing switched on' : 'CMS processing switched off', 'success');
          this.core.emitUpdated(updated);
          this.renderedText.set(null);
          this.scheduleValidate(0);
        },
        error: (err: unknown) => {
          this.core.processDiagnostics.set(diagnosticsOf(err));
          this.togglingProcess.set(false);
          checkbox.checked = this.core.processCms();
        },
      });
  }

  // ── Source ──────────────────────────────────────────────────────────────

  loadSource(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.sourceLoading.set(true);
    this.core.api
      .mediaText(this.core.projectKey(), uuid, this.timeTravel.activeRevision(), this.textLocale())
      .subscribe({
        next: (view) => {
          const text = view.text ?? '';
          this.lineEnding.set(lineEndingOf(text));
          this.savedText.set(text);
          this.sourceText.set(text);
          this.editorSeed.set(text);
          this.sourceUtf8.set(view.utf8 ?? true);
          this.sourceDiagnostics.set([]);
          this.sourceLoading.set(false);
          this.scheduleValidate(0);
        },
        error: () => this.sourceLoading.set(false),
      });
  }

  /** An edit in the source editor (M33: a code editor — Tab inserts a tab character there). */
  onSourceInput(value: string): void {
    this.sourceText.set(withLineEnding(value, this.lineEnding()));
    this.scheduleValidate(VALIDATE_DEBOUNCE_MS);
  }

  /** The Source tab of localized text media edits one language's file. */
  onTextLocaleChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (!this.confirmDiscard()) {
      select.value = this.textLocale() ?? '';
      return;
    }
    this.textLocaleChoice.set(select.value || null);
    this.resetText();
    this.loadSource();
  }

  saveSource(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || !this.canSaveSource()) {
      return;
    }
    const text = this.sourceText();
    this.sourceSaving.set(true);
    this.core.api
      .saveMediaText(this.core.projectKey(), uuid, text, this.core.revision() ?? undefined, this.textLocale())
      .subscribe({
        next: (response) => {
          const updated = response.media!;
          const changed = updated.revision !== this.core.revision();
          this.core.revision.set(updated.revision ?? null);
          this.savedText.set(text);
          this.sourceDiagnostics.set(response.warnings ?? []);
          this.renderedText.set(null);
          this.sourceSaving.set(false);
          this.core.toasts.show(changed ? `Saved as revision ${updated.revision}` : 'No changes to save', 'success');
          this.core.emitUpdated(updated);
        },
        error: (err: unknown) => {
          this.sourceSaving.set(false);
          if (err instanceof HttpErrorResponse && err.status === 409) {
            this.conflict.set(this.conflictOf(err));
            return;
          }
          const diagnostics = diagnosticsOf(err);
          if (diagnostics.length > 0) {
            this.sourceDiagnostics.set(diagnostics);
          }
        },
      });
  }

  private conflictOf(err: HttpErrorResponse): ConflictInfo {
    const body = (err.error ?? {}) as Record<string, unknown>;
    return {
      expectedRevision: typeof body['expectedRevision'] === 'number' ? body['expectedRevision'] : (this.core.revision() ?? 0),
      currentRevision: typeof body['currentRevision'] === 'number' ? body['currentRevision'] : 0,
      detail: typeof body['detail'] === 'string' ? body['detail'] : undefined,
      changedBy: typeof body['changedBy'] === 'number' ? body['changedBy'] : undefined,
      changedAt: typeof body['changedAt'] === 'string' ? body['changedAt'] : undefined,
    };
  }

  /** Conflict: overwrite the newer revision with the editor content. */
  keepMineAfterConflict(): void {
    const conflict = this.conflict();
    if (!conflict) {
      return;
    }
    this.conflict.set(null);
    this.core.revision.set(conflict.currentRevision);
    this.saveSource();
  }

  /** Conflict: drop the editor content and load the newer revision. */
  takeTheirsAfterConflict(): void {
    const conflict = this.conflict();
    if (!conflict) {
      return;
    }
    this.conflict.set(null);
    this.core.revision.set(conflict.currentRevision);
    this.resetText();
    this.loadSource();
  }

  // ── Rendered ────────────────────────────────────────────────────────────

  loadRendered(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || !this.core.processCms()) {
      return;
    }
    this.renderedLoading.set(true);
    this.core.api.mediaRenderedText(this.core.projectKey(), uuid, this.timeTravel.activeRevision()).subscribe({
      next: (text) => {
        this.renderedText.set(text);
        this.renderedDiagnostics.set([]);
        this.renderedLoading.set(false);
      },
      error: (err: unknown) => {
        this.renderedText.set(null);
        this.renderedDiagnostics.set(diagnosticsOf(err));
        this.renderedLoading.set(false);
      },
    });
  }

  // ── Validation ──────────────────────────────────────────────────────────

  /** Live validation of the editor content while processing is on; stale answers are dropped. */
  private scheduleValidate(delayMs: number): void {
    this.clearValidateTimer();
    const uuid = this.core.media()?.uuid;
    if (!uuid || !this.core.processCms() || this.core.readOnly() || this.savedText() === null) {
      if (!this.core.processCms()) {
        this.sourceDiagnostics.set([]);
      }
      return;
    }
    this.validateTimer = setTimeout(() => {
      this.validateTimer = null;
      const sequence = ++this.validateSequence;
      this.core.api.validateMediaText(this.core.projectKey(), uuid, this.sourceText()).subscribe({
        next: (res) => {
          if (sequence === this.validateSequence) {
            this.sourceDiagnostics.set(res.diagnostics ?? []);
          }
        },
      });
    }, delayMs);
  }

  private clearValidateTimer(): void {
    if (this.validateTimer !== null) {
      clearTimeout(this.validateTimer);
      this.validateTimer = null;
    }
  }
}
