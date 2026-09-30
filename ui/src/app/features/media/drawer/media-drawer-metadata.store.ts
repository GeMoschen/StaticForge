import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { MediaDrawerStore, type MediaView } from './media-drawer.store';

type MediaMetadataRequest = components['schemas']['MediaMetadataRequest'];
type FocalPointView = components['schemas']['FocalPointView'];

/** The metadata form — alt text, caption, copyright and focal point — and its save. */
@Injectable()
export class MediaDrawerMetadataStore {
  private readonly core = inject(MediaDrawerStore);

  readonly saving = signal(false);

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

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formChanged.update((n) => n + 1));
  }

  /** Fills the metadata form from `media`; nothing is unsaved afterwards. */
  seedForm(media: MediaView): void {
    this.form.reset({
      // `altTextL10n` holds every language; the form edits the one being worked in, falling back to
      // the resolved `altText` in a project without languages.
      altText: this.core.localizedMetadata(media.altTextL10n, media.altText),
      caption: this.core.localizedMetadata(media.captionL10n, media.caption),
      copyright: media.copyright ?? '',
      focalX: media.focalPoint?.x ?? null,
      focalY: media.focalPoint?.y ?? null,
    });
    this.settleForm();
  }

  /** The editing language changed: alt text and caption show that language's words. */
  reseedLanguageFields(media: MediaView): void {
    this.form.patchValue({
      altText: this.core.localizedMetadata(media.altTextL10n, media.altText),
      caption: this.core.localizedMetadata(media.captionL10n, media.caption),
    });
    this.settleForm();
  }

  /** Marks what the form holds as saved: nothing to save until the next edit. */
  private settleForm(): void {
    this.form.markAsPristine();
    this.formChanged.update((n) => n + 1);
  }

  save(): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid || this.core.readOnly()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.core.toasts.show('Alt text is required before publishing', 'warning');
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
    this.core.api
      .updateMediaMetadata(
        this.core.projectKey(),
        uuid,
        payload,
        this.core.revision() ?? undefined,
        // Alt text and caption belong to the language being edited (M24.4.1).
        this.core.editingLocale.locale() ?? undefined,
      )
      .subscribe({
        next: (updated) => {
          this.core.revision.set(updated.revision ?? null);
          this.settleForm();
          this.core.toasts.show('Metadata saved', 'success');
          this.saving.set(false);
          this.core.emitUpdated(updated);
        },
        error: () => this.saving.set(false),
      });
  }
}
