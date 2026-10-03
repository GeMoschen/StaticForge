import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { Observable, Subscription } from 'rxjs';
import { ApiClient, type Transfer } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { MediaLibraryStore } from './media-library.store';
import { findFolder } from './media-library.util';
import { type UploadError, acceptsAlt, mimeAllowed, nextFreeName, uploadFailure } from './media-upload.util';

type MediaView = components['schemas']['MediaView'];
type MediaSaveResponse = components['schemas']['MediaSaveResponse'];

/** How many files travel at once; the rest wait their turn. */
export const UPLOAD_CONCURRENCY = 3;

export type UploadState = 'queued' | 'uploading' | 'done' | 'error';

/** One row of the upload panel. */
export interface UploadItem {
  readonly id: number;
  /** The name the file is stored under (*Keep both* renames it). */
  readonly name: string;
  readonly sizeBytes: number;
  readonly file: File;
  readonly projectKey: string;
  /** The folder the files were dropped into, captured at drop time (`''`: the library root). */
  readonly folderUuid: string;
  readonly folderLabel: string;
  readonly state: UploadState;
  /** 0–100; never 100 before the server has answered. */
  readonly progress: number;
  readonly error?: UploadError;
  /** What the server said, for `server` errors. */
  readonly detail?: string;
  /** The file that already has this name (*Replace* uploads over it). */
  readonly existingUuid?: string;
  /** How a name clash went on, shown once the file is uploaded. */
  readonly outcome?: 'replaced' | 'copy';
  /** The library file a finished upload became. */
  readonly media?: MediaView;
  /** The alt text saved from the panel. */
  readonly alt?: string;
  readonly altSaving?: boolean;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Uploading files chosen with the Upload button or dropped anywhere on the library (M35.19 phase C, decisions 19, 22, 98).
 *
 * Files are checked before anything is sent — type (the project's allow-list), size (the server's cap, both read from the
 * project detail) and a name that is taken in the folder — and a refused file becomes a failed row that says why. The rest
 * go up through {@link UPLOAD_CONCURRENCY} parallel requests, each into the folder that was open when the files were
 * dropped, with real progress and an abort for Cancel. A finished file is put into the library at once (the grid, the
 * folder's count) and a picture may get its alt text from the panel.
 */
@Injectable()
export class MediaUploadStore implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly library = inject(MediaLibraryStore);
  private readonly project = inject(ProjectContextStore);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  private seq = 0;
  private readonly requests = new Map<number, Subscription>();

  readonly uploads = signal<UploadItem[]>([]);

  /** Files are being dragged over the library. */
  private readonly dragDepth = signal(0);
  readonly dragActive = computed(() => this.dragDepth() > 0 && this.canUpload());

  /** An editor (or better) in a project that can be changed (not a past revision, not archived). */
  readonly canUpload = computed(() => this.permissions.canEditContent());
  /** Why the Upload button is off, for the notice beside it; empty when uploading is possible. */
  readonly blockedReason = computed(() =>
    this.canUpload() ? '' : this.library.readOnly() ? this.library.readOnlyLabel() : this.transloco.translate('media.uploads.viewerOnly'),
  );

  /** The server's cap per file, `null` while the project detail does not tell. */
  readonly maxBytes = computed(() => this.project.project()?.mediaMaxUploadBytes ?? null);
  /** What the server accepts (`*` for everything); empty while the project detail does not tell. */
  readonly allowedTypes = computed(() => this.project.project()?.effectiveAllowedMimeTypes ?? []);

  readonly running = computed(() => this.uploads().filter((u) => u.state === 'queued' || u.state === 'uploading').length);
  readonly failed = computed(() => this.uploads().filter((u) => u.state === 'error').length);
  /** The folder the rows go to, or how many folders when they are mixed. */
  readonly target = computed(() => {
    const folders = new Map(this.uploads().map((u) => [u.folderUuid, u.folderLabel]));
    return folders.size === 1 ? { folder: [...folders.values()][0], count: 1 } : { folder: '', count: folders.size };
  });

  // A file dropped beside the drop zone (the tree, the header of the page) would make the browser open it and leave the
  // app: files are only ever taken by the library, everywhere else the drop does nothing.
  private readonly guard = (event: Event): void => {
    if (hasFiles(event as DragEvent)) {
      event.preventDefault();
    }
  };
  private readonly reset = (): void => this.dragDepth.set(0);

  constructor() {
    this.document.addEventListener('dragover', this.guard);
    this.document.addEventListener('drop', this.guard);
    this.document.addEventListener('drop', this.reset);
    this.document.addEventListener('dragend', this.reset);
  }

  ngOnDestroy(): void {
    this.document.removeEventListener('dragover', this.guard);
    this.document.removeEventListener('drop', this.guard);
    this.document.removeEventListener('drop', this.reset);
    this.document.removeEventListener('dragend', this.reset);
    for (const request of this.requests.values()) {
      request.unsubscribe();
    }
    this.requests.clear();
  }

  // ── Picking and dropping ───────────────────────────────────────────────────

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.upload(files);
  }

