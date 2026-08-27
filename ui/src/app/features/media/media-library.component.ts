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
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfDropTargetDirective } from '../../shared/directives/sf-drop-target.directive';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';
import { MediaDetailDrawerComponent } from './media-detail-drawer.component';
import { MediaFolderDetailComponent } from './media-folder-detail.component';
import { MediaFolderNodeComponent, FolderMoveEvent } from './media-folder-node.component';

type MediaView = components['schemas']['MediaView'];
type FolderView = components['schemas']['FolderView'];

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
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfRenameAssetDialogComponent,
    SfSpinnerComponent,
    SfDropTargetDirective,
    SfFileSizePipe,
    MediaDetailDrawerComponent,
    MediaFolderDetailComponent,
    MediaFolderNodeComponent,
  ],
  templateUrl: './media-library.component.html',
  styleUrl: './media-library.component.scss',
})
export class MediaLibraryComponent implements AfterViewInit, OnDestroy {
  readonly projectKey = input.required<string>();

  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  protected readonly clipboard = inject(TreeClipboardService);

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

  readonly renamingFolder = signal<FolderView | null>(null);
  readonly renamingFolderMediaCount = signal(0);

  readonly renamingItem = signal<MediaView | null>(null);
  readonly renamingItemName = signal(false);

  readonly uploads = signal<UploadItem[]>([]);
  readonly dragCounter = signal(0);

  readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  private readonly thumbUrls = signal<Record<string, string>>({});
  private readonly thumbRequested = new Set<string>();

  readonly hasMore = computed(() => this.items().length < this.totalElements());
  readonly dragActive = computed(() => this.dragCounter() > 0);

  protected readonly tree = this.project.mediaFolderTree;

