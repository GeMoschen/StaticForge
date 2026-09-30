import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { MediaLibraryStore } from './media-library.store';

export interface UploadItem {
  id: number;
  fileName: string;
  status: 'uploading' | 'done' | 'error';
  uuid?: string;
  message?: string;
}

/** Uploading files chosen with the Upload button or dropped anywhere on the library. */
@Injectable()
export class MediaUploadStore {
  private readonly api = inject(ApiClient);
  private readonly library = inject(MediaLibraryStore);

  private uploadSeq = 0;

  readonly uploads = signal<UploadItem[]>([]);
  readonly dragCounter = signal(0);
  readonly dragActive = computed(() => this.dragCounter() > 0);

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragEnter(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) {
      return;
    }
    this.dragCounter.update((n) => n + 1);
  }

  onDragLeave(): void {
    this.dragCounter.update((n) => Math.max(0, n - 1));
  }

  onDrop(event: DragEvent): void {
    this.dragCounter.set(0);
    if (!event.dataTransfer?.types.includes('Files')) {
      return;
    }
    this.uploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  private uploadFiles(files: File[]): void {
    if (this.library.readOnly()) {
      return;
    }
    const key = this.library.projectKey();
    for (const file of files) {
      const id = ++this.uploadSeq;
      this.uploads.update((list) => [
        ...list,
        { id, fileName: file.name, status: 'uploading' },
      ]);
      this.api
        .uploadMedia(key, file, { folderUuid: this.library.folderUuid() || undefined })
        .subscribe({
          next: (media) => {
            this.uploads.update((list) =>
              list.map((u) =>
                u.id === id ? { ...u, status: 'done', uuid: media.uuid } : u,
              ),
            );
            this.library.prepend(media);
          },
          error: (err) => {
            this.uploads.update((list) =>
              list.map((u) =>
                u.id === id
                  ? { ...u, status: 'error', message: this.describeError(err) }
                  : u,
              ),
            );
          },
        });
    }
  }

  private describeError(err: unknown): string {
    const e = err as {
      message?: string;
      error?: { detail?: string; message?: string };
    };
    return e?.error?.detail ?? e?.error?.message ?? e?.message ?? 'Failed';
  }
}
