import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { ConflictDrawerComponent } from '../pages/conflict-drawer.component';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import type { ConflictInfo } from '../pages/types';
import { TimeTravelStore } from '../revisions/time-travel.store';
import {
  type LineEnding,
  TEXT_EDITOR_MAX_BYTES,
  VALIDATE_DEBOUNCE_MS,
  diagnosticsOf,
  hasErrors,
  insertTab,
  lineEndingOf,
  offsetForPosition,
  positionLabel,
  withLineEnding,
} from './text-media.util';

type MediaView = components['schemas']['MediaView'];
type MediaMetadataRequest = components['schemas']['MediaMetadataRequest'];
type FocalPointView = components['schemas']['FocalPointView'];
type UsageDto = components['schemas']['UsageDto'];
type Diagnostic = components['schemas']['Diagnostic'];

/** Details for every file; Source and Rendered for text media (M18.4.1). */
export type MediaDrawerTab = 'details' | 'source' | 'rendered';

@Component({
  selector: 'sf-media-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SfFieldComponent,
    SfButtonComponent,
    ConflictDrawerComponent,
    SfAssetImpactComponent,
  ],
  templateUrl: './media-detail-drawer.component.html',
  styleUrl: './media-detail-drawer.component.scss',
})
export class MediaDetailDrawerComponent implements OnInit, OnDestroy {
  readonly projectKey = input.required<string>();
  readonly media = input.required<MediaView>();

  readonly closed = output<void>();
  readonly updated = output<MediaView>();
  readonly deleted = output<string>();

  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  protected readonly dialog = inject(DialogService);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  protected readonly DELETE_TOKEN = 'DELETE';

  readonly revision = signal<number | null>(null);
  readonly usages = signal<UsageDto[]>([]);
  readonly usagesLoading = signal(false);
  readonly saving = signal(false);
  readonly replacing = signal(false);
  readonly deleting = signal(false);
  readonly confirmText = signal('');

  readonly form = new FormGroup({
    altText: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    caption: new FormControl('', { nonNullable: true }),
    copyright: new FormControl('', { nonNullable: true }),
    focalX: new FormControl<number | null>(null),
    focalY: new FormControl<number | null>(null),
  });

  readonly variants = computed(
    () => this.media()?.variants ?? [],
  );

  // ── Text media (M18.4.1) ────────────────────────────────────────────────

  protected readonly positionLabel = positionLabel;

  readonly tab = signal<MediaDrawerTab>('details');
  readonly textEditable = computed(() => this.media()?.textEditable ?? false);
  readonly processCms = signal(false);
  readonly togglingProcess = signal(false);
  /** Warnings and errors of the last switch-on attempt. */
  readonly processDiagnostics = signal<Diagnostic[]>([]);

  /** The file content as last loaded or saved; `null` until the Source tab loads it. */
  readonly savedText = signal<string | null>(null);
  /** The editor content, with the file's own line endings. */
  readonly sourceText = signal('');
  /** What the textarea is (re)initialized with — only on load, never while typing (keeps the caret). */
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

  readonly tooLarge = computed(() => (this.media()?.sizeBytes ?? 0) > TEXT_EDITOR_MAX_BYTES);
  readonly dirty = computed(() => this.savedText() !== null && this.sourceText() !== this.savedText());
  readonly sourceHasErrors = computed(() => hasErrors(this.sourceDiagnostics()));
  readonly canSaveSource = computed(
    () => !this.readOnly() && this.dirty() && !this.sourceSaving() && !this.sourceHasErrors() && !this.tooLarge(),
  );

  private readonly sourceArea = viewChild<ElementRef<HTMLTextAreaElement>>('sourceArea');
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private validateSequence = 0;

  /** Object URL for the fetched preview binary — `mediaBinaryUrl()` alone 401s when used as a
   * plain `<img src>`/`<a href>` (see `loadPreview`), so the preview image is fetched through
   * `HttpClient` (auth interceptor attached) and rendered from a local blob URL instead. */
  private readonly previewObjectUrl = signal<string | null>(null);
  private lastPreviewUuid: string | null = null;
  private lastTextUuid: string | null = null;
  private lastTimeTravelRevision: number | null = null;