  /** The selected folder's direct subfolders (root when nothing is selected) — the content grid shows these, then this folder's own media, never descendants. */
  protected readonly currentFolderChildren = computed<FolderView[]>(() => {
    const uuid = this.folderUuid();
    if (!uuid) {
      return this.tree();
    }
    return findFolder(this.tree(), uuid)?.children ?? [];
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
        if (item.uuid && (item.mimeType ?? '').startsWith('image/')) {
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

  /** Material Symbols icon for a mime type that has no thumbnail preview (anything non-image). */
  protected mediaIconFor(mimeType?: string): string {
    const mime = mimeType ?? '';
    if (mime.startsWith('video/')) {
      return 'movie';
    }
    if (mime.startsWith('audio/')) {
      return 'audiotrack';
    }
    if (mime.startsWith('font/')) {
      return 'font_download';
    }
    if (mime === 'application/pdf') {
      return 'picture_as_pdf';
    }
    if (mime === 'application/zip' || mime === 'application/x-zip-compressed' || mime === 'application/gzip') {
      return 'folder_zip';
    }
    if (mime === 'text/css' || mime === 'application/javascript' || mime === 'application/json' || mime === 'text/html') {
      return 'code';
    }
    if (mime.startsWith('text/')) {
      return 'description';
    }
    return 'draft';
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

  protected selectFolder(node: FolderView | null): void {
    this.folderPath.set(node?.path ?? '');
    this.folderUuid.set(node?.uuid ?? '');
    this.reload();
  }

  protected onFolderSelected(uuid: string): void {
    this.selectFolder(findFolder(this.tree(), uuid));
  }

  readonly newFolderOpen = signal(false);
  readonly creatingFolder = signal(false);
  /** Parent folder targeted by the currently open "New folder" dialog — captured at open time since the root context menu always targets the root regardless of the current selection. */
  private newFolderParentUuid: string | undefined = undefined;

  protected newFolder(): void {
    this.createFolderUnder(this.folderUuid() || undefined);
  }

  private createFolderUnder(parentUuid: string | undefined): void {
    this.newFolderParentUuid = parentUuid;
    this.newFolderOpen.set(true);
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    const key = this.projectKey();
    this.creatingFolder.set(true);
    this.api
      .createFolder(key, {
        displayName: value.displayName,
        parentFolderUuid: this.newFolderParentUuid,
        scope: 'MEDIA',
      })
      .subscribe({
        next: () => {
          this.creatingFolder.set(false);
          this.newFolderOpen.set(false);
          this.toasts.show('Folder created', 'success');
          this.reloadFolders();
        },
        error: () => {
          this.creatingFolder.set(false);
          this.toasts.show('Could not create folder — a folder with that name may already exist here.', 'error');
        },
      });
  }

  protected reloadFolders(): void {
    this.project.loadFor(this.projectKey(), true).subscribe();
    this.reload();
  }

  protected moveItemTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target) {
      return;
    }
    this.api.moveAsset(this.projectKey(), event.source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.toasts.show('Moved', 'success');
        this.reloadFolders();
      },
      error: () => this.toasts.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  protected onRootDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  protected onRootDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    if (!source) {
      return;
    }
    this.api.moveAsset(this.projectKey(), source, {}).subscribe({
      next: () => {
        this.toasts.show('Moved to root', 'success');
        this.reloadFolders();
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  /** "All media" is the project's media root — its only folder action is creating a subfolder there (it can't be renamed, deleted, cut, or pasted into). */
  protected onRootContextMenu(event: MouseEvent): void {
    const items: ContextMenuItem[] = [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.createFolderUnder(undefined) },
    ];
    this.menu.open(event, items);
  }

  protected onFolderCardClick(folder: FolderView): void {
    this.selectFolder(folder);
  }

  protected onFolderCardDragStart(folder: FolderView, event: DragEvent): void {
    if (!folder.uuid) {
      return;
    }
    event.dataTransfer?.setData('text/plain', folder.uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onFolderCardDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  protected onFolderCardDrop(folder: FolderView, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer?.getData('text/plain');
    if (source && folder.uuid && source !== folder.uuid) {
      this.moveItemTo({ source, target: folder.uuid });
    }
  }

  protected onFolderCardContextMenu(folder: FolderView, event: MouseEvent): void {
    const uuid = folder.uuid;
    if (!uuid) {
      return;
    }
    const clip = this.clipboard.entry();
    this.menu.open(event, [
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.createFolderUnder(uuid) },
      { label: 'Rename', icon: 'edit', action: () => this.renameFolder(folder) },
      { label: '', separator: true },
      {
        label: 'Cut',
        icon: 'content_cut',
        action: () => this.clipboard.cut('FOLDER', uuid, folder.displayName ?? folder.uid ?? 'folder'),
      },
      { label: 'Paste', icon: 'content_paste', disabled: !clip, action: () => this.pasteInto(uuid) },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteFolder(folder) },
    ]);
  }

  // Opens the `sf-media-folder-detail` overlay drawer instead of a `window.prompt` — folders
  // here are otherwise only "navigate into" targets (see `onFolderCardClick`/`selectFolder`),
  // so reusing the "Rename" context-menu action as the entry point is the smaller, more
  // consistent change versus adding a whole new folder-selection interaction.
  private renameFolder(folder: FolderView): void {
    if (!folder.uuid) {
      return;
    }
    this.renamingFolder.set(folder);
    this.renamingFolderMediaCount.set(0);
    const folderPath = folder.path?.trim() || '/';
    this.api.listMedia(this.projectKey(), { folder: folderPath, page: 0, size: 1 }).subscribe({
      next: (res) => this.renamingFolderMediaCount.set(res.totalElements ?? 0),
      error: () => this.renamingFolderMediaCount.set(0),
    });
  }

  protected closeFolderDetail(): void {
    this.renamingFolder.set(null);
  }

  protected onFolderDetailChanged(): void {
    this.renamingFolder.set(null);
    this.reloadFolders();
  }

  private deleteFolder(folder: FolderView): void {
    const uuid = folder.uuid;
    if (!uuid) {
      return;
    }
    const name = folder.displayName ?? folder.uid ?? 'this folder';
    if (!window.confirm(`Delete "${name}" and everything inside it? This cannot be undone.`)) {
      return;
    }
    this.api.deleteFolder(this.projectKey(), uuid, true).subscribe({
      next: () => {
        this.toasts.show('Folder deleted', 'success');
        if (this.folderUuid() === uuid) {
          this.selectFolder(null);
        } else {
          this.reloadFolders();
        }
      },
      error: () => this.toasts.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }

  private pasteInto(targetUuid: string): void {
    const entry = this.clipboard.entry();
    if (!entry || entry.mode !== 'cut') {
      return;
    }
    this.api.moveAsset(this.projectKey(), entry.uuid, { folderUuid: targetUuid }).subscribe({
      next: () => {
        this.clipboard.clear();
        this.toasts.show(`Moved "${entry.label}"`, 'success');
        this.reloadFolders();
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  protected onItemDragStart(uuid: string | undefined, event: DragEvent): void {
    if (!uuid) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onItemContextMenu(item: MediaView, event: MouseEvent): void {
    const uuid = item.uuid;
    if (!uuid) {
      return;
    }
    const label = item.displayName ?? uuid;
    this.menu.open(event, [
      { label: 'Open details', icon: 'info', action: () => this.openDetail(uuid) },
      { label: 'Rename', icon: 'edit', action: () => this.renamingItem.set(item) },
      { label: 'Cut', icon: 'content_cut', action: () => this.clipboard.cut('MEDIA', uuid, label) },
      { label: '', separator: true },
      { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteOne(uuid, label) },
    ]);
  }

  protected closeRenameItem(): void {
    this.renamingItem.set(null);
  }

  protected submitRenameItemDisplayName(displayName: string): void {
    const item = this.renamingItem();
    const uuid = item?.uuid;
    if (!uuid) {
      return;
    }
    this.renamingItemName.set(true);
    this.api.renameAsset(this.projectKey(), uuid, { displayName }, item.revision ?? undefined).subscribe({
      next: () => {
        this.renamingItemName.set(false);
        this.renamingItem.set(null);
        this.toasts.show('Media renamed', 'success');
        this.reload();
      },
      error: () => {
        this.renamingItemName.set(false);
        this.toasts.show('Could not rename media — try again in a moment.', 'error');
      },
    });
  }

  protected onRenameItemUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.reload();
  }

  private deleteOne(uuid: string, label: string): void {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) {
      return;
    }
    this.api.deleteAsset(this.projectKey(), uuid).subscribe({
      next: () => {
        this.onDeleted(uuid);
        this.toasts.show('Media deleted', 'success');
      },
      error: () => this.toasts.show('Could not delete media — try again in a moment.', 'error'),
    });
  }

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
    // Root has no folderPath of its own — "/" matches only items placed directly at the project root, never nested ones (see `recursive`, default false).
    const folder = this.folderPath().trim() || '/';
    return {
      page,
      size: PAGE_SIZE,
      folder,
      ...(q ? { q } : {}),
      ...(mime ? { mimeType: mime } : {}),
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

function findFolder(nodes: FolderView[], uuid: string): FolderView | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }
    const found = findFolder(node.children ?? [], uuid);
    if (found) {
      return found;
    }
  }
  return null;
}
