import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { ToastService } from '../../../core/ui/toast.service';
import { MediaDrawerStore } from './media-drawer.store';

/** The preview binary and variant downloads. */
@Injectable()
export class MediaDrawerPreviewStore implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly core = inject(MediaDrawerStore);

  /** Object URL for the fetched preview binary — `mediaBinaryUrl()` alone 401s when used as a
   * plain `<img src>`/`<a href>` (see `loadPreview`), so the preview image is fetched through
   * `HttpClient` (auth interceptor attached) and rendered from a local blob URL instead. */
  private readonly previewObjectUrl = signal<string | null>(null);

  previewUrl(): string {
    return this.previewObjectUrl() ?? '';
  }

  loadPreview(projectKey: string, uuid: string, locale: string | null): void {
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

  /** Fetches a variant's binary through `HttpClient` (see `loadPreview`) and triggers a
   * client-side download from a short-lived blob URL — a plain `<a href download>` pointed at
   * `mediaBinaryUrl()` would 401 the same way the old `<img src>` preview did. */
  downloadVariant(variantName?: string): void {
    const uuid = this.core.media()?.uuid;
    if (!uuid) {
      return;
    }
    this.api.mediaBinaryBlob(this.core.projectKey(), uuid, variantName).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = variantName ?? this.core.media()?.fileName ?? this.core.media()?.uid ?? 'download';
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toasts.show('Could not download — try again in a moment.', 'error'),
    });
  }

  ngOnDestroy(): void {
    const url = this.previewObjectUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}