  constructor() {
    effect(() => {
      const uuid = this.media()?.uuid;
      const key = this.projectKey();
      if (!uuid || !key || uuid === this.lastPreviewUuid) {
        return;
      }
      this.lastPreviewUuid = uuid;
      untracked(() => this.loadPreview(key, uuid));
    });
    // Another file: start over on its Details tab; the same file saved: follow its flag.
    effect(() => {
      const media = this.media();
      untracked(() => {
        if (media.uuid !== this.lastTextUuid) {
          this.lastTextUuid = media.uuid ?? null;
          this.revision.set(media.revision ?? null);
          this.processDiagnostics.set([]);
          this.resetText();
          this.tab.set('details');
        }
        this.processCms.set(media.processCms ?? false);
      });
    });
    // Entering or leaving time travel shows the file at the viewed revision.
    effect(() => {
      const viewed = this.timeTravel.activeRevision();
      untracked(() => {
        if (viewed === this.lastTimeTravelRevision) {
          return;
        }
        this.lastTimeTravelRevision = viewed;
        this.resetText();
        this.openTab(this.tab());
      });
    });
  }

  ngOnInit(): void {
    const media = this.media();
    this.revision.set(media.revision ?? null);
    this.form.reset({
      altText: media.altText ?? '',
      caption: media.caption ?? '',
      copyright: media.copyright ?? '',
      focalX: media.focalPoint?.x ?? null,
      focalY: media.focalPoint?.y ?? null,
    });
    this.loadUsages();
  }

  ngOnDestroy(): void {
    const url = this.previewObjectUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.clearValidateTimer();
  }

  previewUrl(): string {
    return this.previewObjectUrl() ?? '';
  }

