import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import {
  ChangeDetectionStrategy,
  Component,
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { problemOf } from '../../core/api/problem.util';
import { DialogService } from '../../core/ui/dialog.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { ConflictDrawerComponent } from '../pages/conflict-drawer.component';
import { SfAssetImpactComponent } from '../generation/insight/sf-asset-impact.component';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import type { ConflictInfo } from '../pages/types';
import { TimeTravelStore } from '../revisions/time-travel.store';
import {
  type LineEnding,
  TEXT_EDITOR_MAX_BYTES,
  VALIDATE_DEBOUNCE_MS,
  diagnosticsOf,
  hasErrors,
  lineEndingOf,
  positionLabel,
  withLineEnding,
} from './text-media.util';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { LocalesStore } from '../../core/project/locales.store';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfCodeEditorComponent } from '../../shared/code-editor/code-editor.component';
import { extensionOf, resolveCodeFormat } from '../../shared/code-editor/code-format';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import { ReleaseBarComponent } from '../release/release-bar.component';
import type { ReleaseMode } from '../release/release-choice.util';
import { STAYS_ONLINE_NOTE, deleteQuestion, isOnline } from '../release/release-status.util';
import {
  type DiscardedFile,
  type LocaleFileRow,
  discardedFilesText,
  localeFileRows,
} from './media-locale-files.util';

