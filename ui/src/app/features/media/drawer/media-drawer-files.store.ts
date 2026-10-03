import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, OnDestroy, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../../core/api/problem.util';
import { diagnosticsOf } from '../text-media.util';
import {
  type DiscardedFile,
  type LocaleFileRow,
  discardedFilesText,
  localeFileRows,
} from '../media-locale-files.util';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { MediaDrawerStore, type MediaView } from './media-drawer.store';
import { MediaDrawerTextStore } from './media-drawer-text.store';


/** Replacing the file and the files per language of localized media (M27.6.4). */
@Injectable()
export class MediaDrawerFilesStore implements OnDestroy {
  private readonly core = inject(MediaDrawerStore);
  private readonly text = inject(MediaDrawerTextStore);
  private readonly confirms = inject(ConfirmService);
  private readonly injector = inject(Injector);

  readonly replacing = signal(false);
  readonly togglingLocalized = signal(false);
  /** Un-localizing would discard these files (`409 SF-MEDIA-0505`): asked before resending with `confirmDiscard`. */
  readonly discardPrompt = signal<DiscardedFile[] | null>(null);
  readonly discardPromptText = computed(() => discardedFilesText(this.discardPrompt() ?? []));
  /** The languages of localized media with the file each renders (`MediaView.localeFiles`, read with the file). */
  readonly fileRows = computed<LocaleFileRow[]>(() =>
    this.core.localized() && this.core.showLocalization()
      ? localeFileRows(this.core.media()?.localeFiles, this.core.locales.locales(), this.core.locales.defaultLocale())
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

  /** Swaps the file (the Details tab's Replace). Unsaved source edits are asked about first: they belong to the old file. */
  async replaceFile(file: File): Promise<void> {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly() || this.replacing()) {
      return;
    }
    if (this.text.dirty() && !(await this.text.confirmLeave())) {
      return;
    }
    this.replacing.set(true);
    try {
      const response = await firstValueFrom(this.core.api.replaceMedia(this.core.projectKey(), uuid, file));
      this.text.resetText();
      this.core.processDiagnostics.set(response.warnings ?? []);
      this.core.toasts.show(
        this.core.t(response.processCmsCleared ? 'details.replacedCleared' : 'details.replaced', { name: file.name }),
        response.processCmsCleared ? 'warning' : 'success',
      );
      this.core.applyUpdated(response.media!);
    } catch (err) {
      this.core.processDiagnostics.set(diagnosticsOf(err));
    } finally {
      this.replacing.set(false);
    }
  }

  // ── Different file per language ─────────────────────────────────────────

  /** "Different file per language": on is immediate; off asks first when other languages have their own file. */
  async setLocalized(wanted: boolean): Promise<void> {
    if (this.core.readOnly() || this.togglingLocalized()) {
      return;
    }
    await this.sendLocalized(wanted, false);
  }

  async confirmUnlocalize(): Promise<void> {
    await this.sendLocalized(false, true);
  }

  cancelUnlocalize(): void {
    this.discardPrompt.set(null);
  }

  private async sendLocalized(localized: boolean, confirmDiscard: boolean): Promise<void> {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.togglingLocalized.set(true);
    try {
      const updated = await firstValueFrom(
        this.core.api.setMediaLocalized(this.core.projectKey(), uuid, localized, confirmDiscard, this.core.revision() ?? undefined),
      );
      this.discardPrompt.set(null);
      this.core.applyUpdated(updated);
      this.core.toasts.show(this.core.t(localized ? 'languages.nowLocalized' : 'languages.nowShared'), 'success');
    } catch (err) {
      const body = (err instanceof HttpErrorResponse ? err.error : null) as { code?: string; files?: DiscardedFile[] } | null;
      if (err instanceof HttpErrorResponse && err.status === 409 && body?.code === 'SF-MEDIA-0505') {
        this.discardPrompt.set(body.files ?? []);
      } else {
        this.core.toasts.show(problemOf(err, this.core.t('languages.failed')).detail, 'error');
      }
    } finally {
      this.togglingLocalized.set(false);
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
      void this.uploadLocaleFile(locale, file);
    }
  }

  async uploadLocaleFile(locale: string, file: File): Promise<void> {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly() || this.busyLocale()) {
      return;
    }
    if (this.text.dirty() && !(await this.text.confirmLeave())) {
      return;
    }
    this.busyLocale.set(locale);
    try {
      const response = await firstValueFrom(this.core.api.putMediaLocaleFile(this.core.projectKey(), uuid, locale, file));
      this.text.resetText();
      this.core.processDiagnostics.set(response.warnings ?? []);
      this.core.toasts.show(this.core.t('languages.saved', { language: locale.toUpperCase() }), 'success');
      this.core.applyUpdated(response.media!);
    } catch (err) {
      this.core.processDiagnostics.set(diagnosticsOf(err));
    } finally {
      this.busyLocale.set(null);
    }
  }

  async removeLocaleFile(row: LocaleFileRow): Promise<void> {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly() || row.isDefault || !row.own || this.busyLocale()) {
      return;
    }
    // Not undoable here: no endpoint puts a removed language file back (the earlier revision stays in History).
    const confirmed = await this.confirms.confirm({
      title: this.core.t('languages.removeTitle', { language: row.label }),
      message: this.core.t('languages.removeMessage', { language: row.label }),
      confirmLabel: this.core.t('languages.removeConfirm'),
      tone: 'danger',
      injector: this.injector,
    });
    if (!confirmed) {
      return;
    }
    this.busyLocale.set(row.locale);
    this.core.api.removeMediaLocaleFile(this.core.projectKey(), uuid, row.locale).subscribe({
      next: (updated: MediaView) => {
        this.busyLocale.set(null);
        this.text.resetText();
        this.core.toasts.show(this.core.t('languages.removed', { language: row.locale.toUpperCase() }), 'success');
        this.core.applyUpdated(updated);
      },
      error: () => this.busyLocale.set(null),
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────

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
