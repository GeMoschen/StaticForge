import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, OnDestroy, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SaveResult } from '../../../shared/components/dialog/unsaved-changes.service';
import { UnsavedChangesService } from '../../../shared/components/dialog/unsaved-changes.service';
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
import { type Diagnostic, MediaDrawerStore } from './media-drawer.store';

/**
 * Text media (M18.4.1): the Source tab's text with live validation and its save (with the conflict flow), the Rendered
 * tab's output, the "Process CMS syntax" switch and the findings of the Processing tab. `savedText` is also what the
 * Details tab previews for a text file.
 */
@Injectable()
export class MediaDrawerTextStore implements OnDestroy {
  private readonly core = inject(MediaDrawerStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly injector = inject(Injector);

  readonly togglingProcess = signal(false);

  /** The file content as last loaded or saved; `null` until it was read. */
  readonly savedText = signal<string | null>(null);
  /** The editor content, with the file's own line endings. */
  readonly sourceText = signal('');
  /** What the editor is (re)initialized with — only on load, never while typing (keeps the caret). */
  readonly editorSeed = signal('');
  /** Counts the times the editor has to be created anew with the saved text (Revert): the seed alone may not change. */
  readonly editorEpoch = signal(0);
  readonly lineEnding = signal<LineEnding>('LF');
  readonly sourceUtf8 = signal(true);
  readonly sourceLoading = signal(false);
  readonly sourceFailed = signal(false);
  readonly sourceSaving = signal(false);
  readonly sourceDiagnostics = signal<Diagnostic[]>([]);
  readonly conflict = signal<ConflictInfo | null>(null);

  readonly renderedText = signal<string | null>(null);
  readonly renderedLoading = signal(false);
  readonly renderedDiagnostics = signal<Diagnostic[]>([]);

  /** The findings of checking the saved text now (Processing tab); `null` before the check ran. */
  readonly checkedDiagnostics = signal<Diagnostic[] | null>(null);
  readonly checking = signal(false);

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
  private checkSequence = 0;

  ngOnDestroy(): void {
    this.clearValidateTimer();
  }

  /** Another file, a new file or another revision: forget everything read. */
  resetText(): void {
    this.clearValidateTimer();
    this.validateSequence++;
    this.checkSequence++;
    this.savedText.set(null);
    this.sourceText.set('');
    this.editorSeed.set('');
    this.sourceDiagnostics.set([]);
    this.sourceFailed.set(false);
    this.renderedText.set(null);
    this.renderedDiagnostics.set([]);
    this.checkedDiagnostics.set(null);
    this.conflict.set(null);
  }

  /** Another file: forget the language picked for the Source tab. */
  resetLocaleChoice(): void {
    this.textLocaleChoice.set(null);
  }

  /** Drops the unsaved source edits (Revert, Discard in the leave dialog). */
  revert(): void {
    const saved = this.savedText();
    if (saved === null) {
      return;
    }
    this.clearValidateTimer();
    this.sourceText.set(saved);
    this.editorSeed.set(saved);
    this.editorEpoch.update((epoch) => epoch + 1);
    this.conflict.set(null);
    this.scheduleValidate(0);
  }

  // ── Process toggle ──────────────────────────────────────────────────────

  /** Switches CMS processing on or off. The answer's warnings (or the 422's diagnostics) are the last attempt's findings. */
  async setProcess(wanted: boolean): Promise<void> {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly() || this.togglingProcess()) {
      return;
    }
    this.togglingProcess.set(true);
    try {
      const response = await firstValueFrom(
        this.core.api.setMediaProcessCms(this.core.projectKey(), uuid, wanted, this.core.revision() ?? undefined),
      );
      const updated = response.media!;
      this.core.processDiagnostics.set(response.warnings ?? []);
      this.checkedDiagnostics.set(null);
      this.core.toasts.show(this.core.t(wanted ? 'processing.switchedOn' : 'processing.switchedOff'), 'success');
      this.core.applyUpdated(updated);
      this.renderedText.set(null);
      this.scheduleValidate(0);
    } catch (err) {
      this.core.processDiagnostics.set(diagnosticsOf(err));
    } finally {
      this.togglingProcess.set(false);
    }
  }

  // ── Source ──────────────────────────────────────────────────────────────

