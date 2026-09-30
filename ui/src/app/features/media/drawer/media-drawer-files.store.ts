import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import { diagnosticsOf } from '../text-media.util';
import {
  type DiscardedFile,
  type LocaleFileRow,
  discardedFilesText,
  localeFileRows,
} from '../media-locale-files.util';
import { MediaDrawerStore, type MediaView } from './media-drawer.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';

type MediaLocaleFileView = components['schemas']['MediaLocaleFileView'];

/** Replacing the file and the files per language of localized media (M27.6.4). */
@Injectable()
export class MediaDrawerFilesStore implements OnDestroy {
  private readonly core = inject(MediaDrawerStore);
  private readonly text = inject(MediaDrawerTextStore);

  readonly replacing = signal(false);
  readonly togglingLocalized = signal(false);
  /** Un-localizing would discard these files (`409 SF-MEDIA-0505`): asked before resending with `confirmDiscard`. */
  readonly discardPrompt = signal<DiscardedFile[] | null>(null);
  readonly discardPromptText = computed(() => discardedFilesText(this.discardPrompt() ?? []));
  /** The per-language files as `GET /media/{uuid}` resolves them, for a drawer opened from a list row (no `localeFiles`). */
  private readonly fetchedFiles = signal<Record<string, MediaLocaleFileView> | null>(null);
  private fetchedFilesKey: string | null = null;
  readonly fileRows = computed<LocaleFileRow[]>(() =>
    this.core.localized() && this.core.showLocalization()
      ? localeFileRows(
          this.core.media()?.localeFiles ?? this.fetchedFiles(),
          this.core.locales.locales(),
          this.core.locales.defaultLocale(),
        )
      : [],
  );
  /** The language whose file is being uploaded or removed. */
  readonly busyLocale = signal<string | null>(null);
  /** The row a file is dragged over. */
  readonly dragLocale = signal<string | null>(null);
  /** Object URLs of the own files' thumbnails, by language. */
  readonly localeThumbs = signal<Record<string, string>>({});
  private readonly localeThumbKeys = new Map<string, string>();

  ngOnDestroy(): void {
    for (const thumb of Object.values(this.localeThumbs())) {
      URL.revokeObjectURL(thumb);
    }
  }

  // ── Replace ─────────────────────────────────────────────────────────────

  onReplaceFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const uuid = this.core.media()?.uuid;
    if (!file || !uuid || this.core.readOnly() || !this.text.confirmDiscard()) {
      input.value = '';
      return;
    }
    this.replacing.set(true);
    this.core.api.replaceMedia(this.core.projectKey(), uuid, file).subscribe({
      next: (response) => {
        const updated = response.media!;
        this.core.revision.set(updated.revision ?? null);
        this.text.resetText();
        this.core.processDiagnostics.set(response.warnings ?? []);
        this.core.toasts.show(
          response.processCmsCleared
            ? 'Media replaced — CMS processing was switched off because the new file is not text'
            : 'Media replaced',
          response.processCmsCleared ? 'warning' : 'success',
        );
        this.replacing.set(false);
        this.core.emitUpdated(updated);
        if (!updated.textEditable) {
          this.core.tab.set('details');
        }
        input.value = '';
      },
      error: (err: unknown) => {
        this.core.processDiagnostics.set(diagnosticsOf(err));
        this.replacing.set(false);
        input.value = '';
      },
    });
  }

  // ── Different file per language ─────────────────────────────────────────

  /** "Different file per language": on is immediate; off asks first when other languages have their own file. */
  onLocalizedToggle(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    const wanted = checkbox.checked;
    checkbox.checked = this.core.localized();
    if (this.core.readOnly() || this.togglingLocalized()) {
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
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.togglingLocalized.set(true);
    this.core.api
      .setMediaLocalized(this.core.projectKey(), uuid, localized, confirmDiscard, this.core.revision() ?? undefined)
      .subscribe({
        next: (updated) => {
          this.togglingLocalized.set(false);
          this.discardPrompt.set(null);
          this.core.applyUpdated(updated);
          this.core.toasts.show(
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
            this.core.toasts.show(
              problemOf(err, 'Could not change the file setting — try again in a moment.').detail,
              'error',
            );
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
    if (this.core.readOnly() || !event.dataTransfer?.types.includes('Files')) {
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
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly() || this.busyLocale() || !this.text.confirmDiscard()) {
      return;
    }
    this.busyLocale.set(locale);
    this.core.api.putMediaLocaleFile(this.core.projectKey(), uuid, locale, file).subscribe({
      next: (response) => {
        this.busyLocale.set(null);
        this.text.resetText();
        this.core.processDiagnostics.set(response.warnings ?? []);
        this.core.toasts.show(`File for ${locale.toUpperCase()} saved`, 'success');
        this.core.applyUpdated(response.media!);
      },
      error: (err: unknown) => {
        this.busyLocale.set(null);
        this.core.processDiagnostics.set(diagnosticsOf(err));
      },
    });
  }

  removeLocaleFile(row: LocaleFileRow): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly() || row.isDefault || !row.own || this.busyLocale()) {
      return;
    }
    if (!window.confirm(`Remove the ${row.label} file? ${row.label} then uses the file it falls back to.`)) {
      return;
    }
    this.busyLocale.set(row.locale);
    this.core.api.removeMediaLocaleFile(this.core.projectKey(), uuid, row.locale).subscribe({
      next: (updated: MediaView) => {
        this.busyLocale.set(null);
        this.text.resetText();
        this.core.toasts.show(`File for ${row.locale.toUpperCase()} removed`, 'success');
        this.core.applyUpdated(updated);
      },
      error: () => this.busyLocale.set(null),
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  /** A drawer opened from a list row has no `localeFiles`: the server resolves them, once per version. */
  loadLocaleFiles(projectKey: string, media: MediaView, viewed: number | null): void {
    const uuid = media?.uuid;
    if (!uuid || !media.localized || media.localeFiles || !this.core.showLocalization()) {
      this.fetchedFilesKey = null;
      this.fetchedFiles.set(null);
      return;
    }
    const key = `${uuid}|${media.revision ?? ''}|${viewed ?? ''}|${this.core.locales.locales().length}`;
    if (key === this.fetchedFilesKey) {
      return;
    }
    this.fetchedFilesKey = key;
    this.core.api.mediaDetail(projectKey, uuid, viewed).subscribe({
      next: (detail) => {
        if (this.fetchedFilesKey === key) {
          this.fetchedFiles.set(detail.localeFiles ?? null);
        }
      },
      error: () => this.fetchedFiles.set(null),
    });
  }

  /** Thumbnails of the languages that have their own image file, re-fetched only when that file changes. */
  loadLocaleThumbs(projectKey: string, uuid: string, rows: LocaleFileRow[]): void {
    const wanted = new Map(
      rows.filter((row) => row.own && row.isImage).map((row) => [row.locale, `${uuid}|${row.blobSha256}`]),
    );
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
      this.core.api.mediaThumbnailBlob(projectKey, uuid, locale).subscribe({
        next: (blob) => {
          if (this.localeThumbKeys.get(locale) === key) {
            this.localeThumbs.update((map) => ({ ...map, [locale]: URL.createObjectURL(blob) }));
          }
        },
        error: () => this.localeThumbKeys.delete(locale),
      });
    }
  }
}
