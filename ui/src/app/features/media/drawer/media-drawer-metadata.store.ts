import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { problemOf } from '../../../core/api/problem.util';
import type { SaveResult } from '../../../shared/components/dialog/unsaved-changes.service';
import { MediaDrawerStore, type MediaView } from './media-drawer.store';

type MediaMetadataRequest = components['schemas']['MediaMetadataRequest'];

/** A focal point in percent of the picture (the backend keeps 0..1). */
export interface FocalPercent {
  readonly x: number;
  readonly y: number;
}

/** What the Details tab edits: alt text and caption of the editing language, the copyright, the focal point. */
export interface MetadataDraft {
  readonly alt: string;
  readonly caption: string;
  readonly copyright: string;
  readonly focal: FocalPercent | null;
}

const CENTER: FocalPercent = { x: 50, y: 50 };

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Only photos (JPEG) have a focal point (decision 101): PNG and SVG pictures, PDFs and text are used as they are. */
export function hasFocalPoint(media: Pick<MediaView, 'mimeType'> | null | undefined): boolean {
  return media?.mimeType === 'image/jpeg';
}

function sameFocal(a: FocalPercent | null, b: FocalPercent | null): boolean {
  return a?.x === b?.x && a?.y === b?.y;
}

function sameDraft(a: MetadataDraft, b: MetadataDraft): boolean {
  return a.alt === b.alt && a.caption === b.caption && a.copyright === b.copyright && sameFocal(a.focal, b.focal);
}

/**
 * The Details tab's edits — alt text, caption, copyright and focal point — and their save. The draft is compared with
 * what the server last said (the baseline), so "dirty" means exactly "differs from the saved file": typing a word and
 * deleting it again is clean, and a reload (or the answer of a save) never overwrites what was typed in the meantime.
 */
@Injectable()
export class MediaDrawerMetadataStore {
  private readonly core = inject(MediaDrawerStore);

  readonly saving = signal(false);
  private readonly baseline = signal<MetadataDraft>({ alt: '', caption: '', copyright: '', focal: null });
  readonly draft = signal<MetadataDraft>({ alt: '', caption: '', copyright: '', focal: null });

  /** Unsaved edits: what makes Save worth pressing. */
  readonly dirty = computed(() => !sameDraft(this.draft(), this.baseline()));

  edit(patch: Partial<MetadataDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
  }

  setFocal(focal: FocalPercent): void {
    this.edit({ focal: { x: clampPercent(focal.x), y: clampPercent(focal.y) } });
  }

  /** What the server says about `media`, in the language being edited. */
  private snapshotOf(media: MediaView): MetadataDraft {
    const point = media.focalPoint;
    const focal = !hasFocalPoint(media)
      ? null
      : point && point.x != null && point.y != null
        ? { x: clampPercent(point.x * 100), y: clampPercent(point.y * 100) }
        : CENTER;
    return {
      // `altTextL10n` holds every language; the draft edits the one being worked in, falling back to the resolved
      // `altText` in a project without languages.
      alt: this.core.localizedMetadata(media.altTextL10n, media.altText),
      caption: this.core.localizedMetadata(media.captionL10n, media.caption),
      copyright: media.copyright ?? '',
      focal,
    };
  }

  /** Another file: the draft and the baseline are what the server says; nothing is unsaved afterwards. */
  seed(media: MediaView): void {
    const snapshot = this.snapshotOf(media);
    this.baseline.set(snapshot);
    this.draft.set(snapshot);
  }

  /**
   * The same file was read again: the baseline follows the server. An untouched draft follows it too; edits are kept
   * (a reload after a save must not take back what was typed since).
   */
  sync(media: MediaView): void {
    const unsaved = this.dirty();
    const snapshot = this.snapshotOf(media);
    this.baseline.set(snapshot);
    if (!unsaved) {
      this.draft.set(snapshot);
    }
  }

  /** The editing language changed: alt text and caption show that language's words (an unsaved draft is dropped). */
  reseedLanguageFields(media: MediaView): void {
    const snapshot = this.snapshotOf(media);
    this.baseline.update((base) => ({ ...base, alt: snapshot.alt, caption: snapshot.caption }));
    this.draft.update((draft) => ({ ...draft, alt: snapshot.alt, caption: snapshot.caption }));
  }

  /** Drops the unsaved edits (Revert, Discard in the leave dialog). */
  revert(): void {
    this.draft.set(this.baseline());
  }

  async save(): Promise<SaveResult> {
    const media = this.core.media();
    const uuid = media?.uuid;
    if (!uuid || this.core.readOnly()) {
      return { ok: false, message: this.core.readOnlyLabel() };
    }
    const sent = this.draft();
    const base = this.baseline();
    // The focal point is sent as the user set it; untouched it stays as the server has it (no rounding to a percent).
    const focal = sent.focal && !sameFocal(sent.focal, base.focal)
      ? { x: sent.focal.x / 100, y: sent.focal.y / 100 }
      : media.focalPoint;
    const payload: MediaMetadataRequest = {
      altText: sent.alt,
      caption: sent.caption,
      copyright: sent.copyright,
      focalPoint: focal,
    };
    this.saving.set(true);
    try {
      const updated = await firstValueFrom(
        this.core.api.updateMediaMetadata(
          this.core.projectKey(),
          uuid,
          payload,
          this.core.revision() ?? undefined,
          // Alt text and caption belong to the language being edited (M24.4.1).
          this.core.editingLocale.locale() ?? undefined,
        ),
      );
      const saved = this.snapshotOf(updated);
      this.baseline.set(saved);
      if (sameDraft(this.draft(), sent)) {
        this.draft.set(saved);
      }
      this.core.applyUpdated(updated);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: problemOf(error, this.core.t('errors.saveDetails')).detail };
    } finally {
      this.saving.set(false);
    }
  }
}
