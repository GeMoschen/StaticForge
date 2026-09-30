import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../../core/api/api.client';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { sortByDisplayName } from '../../../shared/tree-sort.util';
import { PAGE_SIZE, findFolder, findFolderByPath } from './media-library.util';

export type MediaView = components['schemas']['MediaView'];
export type MediaSummaryView = components['schemas']['MediaSummaryView'];
export type FolderView = components['schemas']['FolderView'];

/**
 * What the media library screen shares between its parts: the grid's page of items and its filters, the project-wide
 * list behind the folder tree, the selected folder and the open detail drawer. Provided by `MediaLibraryComponent`.
 */
@Injectable()
export class MediaLibraryStore {
  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly access = inject(ProjectAccessStore);

  /** Time travel or an archived project (M26). */
  readonly readOnly = this.access.readOnly;
  readonly readOnlyLabel = this.access.readOnlyLabel;

  projectKey!: Signal<string>;
  /** Asked before the open drawer is switched to another file: it may hold unsaved source edits (M18.4.1). */
  canLeaveDetail: () => boolean = () => true;

  private readonly search$ = new Subject<string>();

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

  /** Every media item in the project, fetched once (unfiltered — no `folder`/`q`/`mimeType`),
   * independent of the grid's own paginated/filtered `items()` — feeds the sidebar tree's leaf
   * rows (mirrors `PagesListComponent.pages`/`pagesByFolder`), so the tree shows every item
   * regardless of the grid's current folder/search/type filter. */
  readonly allMedia = signal<MediaSummaryView[]>([]);

  readonly hasMore = computed(() => this.items().length < this.totalElements());

  readonly tree = this.project.mediaFolderTree;

  /** The project's fixed, protected "All Media" wrapper root (mirrors `NAVIGATION`'s own fixed
   * root) — always the tree's sole top-level entry now, but this screen already has its own
   * "All media" affordance (the `library__clear` button), so it's unwrapped here rather than
   * rendered a second time as an ordinary folder row. */
  readonly mediaRoot = computed<FolderView | null>(() => this.tree()[0] ?? null);
  /** The store's real top-level folders — the wrapper root's children. */
  readonly topLevelFolders = computed<FolderView[]>(() => this.mediaRoot()?.children ?? []);

  /** `allMedia` grouped by canonical folder path, for the tree (mirrors
   * `PagesListComponent.pagesByFolder`/`FolderNodeComponent.ownPages`). */
  readonly mediaByFolder = computed<Map<string, MediaSummaryView[]>>(() => {
    const map = new Map<string, MediaSummaryView[]>();
    for (const item of this.allMedia()) {
      const path = item.folderPath ?? '/';
      const list = map.get(path);
      if (list) {
        list.push(item);
      } else {
        map.set(path, [item]);
      }
    }
    for (const [path, list] of map) {
      map.set(path, sortByDisplayName(list));
    }
    return map;
  });

  /** Media items living directly in the "All Media" wrapper root, rendered as tree leaves
   * alongside `topLevelFolders` (mirrors `PagesListComponent.rootPages`). */
  readonly rootMedia = computed<MediaSummaryView[]>(
    () => this.mediaByFolder().get(this.mediaRoot()?.path ?? '/') ?? [],
  );

  /** The selected folder's direct subfolders (top-level store folders when nothing is
   * selected) — the content grid shows these, then this folder's own media, never descendants. */
  readonly currentFolderChildren = computed<FolderView[]>(() => {
    const uuid = this.folderUuid();
    if (!uuid) {
      return this.topLevelFolders();
    }
    return findFolder(this.tree(), uuid)?.children ?? [];
  });

  /** The uuid of whichever media item's detail drawer is currently open, for tree-leaf
   * highlighting. */
  readonly selectedMediaUuid = computed<string | null>(() => this.selectedMedia()?.uuid ?? null);