  onDragEnter(event: DragEvent): void {
    if (hasFiles(event)) {
      event.preventDefault();
      this.dragDepth.update((n) => n + 1);
    }
  }

  onDragOver(event: DragEvent): void {
    if (hasFiles(event)) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = this.canUpload() ? 'copy' : 'none';
      }
    }
  }

  onDragLeave(event: DragEvent): void {
    if (hasFiles(event)) {
      this.dragDepth.update((n) => Math.max(0, n - 1));
    }
  }

  onDrop(event: DragEvent): void {
    this.dragDepth.set(0);
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    this.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  /** Checks the files and starts the ones that pass, into the folder that is open now. */
  upload(files: readonly File[]): void {
    if (files.length === 0) {
      return;
    }
    if (!this.canUpload()) {
      this.toasts.show(this.blockedReason(), 'warning');
      return;
    }
    const projectKey = this.library.projectKey();
    const folderUuid = this.library.folderUuid();
    const folderLabel = this.folderLabel(folderUuid);
    const rows: UploadItem[] = [];
    for (const file of files) {
      const row: UploadItem = {
        id: ++this.seq,
        name: file.name,
        sizeBytes: file.size,
        file,
        projectKey,
        folderUuid,
        folderLabel,
        state: 'queued',
        progress: 0,
      };
      const refusal = this.refusal(file, folderUuid, [...this.uploads(), ...rows]);
      rows.push(refusal ? { ...row, state: 'error', ...refusal } : row);
    }
    this.uploads.update((list) => [...list, ...rows]);
    this.pump();
  }

  /** Why a file can't go into the folder, if it can't. */
  private refusal(file: File, folderUuid: string, others: readonly UploadItem[]): { error: UploadError; existingUuid?: string } | null {
    if (!mimeAllowed(file.type, this.allowedTypes())) {
      return { error: 'type' };
    }
    const max = this.maxBytes();
    if (max !== null && file.size > max) {
      return { error: 'size' };
    }
    const name = file.name.toLowerCase();
    const existing = this.existingFile(folderUuid, name);
    if (existing) {
      return { error: 'duplicate', existingUuid: existing };
    }
    const queued = others.some((u) => u.folderUuid === folderUuid && u.state !== 'error' && u.name.toLowerCase() === name);
    return queued ? { error: 'duplicate' } : null;
  }

  /** The uuid of the file that holds `name` (lower-cased) in the folder. */
  private existingFile(folderUuid: string, name: string): string | undefined {
    const path = folderUuid ? findFolder(this.library.tree(), folderUuid)?.path : this.library.mediaRoot()?.path;
    const pool = this.library.allLoaded() ? this.library.allMedia() : this.library.items();
    return pool.find((m) => m.folderPath === path && (m.displayName ?? '').toLowerCase() === name)?.uuid;
  }

  /** The names taken in the folder: its files and the other rows going there. */
  private takenNames(folderUuid: string, exceptId: number): Set<string> {
    const path = folderUuid ? findFolder(this.library.tree(), folderUuid)?.path : this.library.mediaRoot()?.path;
    const pool = this.library.allLoaded() ? this.library.allMedia() : this.library.items();
    const names = new Set(pool.filter((m) => m.folderPath === path).map((m) => (m.displayName ?? '').toLowerCase()));
    for (const row of this.uploads()) {
      if (row.id !== exceptId && row.folderUuid === folderUuid && row.state !== 'error') {
        names.add(row.name.toLowerCase());
      }
    }
    return names;
  }

  private folderLabel(folderUuid: string): string {
    const folder = folderUuid ? findFolder(this.library.tree(), folderUuid) : null;
    return folder ? (folder.displayName ?? folder.uid ?? '') : this.transloco.translate('media.folders.root');
  }

  // ── The panel's actions ────────────────────────────────────────────────────

  /** Cancels a running upload (the request is aborted) or takes a waiting, finished or failed row off the list. */
  cancel(id: number): void {
    this.requests.get(id)?.unsubscribe();
    this.requests.delete(id);
    this.uploads.update((list) => list.filter((u) => u.id !== id));
    this.pump();
  }

  /** Retry: only for a lost connection (the other refusals would fail again). */
  retry(id: number): void {
    this.patch(id, { state: 'queued', progress: 0, error: undefined, detail: undefined });
    this.pump();
  }

  /** A name that is taken: *Replace* uploads over the existing file (links and usages stay), *Keep both* under the next free name. */
  resolveDuplicate(id: number, outcome: 'replaced' | 'copy'): void {
    const row = this.uploads().find((u) => u.id === id);
    if (!row || (outcome === 'replaced' && !row.existingUuid)) {
      return;
    }
    const renamed = outcome === 'copy' ? nextFreeName(row.name, this.takenNames(row.folderUuid, id)) : row.name;
    this.patch(id, {
      name: renamed,
      file: outcome === 'copy' ? new File([row.file], renamed, { type: row.file.type }) : row.file,
      state: 'queued',
      progress: 0,
      error: undefined,
      existingUuid: outcome === 'replaced' ? row.existingUuid : undefined,
      outcome,
    });
    this.pump();
  }

  /** Closes the panel: finished and failed rows go, running uploads stay. */
  clear(): void {
    this.uploads.update((list) => list.filter((u) => u.state === 'queued' || u.state === 'uploading'));
  }

  /** Saves a finished picture's alt text for the language being edited (the same call as the drawer's Details). */
  saveAlt(id: number, text: string): void {
    const row = this.uploads().find((u) => u.id === id);
    const media = row?.media;
    const alt = text.trim();
    if (!row || !media?.uuid || !alt || row.altSaving) {
      return;
    }
    this.patch(id, { altSaving: true });
    this.api
      .updateMediaMetadata(
        row.projectKey,
        media.uuid,
        { altText: alt, focalPoint: media.focalPoint },
        media.revision,
        this.editingLocale.locale() ?? undefined,
      )
      .subscribe({
        next: (updated) => {
          this.patch(id, { alt, altSaving: false, media: updated });
          this.library.onUpdated(updated);
          this.toasts.show(this.transloco.translate('media.uploads.altSaved', { name: row.name }), 'success');
        },
        error: () => this.patch(id, { altSaving: false }),
      });
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  /** Starts waiting rows until {@link UPLOAD_CONCURRENCY} are on their way. */
  private pump(): void {
    while (this.uploads().filter((u) => u.state === 'uploading').length < UPLOAD_CONCURRENCY) {
      const next = this.uploads().find((u) => u.state === 'queued');
      if (!next) {
        return;
      }
      this.start(next);
    }
  }

  private start(row: UploadItem): void {
    this.patch(row.id, { state: 'uploading', progress: 0 });
    const id = row.id;
    const replacing = row.outcome === 'replaced' && row.existingUuid;
    const request: Observable<Transfer<MediaView | MediaSaveResponse>> = replacing
      ? this.api.replaceMediaWithProgress(row.projectKey, row.existingUuid as string, row.file)
      : this.api.uploadMediaWithProgress(row.projectKey, row.file, { folderUuid: row.folderUuid || undefined });
    this.requests.set(
      id,
      request.subscribe({
        next: (event) => {
          if (event.kind === 'progress') {
            const percent = event.total ? Math.floor((event.loaded / event.total) * 100) : 0;
            this.patch(id, { progress: Math.min(99, percent) });
            return;
          }
          const media = ('media' in event.body ? event.body.media : event.body) as MediaView | undefined;
          this.finish(id, row, media);
        },
        error: (err: unknown) => {
          this.requests.delete(id);
          this.patch(id, { state: 'error', ...uploadFailure(err) });
          this.pump();
        },
      }),
    );
  }

  private finish(id: number, row: UploadItem, media: MediaView | undefined): void {
    this.requests.delete(id);
    this.patch(id, { state: 'done', progress: 100, media });
    if (media) {
      if (row.outcome === 'replaced') {
        this.library.onUpdated(media);
      } else {
        this.library.prepend(media, row.folderUuid);
      }
    }
    this.pump();
  }

  /** Whether the panel asks for alt text for a finished row: a new picture that has none yet. */
  asksForAlt(row: UploadItem): boolean {
    return row.state === 'done' && row.outcome !== 'replaced' && row.alt === undefined && acceptsAlt(row.media?.mimeType);
  }

  private patch(id: number, changes: Partial<Mutable<UploadItem>>): void {
    this.uploads.update((list) => list.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