  /** Fetches a variant's binary through `HttpClient` (see `loadPreview`) and triggers a
   * client-side download from a short-lived blob URL — a plain `<a href download>` pointed at
   * `mediaBinaryUrl()` would 401 the same way the old `<img src>` preview did. */
  downloadVariant(variantName?: string): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.api.mediaBinaryBlob(this.projectKey(), uuid, variantName).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = variantName ?? this.media()?.fileName ?? this.media()?.uid ?? 'download';
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toasts.show('Could not download — try again in a moment.', 'error'),
    });
  }

  private loadPreview(projectKey: string, uuid: string): void {
    const previous = this.previewObjectUrl();
    this.api.mediaBinaryBlob(projectKey, uuid).subscribe({
      next: (blob) => {
        this.previewObjectUrl.set(URL.createObjectURL(blob));
        if (previous) {
          URL.revokeObjectURL(previous);
        }
      },
      error: () => this.previewObjectUrl.set(null),
    });
  }

  focalPosition(): string | null {
    const fp = this.media()?.focalPoint;
    if (fp == null || fp.x == null || fp.y == null) {
      return null;
    }
    const x = Math.round(fp.x * 1000) / 10;
    const y = Math.round(fp.y * 1000) / 10;
    return `${x}% ${y}%`;
  }

  closeDrawer(): void {
    if (!this.confirmDiscard()) {
      return;
    }
    this.closed.emit();
  }

  /**
   * `true` when there are no unsaved source edits, or the user agrees to drop them. The library calls
   * this before switching the drawer to another file.
   */
  confirmDiscard(): boolean {
    if (!this.dirty()) {
      return true;
    }
    const name = this.media()?.displayName ?? this.media()?.uid ?? 'this file';
    return window.confirm(`Discard your unsaved changes to "${name}"?`);
  }

  save(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toasts.show('Alt text is required before publishing', 'warning');
      return;
    }
    const focalX = this.form.controls.focalX.value;
    const focalY = this.form.controls.focalY.value;
    const hasFocal = focalX !== null || focalY !== null;
    const payload: MediaMetadataRequest = {
      altText: this.form.controls.altText.value,
      caption: this.form.controls.caption.value,
      copyright: this.form.controls.copyright.value,
      focalPoint: hasFocal
        ? ({ x: focalX ?? undefined, y: focalY ?? undefined } as FocalPointView)
        : undefined,
    };
    this.saving.set(true);
    this.api
      .updateMediaMetadata(
        this.projectKey(),
        uuid,
        payload,
        this.revision() ?? undefined,
      )
      .subscribe({
        next: (updated) => {
          this.revision.set(updated.revision ?? null);
          this.toasts.show('Metadata saved', 'success');
          this.saving.set(false);
          this.updated.emit(updated);
        },
        error: () => this.saving.set(false),
      });
  }

  onReplaceFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const uuid = this.media()?.uuid;
    if (!file || !uuid || this.readOnly() || !this.confirmDiscard()) {
      input.value = '';
      return;
    }
    this.replacing.set(true);
    this.api.replaceMedia(this.projectKey(), uuid, file).subscribe({
      next: (response) => {
        const updated = response.media!;
        this.revision.set(updated.revision ?? null);
        this.resetText();
        this.processDiagnostics.set(response.warnings ?? []);
        this.toasts.show(
          response.processCmsCleared
            ? 'Media replaced — CMS processing was switched off because the new file is not text'
            : 'Media replaced',
          response.processCmsCleared ? 'warning' : 'success',
        );
        this.replacing.set(false);
        this.updated.emit(updated);
        if (!updated.textEditable) {
          this.tab.set('details');
        }
        input.value = '';
      },
      error: (err: unknown) => {
        this.processDiagnostics.set(diagnosticsOf(err));
        this.replacing.set(false);
        input.value = '';
      },
    });
  }

  // ── Tabs ────────────────────────────────────────────────────────────────

  openTab(tab: MediaDrawerTab): void {
    this.tab.set(tab);
    if (tab === 'source' && this.savedText() !== null) {
      // The textarea is recreated with the tab: seed it with the edits, not the loaded text.
      this.editorSeed.set(this.sourceText());
    } else if (tab === 'source' && !this.tooLarge()) {
      this.loadSource();
    } else if (tab === 'rendered') {
      this.loadRendered();
    }
  }

  // ── Process toggle ──────────────────────────────────────────────────────

  onProcessToggle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    const uuid = this.media()?.uuid;
    const wanted = checkbox.checked;
    if (!uuid || this.readOnly()) {
      checkbox.checked = this.processCms();
      return;
    }
    this.togglingProcess.set(true);
    this.api.setMediaProcessCms(this.projectKey(), uuid, wanted, this.revision() ?? undefined).subscribe({
      next: (response) => {
        const updated = response.media!;
        this.revision.set(updated.revision ?? null);
        this.processCms.set(updated.processCms ?? false);
        this.processDiagnostics.set(response.warnings ?? []);
        this.togglingProcess.set(false);
        this.toasts.show(wanted ? 'CMS processing switched on' : 'CMS processing switched off', 'success');
        this.updated.emit(updated);
        this.renderedText.set(null);
        this.scheduleValidate(0);
      },
      error: (err: unknown) => {
        this.processDiagnostics.set(diagnosticsOf(err));
        this.togglingProcess.set(false);
        checkbox.checked = this.processCms();
      },
    });
  }

  // ── Source ──────────────────────────────────────────────────────────────

  loadSource(): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.sourceLoading.set(true);
    this.api.mediaText(this.projectKey(), uuid, this.timeTravel.activeRevision()).subscribe({
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

  onSourceInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.sourceText.set(withLineEnding(value, this.lineEnding()));
    this.scheduleValidate(VALIDATE_DEBOUNCE_MS);
  }

  /** Tab inserts a tab character instead of leaving the editor. */
  onSourceKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.shiftKey || this.readOnly()) {
      return;
    }
    event.preventDefault();
    const area = event.target as HTMLTextAreaElement;
    const next = insertTab(area.value, area.selectionStart, area.selectionEnd);
    area.value = next.value;
    area.setSelectionRange(next.caret, next.caret);
    this.sourceText.set(withLineEnding(next.value, this.lineEnding()));
    this.scheduleValidate(VALIDATE_DEBOUNCE_MS);
  }

  /** Moves the caret to a diagnostic's position in the editor. */
  goToDiagnostic(diagnostic: Diagnostic): void {
    const area = this.sourceArea()?.nativeElement;
    if (!area || !diagnostic.line) {
      return;
    }
    const offset = offsetForPosition(area.value, diagnostic.line, diagnostic.column ?? 0);
    area.focus();
    area.setSelectionRange(offset, offset);
  }

  saveSource(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || !this.canSaveSource()) {
      return;
    }
    const text = this.sourceText();
    this.sourceSaving.set(true);
    this.api.saveMediaText(this.projectKey(), uuid, text, this.revision() ?? undefined).subscribe({
      next: (response) => {
        const updated = response.media!;
        const changed = updated.revision !== this.revision();
        this.revision.set(updated.revision ?? null);
        this.savedText.set(text);
        this.sourceDiagnostics.set(response.warnings ?? []);
        this.renderedText.set(null);
        this.sourceSaving.set(false);
        this.toasts.show(changed ? `Saved as revision ${updated.revision}` : 'No changes to save', 'success');
        this.updated.emit(updated);
      },
      error: (err: unknown) => {
        this.sourceSaving.set(false);
        if (err instanceof HttpErrorResponse && err.status === 409) {
          const body = (err.error ?? {}) as Record<string, unknown>;
          this.conflict.set({
            expectedRevision: typeof body['expectedRevision'] === 'number' ? body['expectedRevision'] : (this.revision() ?? 0),
            currentRevision: typeof body['currentRevision'] === 'number' ? body['currentRevision'] : 0,
            detail: typeof body['detail'] === 'string' ? body['detail'] : undefined,
            changedBy: typeof body['changedBy'] === 'number' ? body['changedBy'] : undefined,
            changedAt: typeof body['changedAt'] === 'string' ? body['changedAt'] : undefined,
          });
          return;
        }
        const diagnostics = diagnosticsOf(err);
        if (diagnostics.length > 0) {
          this.sourceDiagnostics.set(diagnostics);
        }
      },
    });
  }

  /** Conflict: overwrite the newer revision with the editor content. */
  keepMineAfterConflict(): void {
    const conflict = this.conflict();
    if (!conflict) {
      return;
    }
    this.conflict.set(null);
    this.revision.set(conflict.currentRevision);
    this.saveSource();
  }

  /** Conflict: drop the editor content and load the newer revision. */
  takeTheirsAfterConflict(): void {
    const conflict = this.conflict();
    if (!conflict) {
      return;
    }
    this.conflict.set(null);
    this.revision.set(conflict.currentRevision);
    this.resetText();
    this.loadSource();
  }

  // ── Rendered ────────────────────────────────────────────────────────────

  loadRendered(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || !this.processCms()) {
      return;
    }
    this.renderedLoading.set(true);
    this.api.mediaRenderedText(this.projectKey(), uuid, this.timeTravel.activeRevision()).subscribe({
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

  // ── Delete ──────────────────────────────────────────────────────────────

  confirmDelete(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    const referenced = this.usages().length > 0;
    this.confirmText.set('');
    this.dialog.open({
      title: 'Delete media',
      message: referenced
        ? `This file is referenced by ${this.usages().length} asset(s). Deleting it will break those references. Type DELETE to confirm.`
        : 'Delete this media file? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      kind: 'danger',
    });
  }

  canConfirmDelete(): boolean {
    return this.usages().length === 0 || this.confirmText().trim() === this.DELETE_TOKEN;
  }

  onDeleteInput(event: Event): void {
    this.confirmText.set((event.target as HTMLInputElement).value);
  }

  cancelDelete(): void {
    this.dialog.close();
    this.confirmText.set('');
  }

  performDelete(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || !this.canConfirmDelete() || this.deleting() || this.readOnly()) {
      return;
    }
    this.deleting.set(true);
    this.api.deleteAsset(this.projectKey(), uuid).subscribe({
      next: () => {
        this.toasts.show('Media deleted', 'success');
        this.deleting.set(false);
        this.dialog.close();
        this.confirmText.set('');
        this.deleted.emit(uuid);
      },
      error: () => {
        this.deleting.set(false);
        this.toasts.show('Could not delete media — it may still be referenced by a page or template.', 'error');
      },
    });
  }

  private loadUsages(): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.usagesLoading.set(true);
    this.api.assetUsages(this.projectKey(), uuid).subscribe({
      next: (usages) => {
        this.usages.set(usages ?? []);
        this.usagesLoading.set(false);
      },
      error: () => this.usagesLoading.set(false),
    });
  }

  private resetText(): void {
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

  /** Live validation of the editor content while processing is on; stale answers are dropped. */
  private scheduleValidate(delayMs: number): void {
    this.clearValidateTimer();
    const uuid = this.media()?.uuid;
    if (!uuid || !this.processCms() || this.readOnly() || this.savedText() === null) {
      if (!this.processCms()) {
        this.sourceDiagnostics.set([]);
      }
      return;
    }
    this.validateTimer = setTimeout(() => {
      this.validateTimer = null;
      const sequence = ++this.validateSequence;
      this.api.validateMediaText(this.projectKey(), uuid, this.sourceText()).subscribe({
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
