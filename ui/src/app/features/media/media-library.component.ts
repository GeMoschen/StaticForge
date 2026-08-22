import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';

type MediaView = components['schemas']['MediaView'];
type FolderView = components['schemas']['FolderView'];

interface FolderOption {
  uuid?: string;
  path: string;
  label: string;
}

interface UploadItem {
  id: number;
  fileName: string;
  status: 'uploading' | 'done' | 'error';
  uuid?: string;
  message?: string;
}

const PAGE_SIZE = 40;

@Component({
  selector: 'sf-media-library',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfEmptyStateComponent,
    SfDropTargetDirective,
    SfFileSizePipe,
    MediaDetailDrawerComponent,
  ],
  templateUrl: './media-library.component.html',
  styleUrl: './media-library.component.scss',
})
export class MediaLibraryComponent implements AfterViewInit, OnDestroy {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);

  private readonly search$ = new Subject<string>();
  private uploadSeq = 0;
  private observer: IntersectionObserver | null = null;

  readonly items = signal<MediaView[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly page = signal(0);
  readonly totalElements = signal(0);

  readonly search = signal('');
  readonly mimeFilter = signal('');
  readonly folderPath = signal('');
  readonly folderUuid = signal('');

  readonly selected = signal<string[]>([]);
  readonly selectedMedia = signal<MediaView | null>(null);

  readonly uploads = signal<UploadItem[]>([]);
  readonly dragCounter = signal(0);

  readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  private readonly thumbUrls = signal<Record<string, string>>({});
  private readonly thumbRequested = new Set<string>();

  readonly hasMore = computed(() => this.items().length < this.totalElements());
  readonly dragActive = computed(() => this.dragCounter() > 0);

  readonly folderOptions = computed<FolderOption[]>(() => {
    const result: FolderOption[] = [{ path: '', label: 'All folders' }];
    const walk = (nodes: FolderView[] | undefined, depth: number) => {
      for (const node of nodes ?? []) {
        result.push({
          uuid: node.uuid,
          path: node.path ?? node.uuid ?? '',
          label: '\u00a0\u00a0'.repeat(depth) + (node.displayName ?? node.path ?? node.uid ?? ''),
        });
        walk(node.children ?? [], depth + 1);
      }
    };
    walk(this.project.folderTree(), 0);
    return result;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.reload());
    });

    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => {
        this.search.set(q);
        this.reload();
      });

    effect(() => {
      const key = this.projectKey();
      for (const item of this.items()) {
        if (item.uuid) {
          this.requestThumb(key, item.uuid);
        }
      }
    });
  }

  ngOnDestroy(): void {
    for (const url of Object.values(this.thumbUrls())) {
      URL.revokeObjectURL(url);
    }
  }

  private requestThumb(projectKey: string, uuid: string): void {
    if (this.thumbRequested.has(uuid)) {
      return;
    }
    this.thumbRequested.add(uuid);
    this.api.mediaThumbnailBlob(projectKey, uuid).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.thumbUrls.update((map) => ({ ...map, [uuid]: url }));
      },
      error: () => this.thumbRequested.delete(uuid),
    });
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.loadMore();
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 },
    );
    const el = this.sentinel()?.nativeElement;
    if (el) {
      this.observer.observe(el);
    }
  }

  thumb(uuid?: string): string | null {
    return uuid ? (this.thumbUrls()[uuid] ?? null) : null;
  }

  isSelected(uuid?: string): boolean {
    return uuid != null && this.selected().includes(uuid);
  }

  toggle(uuid?: string): void {
    if (!uuid) {
      return;
    }
    this.selected.update((list) =>
      list.includes(uuid) ? list.filter((x) => x !== uuid) : [...list, uuid],
    );
  }

  openDetail(uuid?: string): void {
    if (!uuid) {
      return;
    }
    const item = this.items().find((i) => i.uuid === uuid) ?? null;
    this.selectedMedia.set(item);
  }

  closeDetail(): void {
    this.selectedMedia.set(null);
  }

  onUpdated(updated: MediaView): void {
    this.items.update((list) =>
      list.map((i) => (i.uuid === updated.uuid ? updated : i)),
    );
    this.selectedMedia.set(updated);
  }

  onDeleted(uuid: string): void {
    this.items.update((list) => list.filter((i) => i.uuid !== uuid));
    this.totalElements.update((t) => Math.max(0, t - 1));
    this.selected.set([]);
    this.selectedMedia.set(null);
  }

  deleteSelection(): void {
    const uuids = this.selected();
    if (uuids.length === 0) {
      return;
    }
    this.toasts.show(`Deleting ${uuids.length} media item(s)`, 'warning');
    const confirmed = window.confirm(
      `Delete ${uuids.length} media item(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    const key = this.projectKey();
    let remaining = uuids.length;
    for (const uuid of uuids) {
      this.api.deleteAsset(key, uuid).subscribe({
        next: () => {
          this.items.update((list) => list.filter((i) => i.uuid !== uuid));
          this.totalElements.update((t) => Math.max(0, t - 1));
          remaining -= 1;
          if (remaining === 0) {
            this.selected.set([]);
            this.toasts.show('Media deleted', 'success');
          }
        },
        error: () => {
          remaining -= 1;
          if (remaining === 0) {
            this.selected.set([]);
          }
        },
      });
    }
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search$.next(value);
  }

  onMimeChange(event: Event): void {
    this.mimeFilter.set((event.target as HTMLSelectElement).value);
    this.reload();
  }

  onFolderChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.folderPath.set(value);
    const option = this.folderOptions().find((o) => o.path === value);
    this.folderUuid.set(option?.uuid ?? '');
    this.reload();
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragEnter(): void {
    this.dragCounter.update((n) => n + 1);
  }

  onDragLeave(): void {
    this.dragCounter.update((n) => Math.max(0, n - 1));
  }

  onDrop(event: DragEvent): void {
    this.dragCounter.set(0);
    this.uploadFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  private uploadFiles(files: File[]): void {
    const key = this.projectKey();
    for (const file of files) {
      const id = ++this.uploadSeq;
      this.uploads.update((list) => [
        ...list,
        { id, fileName: file.name, status: 'uploading' },
      ]);
      this.api
        .uploadMedia(key, file, { folderUuid: this.folderUuid() || undefined })
        .subscribe({
          next: (media) => {
            this.uploads.update((list) =>
              list.map((u) =>
                u.id === id ? { ...u, status: 'done', uuid: media.uuid } : u,
              ),
            );
            this.prepend(media);
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

  private prepend(media: MediaView): void {
    this.items.update((list) => [
      media,
      ...list.filter((i) => i.uuid !== media.uuid),
    ]);
    this.totalElements.update((t) => t + 1);
  }

  private query(page: number): {
    mimeType?: string;
    folder?: string;
    q?: string;
    page: number;
    size: number;
  } {
    const q = this.search().trim();
    const mime = this.mimeFilter().trim();
    const folder = this.folderPath().trim();
    return {
      page,
      size: PAGE_SIZE,
      ...(q ? { q } : {}),
      ...(mime ? { mimeType: mime } : {}),
      ...(folder ? { folder } : {}),
    };
  }

  private reload(): void {
    this.loading.set(true);
    this.selected.set([]);
    this.api.listMedia(this.projectKey(), this.query(0)).subscribe({
      next: (res) => {
        this.items.set(res.content ?? []);
        this.page.set(res.number ?? 0);
        this.totalElements.set(res.totalElements ?? 0);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) {
      return;
    }
    this.loadingMore.set(true);
    const next = this.page() + 1;
    this.api.listMedia(this.projectKey(), this.query(next)).subscribe({
      next: (res) => {
        this.items.update((list) => [...list, ...(res.content ?? [])]);
        this.page.set(res.number ?? next);
        this.totalElements.set(res.totalElements ?? this.items().length);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private describeError(err: unknown): string {
    const e = err as {
      message?: string;
      error?: { detail?: string; message?: string };
    };
    return e?.error?.detail ?? e?.error?.message ?? e?.message ?? 'Failed';
  }
}