  constructor() {
    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => {
        this.search.set(q);
        this.reload();
      });
  }

  connect(projectKey: Signal<string>): void {
    this.projectKey = projectKey;
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  reload(onLoaded?: () => void): void {
    this.loading.set(true);
    this.selected.set([]);
    this.api.listMedia(this.projectKey(), this.query(0)).subscribe({
      next: (res) => {
        this.items.set(res.content ?? []);
        this.page.set(res.number ?? 0);
        this.totalElements.set(res.totalElements ?? 0);
        this.loading.set(false);
        onLoaded?.();
      },
      error: () => this.loading.set(false),
    });
  }

  /** Every media item in the project, unfiltered — feeds `allMedia`/`mediaByFolder` (the
   * sidebar tree's leaf rows), independent of the grid's own folder/search/type filter. */
  loadAllMedia(key: string): void {
    if (!key) {
      return;
    }
    this.api.listMedia(key, { page: 0, size: 10000 }).subscribe({
      next: (res) => this.allMedia.set(res.content ?? []),
      error: () => this.allMedia.set([]),
    });
  }

  /** The grid and the tree's leaf rows both re-read. */
  reloadMedia(): void {
    this.reload();
    this.loadAllMedia(this.projectKey());
  }

  loadMore(): void {
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

  private query(page: number): {
    mimeType?: string;
    folder?: string;
    q?: string;
    page: number;
    size: number;
  } {
    const q = this.search().trim();
    const mime = this.mimeFilter().trim();
    // "All media" (nothing selected) means the fixed "All Media" wrapper root's own path now,
    // not the bare project root — every media asset nests under it (see `mediaRoot`) — matches
    // only items placed directly there, never nested ones (see `recursive`, default false).
    const folder = this.folderPath().trim() || this.mediaRoot()?.path || '/';
    return {
      page,
      size: PAGE_SIZE,
      folder,
      ...(q ? { q } : {}),
      ...(mime ? { mimeType: mime } : {}),
    };
  }

  // ── Filters and folders ─────────────────────────────────────────────────

  queueSearch(value: string): void {
    this.search$.next(value);
  }

  setMimeFilter(value: string): void {
    this.mimeFilter.set(value);
    this.reload();
  }

  selectFolder(node: FolderView | null): void {
    this.folderPath.set(node?.path ?? '');
    this.folderUuid.set(node?.uuid ?? '');
    this.reload();
  }

  selectFolderByUuid(uuid: string): void {
    this.selectFolder(findFolder(this.tree(), uuid));
  }

  /** Folder tree, grid and leaf rows all re-read (after a folder was created, moved, renamed or deleted). */
  reloadFolders(): void {
    this.project.loadFor(this.projectKey(), true).subscribe();
    this.reloadMedia();
  }

  // ── Selection and the detail drawer ─────────────────────────────────────

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
    if (item?.uuid !== this.selectedMediaUuid() && !this.canLeaveDetail()) {
      return;
    }
    this.selectedMedia.set(item);
  }

  /** A tree leaf (`sf-media-nav-node`) was clicked — opens its detail drawer even when the item
   * isn't in the grid's current folder/search/type filter, by switching to its own folder and
   * clearing any active filter first (mirrors `openDetail`, but sourced from `allMedia` — the
   * unfiltered project-wide list — instead of the grid's own `items()`). */
  onSelectMediaLeaf(uuid: string): void {
    if (uuid !== this.selectedMediaUuid() && !this.canLeaveDetail()) {
      return;
    }
    const existing = this.items().find((i) => i.uuid === uuid);
    if (existing) {
      this.selectedMedia.set(existing);
      return;
    }
    const summary = this.allMedia().find((i) => i.uuid === uuid);
    if (!summary) {
      return;
    }
    const folderNode = findFolderByPath(this.tree(), summary.folderPath ?? '');
    this.folderPath.set(folderNode?.path ?? summary.folderPath ?? '');
    this.folderUuid.set(folderNode?.uuid ?? '');
    this.search.set('');
    this.mimeFilter.set('');
    this.reload(() => {
      const found = this.items().find((i) => i.uuid === uuid);
      this.selectedMedia.set(found ?? null);
    });
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

  /** Discard changes rewrote the file's draft: reload it and reopen the drawer on the new state (M27.6.1). */
  onDiscarded(uuid: string): void {
    this.selectedMedia.set(null);
    this.reload(() => {
      const found = this.items().find((i) => i.uuid === uuid);
      if (found) {
        this.selectedMedia.set(found);
      }
    });
    this.loadAllMedia(this.projectKey());
  }

  onDeleted(uuid: string): void {
    this.items.update((list) => list.filter((i) => i.uuid !== uuid));
    this.allMedia.update((list) => list.filter((i) => i.uuid !== uuid));
    this.totalElements.update((t) => Math.max(0, t - 1));
    this.selected.set([]);
    this.selectedMedia.set(null);
  }

  /** A freshly uploaded item heads the grid and the tree. */
  prepend(media: MediaView): void {
    this.items.update((list) => [
      media,
      ...list.filter((i) => i.uuid !== media.uuid),
    ]);
    this.totalElements.update((t) => t + 1);
    // `MediaView` (the upload response) has no `folderPath` of its own — it was uploaded to
    // whichever folder is currently selected, so that's its folder now.
    const folderPath = this.folderPath() || this.mediaRoot()?.path;
    this.allMedia.update((list) => [
      { ...media, folderPath },
      ...list.filter((i) => i.uuid !== media.uuid),
    ]);
  }
}