  /**
   * Reads the saved text unless it is known, and puts what the editor holds (unsaved edits included) in front of the
   * editor that is about to be created.
   */
  ensureLoaded(): void {
    if (!this.core.textEditable() || this.tooLarge()) {
      return;
    }
    if (this.savedText() !== null) {
      this.editorSeed.set(this.sourceText());
    } else if (!this.sourceLoading()) {
      this.loadSource();
    }
  }

  loadSource(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.sourceLoading.set(true);
    this.sourceFailed.set(false);
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
        error: () => {
          this.sourceLoading.set(false);
          this.sourceFailed.set(true);
        },
      });
  }

  /** An edit in the source editor (M33: a code editor — Tab inserts a tab character there). */
  onSourceInput(value: string): void {
    this.sourceText.set(withLineEnding(value, this.lineEnding()));
    this.scheduleValidate(VALIDATE_DEBOUNCE_MS);
  }

  /** The Source tab of localized text media edits one language's file; unsaved edits are asked about first. */
  async pickTextLocale(locale: string | null): Promise<void> {
    if (locale === this.textLocale()) {
      return;
    }
    if (this.dirty() && !(await this.confirmLeave())) {
      return;
    }
    this.textLocaleChoice.set(locale);
    this.resetText();
    this.loadSource();
  }

  /** The leave dialog for unsaved source edits (Save / Discard / Cancel); `true` when the person may go on. */
  confirmLeave(): Promise<boolean> {
    const media = this.core.media();
    return this.unsaved.confirmLeave({
      name: media?.displayName ?? media?.uid ?? '',
      save: () => this.saveSource(),
      discard: () => this.revert(),
      injector: this.injector,
    });
  }

  async saveSource(): Promise<SaveResult> {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return { ok: false, message: '' };
    }
    if (this.core.readOnly()) {
      return { ok: false, message: this.core.readOnlyLabel() };
    }
    if (this.sourceHasErrors()) {
      return { ok: false, message: this.core.t('source.fixErrors') };
    }
    if (!this.canSaveSource()) {
      return { ok: true };
    }
    const text = this.sourceText();
    this.sourceSaving.set(true);
    try {
      const response = await firstValueFrom(
        this.core.api.saveMediaText(this.core.projectKey(), uuid, text, this.core.revision() ?? undefined, this.textLocale()),
      );
      const updated = response.media!;
      const changed = updated.revision !== this.core.revision();
      this.savedText.set(text);
      this.sourceDiagnostics.set(response.warnings ?? []);
      this.renderedText.set(null);
      this.checkedDiagnostics.set(null);
      this.core.toasts.show(
        changed ? this.core.t('source.savedRevision', { revision: updated.revision }) : this.core.t('source.nothingChanged'),
        'success',
      );
      this.core.applyUpdated(updated);
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        this.conflict.set(this.conflictOf(err));
        return { ok: false, message: this.core.t('source.conflict') };
      }
      const diagnostics = diagnosticsOf(err);
      if (diagnostics.length > 0) {
        this.sourceDiagnostics.set(diagnostics);
      }
      return { ok: false, message: this.core.t('source.notSaved') };
    } finally {
      this.sourceSaving.set(false);
    }
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
    void this.saveSource();
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
    this.core.loadDetail();
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

  /**
   * The Processing tab's findings: the saved text checked now (`POST text/validate`), as the backend keeps no record of
   * the last attempt. Needs the saved text, which is read first.
   */
  checkProcessing(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || !this.core.processCms() || this.core.readOnly()) {
      return;
    }
    const sequence = ++this.checkSequence;
    const validate = (text: string) => {
      this.checking.set(true);
      this.core.api.validateMediaText(this.core.projectKey(), uuid, text).subscribe({
        next: (res) => {
          if (sequence === this.checkSequence) {
            this.checkedDiagnostics.set(res.diagnostics ?? []);
            this.checking.set(false);
          }
        },
        error: () => {
          if (sequence === this.checkSequence) {
            this.checking.set(false);
          }
        },
      });
    };
    const saved = this.savedText();
    if (saved !== null) {
      validate(saved);
      return;
    }
    this.checking.set(true);
    this.core.api.mediaText(this.core.projectKey(), uuid, this.timeTravel.activeRevision(), this.textLocale()).subscribe({
      next: (view) => {
        if (sequence === this.checkSequence) {
          validate(view.text ?? '');
        }
      },
      error: () => {
        if (sequence === this.checkSequence) {
          this.checking.set(false);
        }
      },
    });
  }

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