type MediaView = components['schemas']['MediaView'];
type MediaMetadataRequest = components['schemas']['MediaMetadataRequest'];
type FocalPointView = components['schemas']['FocalPointView'];
type UsageDto = components['schemas']['UsageDto'];
type Diagnostic = components['schemas']['Diagnostic'];
type MediaLocaleFileView = components['schemas']['MediaLocaleFileView'];

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
    SfAssetUrlsComponent,
    SfIconComponent,
    SfFileSizePipe,
    ReleaseBarComponent,
    SfCodeEditorComponent,
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
  /** Discard changes rewrote the draft (M27.6.1): the library reloads the file and reopens the drawer. */
  readonly discarded = output<string>();

  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  protected readonly dialog = inject(DialogService);
  /** The language alt text and caption are edited in (M24.4.1); `null` without languages. */
  protected readonly editingLocale = inject(EditingLocaleStore);

  /**
   * The value of the language being edited. An untranslated field shows empty rather than the
   * inherited text, so saving it can't silently copy another language's words into this one.
   */
  private localizedMetadata(
    byLocale: Record<string, string> | undefined | null,
    resolved: string | undefined | null,
  ): string {
    const locale = this.editingLocale.locale();
    if (!byLocale || !locale) {
      return resolved ?? '';
    }
    return byLocale[locale] ?? '';
  }
  private readonly timeTravel = inject(TimeTravelStore);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  protected readonly readOnlyLabel = inject(ProjectAccessStore).readOnlyLabel;

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

  /** Bumped whenever the form's value or its pristine state changes — a `FormGroup` is not a signal. */
  private readonly formChanged = signal(0);
  /** Unsaved edits to alt text, caption, copyright or focal point: what makes "Save metadata" worth pressing. */
  readonly metadataDirty = computed(() => {
    this.formChanged();
    return this.form.dirty;
  });

  readonly variants = computed(
    () => this.media()?.variants ?? [],
  );

  // ── Localized media (M27.6.4) ───────────────────────────────────────────

  protected readonly locales = inject(LocalesStore);
  /** The switch exists only in a project with languages. */
  protected readonly showLocalization = computed(() => this.locales.isLocalized());
  readonly localized = signal(false);
  readonly togglingLocalized = signal(false);
  /** Un-localizing would discard these files (`409 SF-MEDIA-0505`): asked before resending with `confirmDiscard`. */
  readonly discardPrompt = signal<DiscardedFile[] | null>(null);
  protected readonly discardPromptText = computed(() => discardedFilesText(this.discardPrompt() ?? []));
  /** The per-language files as `GET /media/{uuid}` resolves them, for a drawer opened from a list row (no `localeFiles`). */
  private readonly fetchedFiles = signal<Record<string, MediaLocaleFileView> | null>(null);
  private fetchedFilesKey: string | null = null;
  readonly fileRows = computed<LocaleFileRow[]>(() =>
    this.localized() && this.showLocalization()
      ? localeFileRows(this.media()?.localeFiles ?? this.fetchedFiles(), this.locales.locales(), this.locales.defaultLocale())
      : [],
  );
  /** The language whose file is being uploaded or removed. */
  readonly busyLocale = signal<string | null>(null);
  /** The row a file is dragged over. */
  readonly dragLocale = signal<string | null>(null);
  /** Object URLs of the own files' thumbnails, by language. */
  readonly localeThumbs = signal<Record<string, string>>({});
  private readonly localeThumbKeys = new Map<string, string>();
  /** The language the Source tab edits for localized text media; `null` follows the editing language. */
  private readonly textLocaleChoice = signal<string | null>(null);
  readonly textLocale = computed<string | null>(() =>
    this.localized() && this.showLocalization() ? (this.textLocaleChoice() ?? this.editingLocale.locale()) : null,
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

  private readonly sourceEditor = viewChild<SfCodeEditorComponent>('sourceEditor');
  private readonly projectContext = inject(ProjectContextStore);
  /**
   * How the source is highlighted (M33 follow-up): the project's overrides for the file's extension or MIME type,
   * else detected from them.
   */
  protected readonly sourceFormat = computed(() =>
    resolveCodeFormat({
      extension: extensionOf(this.media().fileName),
      mimeType: this.media().mimeType,
      overrides: this.projectContext.project()?.codeHighlighting,
    }),
  );
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private validateSequence = 0;

  /** Object URL for the fetched preview binary — `mediaBinaryUrl()` alone 401s when used as a
   * plain `<img src>`/`<a href>` (see `loadPreview`), so the preview image is fetched through
   * `HttpClient` (auth interceptor attached) and rendered from a local blob URL instead. */
  private readonly previewObjectUrl = signal<string | null>(null);
  private lastPreviewUuid: string | null = null;
  private lastTextUuid: string | null = null;
  private lastTimeTravelRevision: number | null = null;
  /** The language the alt text and caption fields currently hold; `null` before the first seed. */
  private lastEditingLocale: string | null = null;

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formChanged.update((n) => n + 1));
    effect(() => {
      const uuid = this.media()?.uuid;
      const key = this.projectKey();
      // Localized media previews the editing language's file (M27.6.4); a new file of it previews again.
      const locale = this.media()?.localized ? this.editingLocale.locale() : null;
      const previewKey = `${uuid}|${locale ?? ''}|${this.media()?.revision ?? ''}`;
      if (!uuid || !key || previewKey === this.lastPreviewUuid) {
        return;
      }
      this.lastPreviewUuid = previewKey;
      untracked(() => this.loadPreview(key, uuid, locale));
    });
    // A drawer opened from a list row has no `localeFiles`: the server resolves them, once per version.
    effect(() => {
      const media = this.media();
      const key = this.projectKey();
      const viewed = this.timeTravel.activeRevision();
      this.locales.config();
      untracked(() => this.loadLocaleFiles(key, media, viewed));
    });
    // Thumbnails of the languages that have their own image file, re-fetched only when that file changes.
    effect(() => {
      const rows = this.fileRows();
      const key = this.projectKey();
      const uuid = this.media()?.uuid;
      untracked(() => {
        if (uuid) {
          this.loadLocaleThumbs(key, uuid, rows);
        }
      });
    });
    // Another file: start over on its Details tab; the same file saved: follow its flag.
    effect(() => {
      const media = this.media();
      untracked(() => {
        if (media.uuid !== this.lastTextUuid) {
          this.lastTextUuid = media.uuid ?? null;
          this.revision.set(media.revision ?? null);
          // The library reuses this drawer when another file is picked: the form has to follow.
          this.seedForm(media);
          this.textLocaleChoice.set(null);
          this.processDiagnostics.set([]);
          this.resetText();
          this.tab.set('details');
        }
        this.processCms.set(media.processCms ?? false);
        this.localized.set(media.localized ?? false);
      });
    });
    // Alt text and caption are stored per language, so the two fields have to be re-seeded when
    // the editing language changes — otherwise they keep showing (and would save) the previous
    // language's words under the new one (M24.4.1). An unsaved draft of the language being left
    // behind is dropped: this drawer saves one language explicitly, and it was never going to be
    // written by a save made in another one.
    effect(() => {
      const locale = this.editingLocale.locale();
      untracked(() => {
        if (locale === this.lastEditingLocale) {
          return;
        }
        this.lastEditingLocale = locale;
        const media = this.media();
        this.form.patchValue({
          altText: this.localizedMetadata(media.altTextL10n, media.altText),
          caption: this.localizedMetadata(media.captionL10n, media.caption),
        });
        this.settleForm();
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
    this.lastEditingLocale = this.editingLocale.locale();
    this.seedForm(media);
    this.loadUsages();
  }

  /** Fills the metadata form from `media`; nothing is unsaved afterwards. */
  private seedForm(media: MediaView): void {
    this.form.reset({
      // `altTextL10n` holds every language; the form edits the one being worked in, falling back to
      // the resolved `altText` in a project without languages.
      altText: this.localizedMetadata(media.altTextL10n, media.altText),
      caption: this.localizedMetadata(media.captionL10n, media.caption),
      copyright: media.copyright ?? '',
      focalX: media.focalPoint?.x ?? null,
      focalY: media.focalPoint?.y ?? null,
    });
    this.settleForm();
  }

  /** Marks what the form holds as saved: nothing to save until the next edit. */
  private settleForm(): void {
    this.form.markAsPristine();
    this.formChanged.update((n) => n + 1);
  }

  ngOnDestroy(): void {
    const url = this.previewObjectUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    for (const thumb of Object.values(this.localeThumbs())) {
      URL.revokeObjectURL(thumb);
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

  private loadPreview(projectKey: string, uuid: string, locale: string | null): void {
    const previous = this.previewObjectUrl();
    this.api.mediaBinaryBlob(projectKey, uuid, undefined, locale).subscribe({
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
        // Alt text and caption belong to the language being edited (M24.4.1).
        this.editingLocale.locale() ?? undefined,
      )
      .subscribe({
        next: (updated) => {
          this.revision.set(updated.revision ?? null);
          this.settleForm();
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
    this.api.mediaText(this.projectKey(), uuid, this.timeTravel.activeRevision(), this.textLocale()).subscribe({
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

  /** Moves the caret to a diagnostic's position in the editor. */
  goToDiagnostic(diagnostic: Diagnostic): void {
    if (diagnostic.line) {
      this.sourceEditor()?.goTo(diagnostic.line, diagnostic.column ?? 1);
    }
  }

  saveSource(): void {
    const uuid = this.media()?.uuid;
    if (!uuid || !this.canSaveSource()) {
      return;
    }
    const text = this.sourceText();
    this.sourceSaving.set(true);
    this.api.saveMediaText(this.projectKey(), uuid, text, this.revision() ?? undefined, this.textLocale()).subscribe({
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
    const release = this.media()?.release;
    this.confirmText.set('');
    this.dialog.open({
      title: 'Delete media',
      message: referenced
        ? `This file is referenced by ${this.usages().length} asset(s). Deleting it will break those references.` +
          (isOnline(release) ? ` ${STAYS_ONLINE_NOTE}` : '') +
          ' Type DELETE to confirm.'
        : deleteQuestion('Delete this media file? This cannot be undone.', release),
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

  // ── Release (M27.6.1) ───────────────────────────────────────────────────

  protected onReleaseChanged(mode: ReleaseMode): void {
    const uuid = this.media()?.uuid;
    if (mode === 'discard' && uuid) {
      this.discarded.emit(uuid);
    }
  }

  // ── Localized media (M27.6.4) ───────────────────────────────────────────

  /** "Different file per language": on is immediate; off asks first when other languages have their own file. */
  onLocalizedToggle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    const wanted = checkbox.checked;
    checkbox.checked = this.localized();
    if (this.readOnly() || this.togglingLocalized()) {
      return;
    }
    this.sendLocalized(wanted, false);
  }

  confirmUnlocalize(): void {
    this.sendLocalized(false, true);
  }

  cancelUnlocalize(): void {
    this.discardPrompt.set(null);
  }

  private sendLocalized(localized: boolean, confirmDiscard: boolean): void {
    const uuid = this.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.togglingLocalized.set(true);
    this.api
      .setMediaLocalized(this.projectKey(), uuid, localized, confirmDiscard, this.revision() ?? undefined)
      .subscribe({
        next: (updated) => {
          this.togglingLocalized.set(false);
          this.discardPrompt.set(null);
          this.applyUpdated(updated);
          this.toasts.show(
            localized ? 'Each language can now have its own file' : 'One file for every language again',
            'success',
          );
        },
        error: (err: unknown) => {
          this.togglingLocalized.set(false);
          const body = (err instanceof HttpErrorResponse ? err.error : null) as
            | { code?: string; files?: DiscardedFile[] }
            | null;
          if (err instanceof HttpErrorResponse && err.status === 409 && body?.code === 'SF-MEDIA-0505') {
            this.discardPrompt.set(body.files ?? []);
          } else {
            this.toasts.show(problemOf(err, 'Could not change the file setting — try again in a moment.').detail, 'error');
          }
        },
      });
  }

  onLocaleFileInput(locale: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      this.uploadLocaleFile(locale, file);
    }
  }

  onLocaleDragOver(locale: string, event: DragEvent): void {
    if (this.readOnly() || !event.dataTransfer?.types.includes('Files')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    this.dragLocale.set(locale);
  }

  onLocaleDragLeave(locale: string): void {
    if (this.dragLocale() === locale) {
      this.dragLocale.set(null);
    }
  }

  onLocaleDrop(locale: string, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragLocale.set(null);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.uploadLocaleFile(locale, file);
    }
  }

  uploadLocaleFile(locale: string, file: File): void {
    const uuid = this.media()?.uuid;
    if (!uuid || this.readOnly() || this.busyLocale() || !this.confirmDiscard()) {
      return;
    }
    this.busyLocale.set(locale);
    this.api.putMediaLocaleFile(this.projectKey(), uuid, locale, file).subscribe({
      next: (response) => {
        this.busyLocale.set(null);
        this.resetText();
        this.processDiagnostics.set(response.warnings ?? []);
        this.toasts.show(`File for ${locale.toUpperCase()} saved`, 'success');
        this.applyUpdated(response.media!);
      },
      error: (err: unknown) => {
        this.busyLocale.set(null);
        this.processDiagnostics.set(diagnosticsOf(err));
      },
    });
  }

  removeLocaleFile(row: LocaleFileRow): void {
    const uuid = this.media()?.uuid;
    if (!uuid || this.readOnly() || row.isDefault || !row.own || this.busyLocale()) {
      return;
    }
    if (!window.confirm(`Remove the ${row.label} file? ${row.label} then uses the file it falls back to.`)) {
      return;
    }
    this.busyLocale.set(row.locale);
    this.api.removeMediaLocaleFile(this.projectKey(), uuid, row.locale).subscribe({
      next: (updated) => {
        this.busyLocale.set(null);
        this.resetText();
        this.toasts.show(`File for ${row.locale.toUpperCase()} removed`, 'success');
        this.applyUpdated(updated);
      },
      error: () => this.busyLocale.set(null),
    });
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

  private applyUpdated(updated: MediaView): void {
    this.revision.set(updated.revision ?? null);
    this.localized.set(updated.localized ?? false);
    this.updated.emit(updated);
  }

  private loadLocaleFiles(projectKey: string, media: MediaView, viewed: number | null): void {
    const uuid = media?.uuid;
    if (!uuid || !media.localized || media.localeFiles || !this.showLocalization()) {
      this.fetchedFilesKey = null;
      this.fetchedFiles.set(null);
      return;
    }
    const key = `${uuid}|${media.revision ?? ''}|${viewed ?? ''}|${this.locales.locales().length}`;
    if (key === this.fetchedFilesKey) {
      return;
    }
    this.fetchedFilesKey = key;
    this.api.mediaDetail(projectKey, uuid, viewed).subscribe({
      next: (detail) => {
        if (this.fetchedFilesKey === key) {
          this.fetchedFiles.set(detail.localeFiles ?? null);
        }
      },
      error: () => this.fetchedFiles.set(null),
    });
  }

  private loadLocaleThumbs(projectKey: string, uuid: string, rows: LocaleFileRow[]): void {
    const wanted = new Map(rows.filter((row) => row.own && row.isImage).map((row) => [row.locale, `${uuid}|${row.blobSha256}`]));
    const current = { ...this.localeThumbs() };
    let changed = false;
    for (const [locale, key] of [...this.localeThumbKeys]) {
      if (wanted.get(locale) !== key) {
        this.localeThumbKeys.delete(locale);
        if (current[locale]) {
          URL.revokeObjectURL(current[locale]);
          delete current[locale];
          changed = true;
        }
      }
    }
    if (changed) {
      this.localeThumbs.set(current);
    }
    for (const [locale, key] of wanted) {
      if (this.localeThumbKeys.get(locale) === key) {
        continue;
      }
      this.localeThumbKeys.set(locale, key);
      this.api.mediaThumbnailBlob(projectKey, uuid, locale).subscribe({
        next: (blob) => {
          if (this.localeThumbKeys.get(locale) === key) {
            this.localeThumbs.update((map) => ({ ...map, [locale]: URL.createObjectURL(blob) }));
          }
        },
        error: () => this.localeThumbKeys.delete(locale),
      });
    }
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
