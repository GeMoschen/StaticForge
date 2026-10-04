import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../../core/api/api.client';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import type { SfStatusTone } from '../../../shared/components/display/sf-status.component';
import { releaseTone } from '../../pages/folder-view.util';
import { statusFor, statusIcon, statusLabel } from '../../release/release-status.util';
import {
  GRID_CHUNK,
  MEDIA_SORTS,
  MEDIA_TYPE_FILTERS,
  MEDIA_VIEWS,
  type MediaSort,
  type MediaSortDirection,
  type MediaTypeFilter,
  type MediaViewMode,
  PAGE_SIZE,
  findFolder,
  findFolderByPath,
  findParentFolder,
  folderChain,
  parseSort,
  sortParam,
  visibleMedia,
} from './media-library.util';

export type MediaView = components['schemas']['MediaView'];
export type MediaSummaryView = components['schemas']['MediaSummaryView'];
export type FolderView = components['schemas']['FolderView'];

/** The query parameters this screen owns, as the route hands them over (the URL is the source of truth). */
export interface MediaRouteParams {
  readonly folder?: string | null;
  readonly asset?: string | null;
  readonly q?: string | null;
  readonly type?: string | null;
  readonly sort?: string | null;
  readonly media?: string | null;
  /** The drawer's tab (`details`, `source`, …); absent: Details. */
  readonly mtab?: string | null;
  /** `favorites=1`: the main pane shows the Favorites list instead of a folder. */
  readonly favorites?: string | null;
}

/** A file that is not (fully) released: what its card and row show as a status icon. */
export interface MediaFileStatus {
  readonly label: string;
  readonly tone: SfStatusTone;
  readonly icon: string;
}

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/** The list fields a full media view (an upload's answer, a saved file) tells the list about. */
function summaryOf(view: MediaView, existing: MediaSummaryView | undefined, folderPath: string | undefined): MediaSummaryView {
  return {
    ...existing,
    uuid: view.uuid,
    uid: view.uid,
    displayName: view.displayName,
    mimeType: view.mimeType,
    sizeBytes: view.sizeBytes,
    folderPath: existing?.folderPath ?? folderPath,
    revision: view.revision,
    processCms: view.processCms,
    textEditable: view.textEditable,
    localized: view.localized,
    width: view.image?.width ?? existing?.width,
    height: view.image?.height ?? existing?.height,
    changedAt: new Date().toISOString(),
    usageCount: existing?.usageCount ?? 0,
    release: view.release,
    scheduled: view.scheduled,
  };
}

/**
 * What the media library screen shares between its parts: the open folder's files with the toolbar's search, type filter and
 * sort, the selection, the view (grid or list), the project-wide list behind the folder tree's counts, the folder tree and
 * the open detail drawer. Provided by `MediaLibraryComponent`.
 *
 * **The URL is the source of truth** (M35.19): the folder (`folder`), the open file (`asset`), the search (`q`), the type
 * filter (`type`), the sort (`sort=<field>-<asc|desc>`) and the view (`media`) are applied from the route with
 * {@link applyRoute}; every change a person makes goes through the router (`openFolder`, `openAsset`, `setSearch`, …), so
 * back, forward and deep links restore them. Defaults are left out of the URL.
 *
 * **The folder's files** are read page by page until the folder is complete (the backend has no sort or filter of its own),
 * then searched, filtered and sorted here. The grid renders them in chunks (`shown`), the list virtualises its rows.
 */
@Injectable()
export class MediaLibraryStore {
  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly access = inject(ProjectAccessStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly preferences = inject(PreferencesService);
  private readonly editingLocale = inject(EditingLocaleStore);
  private readonly permissions = inject(ProjectPermissionsStore);

  /** Time travel or an archived project (M26). */
  readonly readOnly = this.access.readOnly;
  readonly readOnlyLabel = this.access.readOnlyLabel;
  /**
   * The person may change the library: an editor (or better) in a project that can be changed. A viewer and a past revision
   * see the files, download and copy links, but no rename, move, delete, upload or folder change.
   */
  readonly canEdit = computed(() => !this.readOnly() && this.permissions.canEditContent());

  projectKey!: Signal<string>;
  private readonly searchUrl$ = new Subject<string>();
  /** The `q` the URL holds or is about to hold, so a route echo of an older text does not overwrite what is being typed. */
  private urlSearch = '';
  private readSeq = 0;

  // ── The open folder's files ────────────────────────────────────────────────

  /** Every file of the open folder that has been read so far. */
  readonly items = signal<MediaSummaryView[]>([]);
  /** The first page of the open folder is on its way. */
  readonly loading = signal(false);
  /** The rest of a big folder is still being read. */
  readonly loadingMore = signal(false);
  /** The folder could not be read. */
  readonly failed = signal(false);
  /** The open folder has been read (so an empty list means an empty folder, not an unfinished read). */
  readonly loaded = signal(false);
  readonly totalElements = signal(0);

  // ── What the URL says ──────────────────────────────────────────────────────

  /** The open folder's uuid; empty for the library root. */
  readonly folderUuid = signal('');
  /** The open file's uuid, if the URL names one. */
  readonly assetUuid = signal<string | null>(null);
  /** `?favorites=1` — the main pane shows the Favorites list (decision 58) instead of a folder. */
  readonly favoritesView = signal(false);
  /** The drawer's tab the URL names (`?mtab=`); `null` is Details. */
  readonly tabParam = signal<string | null>(null);
  /** The search box's text (updated at once; the URL follows after a short pause). */
  readonly search = signal('');
  readonly typeFilter = signal<MediaTypeFilter>('all');
  readonly sort = signal<MediaSort>('name');
  readonly direction = signal<MediaSortDirection>('asc');
  /** `?media=` — overrides the stored view; `null` when the URL does not say. */
  readonly viewParam = signal<MediaViewMode | null>(null);
  /** The view in use: the URL's, else the one stored in the user's preferences. */
  readonly view = computed<MediaViewMode>(() => this.viewParam() ?? this.preferences.mediaView());

  /** The files after search and type filter, sorted. */
  readonly visible = computed(() => visibleMedia(this.items(), this.search(), this.typeFilter(), this.sort(), this.direction()));
  /** How many cards the grid renders (it grows as the end scrolls into view). */
  readonly renderLimit = signal(GRID_CHUNK);
  readonly shown = computed(() => this.visible().slice(0, this.renderLimit()));
  readonly hasMoreToShow = computed(() => this.visible().length > this.renderLimit());
  /** Search or type filter narrows the folder. */
  readonly filtered = computed(() => this.search().trim() !== '' || this.typeFilter() !== 'all');

  readonly selected = signal<string[]>([]);
  readonly selectedItems = computed(() => {
    const ids = new Set(this.selected());
    return this.visible().filter((item) => !!item.uuid && ids.has(item.uuid));
  });
  readonly selectedMedia = signal<MediaView | null>(null);
  /** The URL names a file that is not in the library (any more): the screen drops the parameter. */
  readonly assetGone = signal(false);

  /**
   * Every media item in the project, fetched once (unfiltered — no `folder`/`q`/`mimeType`), independent of the open
   * folder's list. It feeds the folder tree's file counts, the delete confirmations and the lookups of where a file lives.
   */
  readonly allMedia = signal<MediaSummaryView[]>([]);
  /** The project-wide list has been read (or failed). */
  readonly allLoaded = signal(false);
  readonly allFailed = signal(false);

  readonly tree = this.project.mediaFolderTree;

  /** The project's fixed, protected "All Media" wrapper root: it stands for the library root. */
  readonly mediaRoot = computed<FolderView | null>(() => this.tree()[0] ?? null);
  /** The folder tree has been read: the library root exists. */
  readonly treeReady = computed(() => this.mediaRoot() !== null);
  /** The store's real top-level folders — the wrapper root's children. */
  readonly topLevelFolders = computed<FolderView[]>(() => this.mediaRoot()?.children ?? []);
  /** The project is being read and there is no folder tree yet. */
  readonly treeLoading = computed(() => !this.treeReady() && this.project.loading());
  /** The project could not be read: there is no folder tree to show. */
  readonly treeError = computed(() => !this.treeReady() && !this.project.loading() && !!this.project.error());
  /** No folders and no files at all (and both lists were read): the library explains what to do. */
  readonly libraryEmpty = computed(
    () => this.treeReady() && this.allLoaded() && !this.allFailed() && this.topLevelFolders().length === 0 && this.allMedia().length === 0,
  );

  /** The open folder; `null` at the root (and for a folder uuid that is not in the tree). */
  readonly folderNode = computed<FolderView | null>(() => {
    const uuid = this.folderUuid();
    return uuid ? findFolder(this.tree(), uuid) : null;
  });
  /** The open folder's own folders (the top level's at the root), narrowed by the search; shown before the files. */
  readonly subfolders = computed<FolderView[]>(() => {
    const query = this.search().trim().toLowerCase();
    const folders = this.folderUuid() ? (this.folderNode()?.children ?? []) : this.topLevelFolders();
    return folders
      .filter((folder) => !query || (folder.displayName ?? folder.uid ?? '').toLowerCase().includes(query))
      .sort((a, b) => (a.displayName ?? a.uid ?? '').localeCompare(b.displayName ?? b.uid ?? '', undefined, { sensitivity: 'base', numeric: true }));
  });
  /** The URL names a folder that is not in the tree (deleted, or from another project). */
  readonly folderGone = computed(() => !!this.folderUuid() && this.treeReady() && this.folderNode() === null);
  readonly folderPath = computed(() => this.folderNode()?.path ?? '');
  /** The folders from the top level down to the open one (empty at the root). */
  readonly folderTrail = computed<FolderView[]>(() => {
    const uuid = this.folderUuid();
    return uuid ? folderChain(this.topLevelFolders(), uuid) : [];
  });

  /** `allMedia` grouped by canonical folder path: the tree's file counts and what a folder delete takes along. */
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
    return map;
  });

  /**
   * The folder a folder or media item sits in right now — what its move is undone back to. `undefined` is the root
   * ("All media"), which a move addresses with no folder; also the answer for an unknown uuid.
   */
  parentFolderUuidOf(uuid: string): string | undefined {
    const rootUuid = this.mediaRoot()?.uuid;
    const itemPath = this.allMedia().find((m) => m.uuid === uuid)?.folderPath;
    const parent = itemPath != null ? findFolderByPath(this.tree(), itemPath) : findParentFolder(this.tree(), uuid);
    return parent?.uuid && parent.uuid !== rootUuid ? parent.uuid : undefined;
  }

  /** What a folder or media item is called, for messages; `undefined` for an unknown uuid. */
  labelOf(uuid: string): string | undefined {
    const folder = findFolder(this.tree(), uuid);
    if (folder) {
      return folder.displayName ?? folder.uid;
    }
    const media = this.allMedia().find((m) => m.uuid === uuid) ?? this.items().find((m) => m.uuid === uuid);
    return media?.displayName ?? media?.uid;
  }

  /** The status icon of a file that has something unreleased in the editing language; `null` for a released file. */
  statusOf(item: MediaSummaryView): MediaFileStatus | null {
    const status = statusFor(item.release, this.editingLocale.locale());
    return status === null || status === 'PUBLISHED'
      ? null
      : { label: statusLabel(status), tone: releaseTone(status), icon: statusIcon(status) };
  }

  /** The uuid of whichever media item's detail drawer is currently open. */
  readonly selectedMediaUuid = computed<string | null>(() => this.selectedMedia()?.uuid ?? null);

  constructor() {
    this.searchUrl$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((q) => {
      this.urlSearch = q;
      this.navigate({ q: q || null }, true);
    });
  }

  connect(projectKey: Signal<string>): void {
    this.projectKey = projectKey;
  }

  // ── The URL ────────────────────────────────────────────────────────────────

  /**
   * Takes what the route says. Anything that changes what the grid shows resets the chunked rendering; a different folder
   * also drops the selection (the files are read again by the screen). A `q` that is only the echo of what is being
   * typed leaves the search box alone.
   */
  applyRoute(params: MediaRouteParams): void {
    const folder = params.folder ?? '';
    if (folder !== this.folderUuid()) {
      this.folderUuid.set(folder);
      this.selected.set([]);
      this.renderLimit.set(GRID_CHUNK);
    }
    this.assetUuid.set(params.asset || null);
    this.favoritesView.set(!!params.favorites);
    const q = params.q ?? '';
    if (q !== this.urlSearch) {
      this.urlSearch = q;
      this.search.set(q);
    }
    const type = oneOf(params.type, MEDIA_TYPE_FILTERS) ?? 'all';
    const sort = parseSort(params.sort) ?? { sort: 'name' as const, direction: 'asc' as const };
    if (type !== this.typeFilter() || sort.sort !== this.sort() || sort.direction !== this.direction()) {
      this.renderLimit.set(GRID_CHUNK);
    }
    this.typeFilter.set(type);
    this.sort.set(sort.sort);
    this.direction.set(sort.direction);
    this.viewParam.set(oneOf(params.media, MEDIA_VIEWS));
    this.tabParam.set(params.mtab || null);
    this.pruneSelection();
  }

  /** Goes to the URL; resolves `false` when the router refused (the drawer's leave guard, after the person kept unsaved edits). */
  private navigate(queryParams: Record<string, string | null>, replace: boolean): Promise<boolean> {
    // A closed drawer forgets its tab; a file stepped to keeps it (it falls back to Details when it does not apply).
    const closing = 'asset' in queryParams && queryParams['asset'] === null && !('mtab' in queryParams) && this.tabParam() !== null;
    const params = closing ? { ...queryParams, mtab: null } : queryParams;
    return Promise.resolve(
      this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: replace }),
    ).then((done) => done !== false);
  }

  /**
   * Opens a folder (`null`: the root). Opening a folder closes the open file, as the file belongs to its own folder.
   * Resolves `false` when the drawer's leave guard (`mediaLeaveGuard`) kept the open file.
   */
  openFolder(uuid: string | null): Promise<boolean> {
    if ((uuid ?? '') === this.folderUuid() && !this.assetUuid() && !this.favoritesView()) {
      return Promise.resolve(true);
    }
    // Leaving the Favorites list drops its parameter; otherwise the URL stays as it was.
    return this.navigate({ folder: uuid || null, asset: null, ...(this.favoritesView() ? { favorites: null } : {}) }, false);
  }

  /** Opens the Favorites list in the main pane (the tree's pinned *Favorites* node); no folder or file stays open. */
  openFavorites(): Promise<boolean> {
    if (this.favoritesView() && !this.folderUuid() && !this.assetUuid()) {
      return Promise.resolve(true);
    }
    return this.navigate({ favorites: '1', folder: null, asset: null }, false);
  }

  /** Opens a file in the drawer, or closes the drawer with `null`; the leave guard asks about unsaved edits of the open file. */
  openAsset(uuid: string | null): Promise<boolean> {
    if ((uuid ?? null) === this.assetUuid()) {
      return Promise.resolve(true);
    }
    return this.navigate({ asset: uuid }, false);
  }

  /** The URL names a folder that does not exist (any more): drops the parameter (the library shows its root). */
  forgetFolder(): void {
    this.navigate({ folder: null }, true);
  }

  /** The URL names a file that does not exist (any more): drops the parameter. */
  forgetAsset(): void {
    this.navigate({ asset: null }, true);
  }

  /** The URL names a file in another folder than the open one: shows that file's folder, keeping the file open. */
  showFolderOfAsset(folder: string): void {
    this.navigate({ folder: folder || null }, true);
  }

  /** The search box's text: filters at once, reaches the URL after a short pause (a replaced entry). */
  setSearch(value: string): void {
    this.search.set(value);
    this.renderLimit.set(GRID_CHUNK);
    this.pruneSelection();
    this.searchUrl$.next(value.trim());
  }

  setTypeFilter(value: MediaTypeFilter): void {
    this.navigate({ type: value === 'all' ? null : value }, true);
  }

  setSort(sort: MediaSort, direction: MediaSortDirection): void {
    if (!MEDIA_SORTS.includes(sort)) {
      return;
    }
    this.navigate({ sort: sortParam(sort, direction) }, true);
  }

  /** Stores the view in the user's preferences; a `?media=` in the URL follows, as it would override the choice. */
  setView(value: MediaViewMode): void {
    this.preferences.setMediaView(value);
    if (this.viewParam() !== null) {
      this.navigate({ media: value }, true);
    }
  }

  /** Search and type filter back to "everything". */
  clearFilters(): void {
    this.search.set('');
    this.urlSearch = '';
    this.navigate({ q: null, type: null }, true);
  }

  /** The grid asks for more cards (its end scrolled into view). */
  showMore(): void {
    if (this.hasMoreToShow()) {
      this.renderLimit.update((limit) => limit + GRID_CHUNK);
    }
  }

  /** Renders every card (End in the grid). */
  showAll(): void {
    this.renderLimit.set(Math.max(this.renderLimit(), this.visible().length));
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  /** Starts over for another folder: nothing of the previous one stays on screen. */
  loadFolder(): void {
    this.items.set([]);
    this.totalElements.set(0);
    this.loaded.set(false);
    this.reload();
  }

  /** Reads the open folder again; what is on screen stays until the answer arrives. */
  reload(onLoaded?: () => void): void {
    const seq = ++this.readSeq;
    this.loading.set(true);
    this.failed.set(false);
    this.api.listMedia(this.projectKey(), this.query(0)).subscribe({
      next: (res) => {
        if (seq !== this.readSeq) {
          return;
        }
        this.items.set(res.content ?? []);
        this.totalElements.set(res.totalElements ?? 0);
        this.loading.set(false);
        this.loaded.set(true);
        this.pruneSelection();
        onLoaded?.();
        this.readRest(seq, 1);
      },
      error: () => {
        if (seq === this.readSeq) {
          this.loading.set(false);
          this.failed.set(true);
        }
      },
    });
  }

  /** Reads the remaining pages of a big folder, one after the other; the list grows as they arrive. */
  private readRest(seq: number, page: number): void {
    if (seq !== this.readSeq || this.items().length >= this.totalElements()) {
      this.loadingMore.set(false);
      return;
    }
    this.loadingMore.set(true);
    this.api.listMedia(this.projectKey(), this.query(page)).subscribe({
      next: (res) => {
        if (seq !== this.readSeq) {
          return;
        }
        const content = res.content ?? [];
        this.items.update((list) => [...list, ...content]);
        this.totalElements.set(res.totalElements ?? this.items().length);
        // An empty page ends the read even when the total says there should be more (files deleted meanwhile).
        if (content.length === 0) {
          this.loadingMore.set(false);
          return;
        }
        this.readRest(seq, page + 1);
      },
      error: () => {
        if (seq === this.readSeq) {
          this.loadingMore.set(false);
          this.failed.set(this.items().length === 0);
        }
      },
    });
  }

  /** Every media item in the project, unfiltered — feeds `allMedia`/`mediaByFolder` (the tree's counts). */
  loadAllMedia(key: string): void {
    if (!key) {
      return;
    }
    this.api.listMedia(key, { page: 0, size: 10000 }).subscribe({
      next: (res) => {
        this.allMedia.set(res.content ?? []);
        this.allFailed.set(false);
        this.allLoaded.set(true);
      },
      error: () => {
        this.allMedia.set([]);
        this.allFailed.set(true);
        this.allLoaded.set(true);
      },
    });
  }

  /** The open folder and the project-wide list both re-read. */
  reloadMedia(): void {
    this.reload();
    this.loadAllMedia(this.projectKey());
  }

  /** Reads the project (and with it the folder tree) again. */
  reloadTree(): void {
    this.project.loadFor(this.projectKey(), true).subscribe();
  }

  /** Folder tree, files and counts all re-read (after a folder was created, moved, renamed or deleted). */
  reloadFolders(): void {
    // The files are read with the folder's path, so the tree comes first.
    this.project.loadFor(this.projectKey(), true).subscribe(() => this.reloadMedia());
  }

  private query(page: number): { folder: string; page: number; size: number } {
    // "All media" (the root) means the fixed wrapper root's own path — every asset nests under it — and matches only
    // files placed directly there, never nested ones (see `recursive`, default false).
    return { page, size: PAGE_SIZE, folder: this.folderPath().trim() || this.mediaRoot()?.path || '/' };
  }

  // ── Selection ───────────────────────────────────────────────────────────

  isSelected(uuid?: string): boolean {
    return uuid != null && this.selected().includes(uuid);
  }

  toggle(uuid?: string): void {
    if (!uuid) {
      return;
    }
    this.selected.update((list) => (list.includes(uuid) ? list.filter((x) => x !== uuid) : [...list, uuid]));
  }

  /** Selects the files between `fromUuid` and `toUuid` (inclusive) of the visible list, keeping the rest. */
  selectRange(fromUuid: string, toUuid: string): void {
    const ids = this.visible().map((item) => item.uuid ?? '');
    const [a, b] = [ids.indexOf(fromUuid), ids.indexOf(toUuid)].sort((x, y) => x - y);
    if (a < 0) {
      return;
    }
    const range = ids.slice(a, b + 1);
    this.selected.update((list) => [...new Set([...list, ...range])]);
  }

  /** Selects every visible file (Ctrl/⌘+A). */
  selectAll(): void {
    this.selected.set(this.visible().flatMap((item) => (item.uuid ? [item.uuid] : [])));
  }

  setSelection(uuids: readonly string[]): void {
    this.selected.set([...uuids]);
  }

  clearSelection(): void {
    this.selected.set([]);
  }

  /** What is selected but no longer in the visible list (filtered out, deleted, moved away) leaves the selection. */
  private pruneSelection(): void {
    const selected = this.selected();
    if (selected.length === 0) {
      return;
    }
    const visible = new Set(this.visible().map((item) => item.uuid));
    const kept = selected.filter((uuid) => visible.has(uuid));
    if (kept.length !== selected.length) {
      this.selected.set(kept);
    }
  }

  // ── The detail drawer ───────────────────────────────────────────────────

  /**
   * Makes the drawer show the file the URL names: from the open folder's list, else from the project-wide list. A file
   * that is in neither once the project-wide list is read is gone (`assetGone`). The drawer's own richer copy of a file
   * (after a save) is kept while the URL still names that file.
   */
  resolveAsset(uuid: string | null): void {
    if (!uuid) {
      this.assetGone.set(false);
      if (this.selectedMedia() !== null) {
        this.selectedMedia.set(null);
      }
      return;
    }
    if (this.selectedMedia()?.uuid === uuid) {
      this.assetGone.set(false);
      return;
    }
    const found = this.items().find((i) => i.uuid === uuid) ?? this.allMedia().find((i) => i.uuid === uuid);
    if (found) {
      this.assetGone.set(false);
      this.selectedMedia.set(found as MediaView);
    } else if (this.allLoaded()) {
      this.assetGone.set(true);
      this.selectedMedia.set(null);
    }
  }

  /** The folder a file lives in: `''` at the root, `null` when the library does not know the file. */
  folderUuidOfAsset(uuid: string): string | null {
    const path = this.allMedia().find((i) => i.uuid === uuid)?.folderPath;
    if (path == null) {
      return null;
    }
    const node = findFolderByPath(this.tree(), path);
    return node?.uuid && node.uuid !== this.mediaRoot()?.uuid ? node.uuid : '';
  }

  /** The folder the open file lives in (`/media_root/photos/`), from the lists; `null` before they know the file. */
  readonly assetFolderPath = computed(() => {
    const uuid = this.assetUuid();
    return uuid ? ((this.items().find((i) => i.uuid === uuid) ?? this.allMedia().find((i) => i.uuid === uuid))?.folderPath ?? null) : null;
  });

  /** The UIDs of every file of the project: the Source tab completes `media:<uid>` references with them. */
  readonly mediaUids = computed(() => this.allMedia().flatMap((i) => (i.uid ? [i.uid] : [])));

  /** The drawer's tab goes into the URL (`?mtab=`, a replaced entry); Details is the default and is left out. */
  setDetailTab(tab: string): void {
    this.navigate({ mtab: tab === 'details' ? null : tab }, true);
  }

  /** The open file's place in the visible list (for ←/→ and "3 of 12"); `index` is -1 when it is not in it. */
  readonly detailPosition = computed(() => {
    const uuid = this.assetUuid();
    const list = this.visible();
    return { index: uuid ? list.findIndex((item) => item.uuid === uuid) : -1, count: list.length };
  });

  /** Opens the previous (-1) or next (+1) file of the visible list, wrapping (the drawer's ←/→). */
  stepAsset(delta: -1 | 1): void {
    const { index, count } = this.detailPosition();
    const target = index < 0 || count < 2 ? null : this.visible()[(index + delta + count) % count].uuid;
    if (target) {
      this.openAsset(target);
    }
  }

  /** The drawer closed itself (it has asked about unsaved edits already). */
  closeDetail(): void {
    if (this.assetUuid()) {
      this.navigate({ asset: null }, false);
    }
  }

  /**
   * A file was renamed: the grid, the project-wide list (the tree's lookups) and an open drawer show the new name and the
   * revision the rename produced (a later save of the drawer is guarded by it).
   */
  onRenamed(uuid: string, displayName: string, revision: number | null | undefined): void {
    const renamed = <T extends { uuid?: string; displayName?: string; revision?: number }>(item: T): T =>
      item.uuid === uuid ? { ...item, displayName, revision: revision ?? item.revision } : item;
    this.items.update((list) => list.map(renamed));
    this.allMedia.update((list) => list.map(renamed));
    if (this.selectedMedia()?.uuid === uuid) {
      this.selectedMedia.update((open) => (open ? renamed(open) : open));
    }
  }

  /**
   * A file's UID was changed (or changed back): the grid, the project-wide list (`mediaUids`) and an open drawer show the
   * new one at once. Favorites and recents hold the uuid, so they need nothing.
   */
  onUidChanged(uuid: string, uid: string): void {
    const changed = <T extends { uuid?: string; uid?: string }>(item: T): T => (item.uuid === uuid && item.uid !== uid ? { ...item, uid } : item);
    this.items.update((list) => list.map(changed));
    this.allMedia.update((list) => list.map(changed));
    if (this.selectedMedia()?.uuid === uuid) {
      this.selectedMedia.update((open) => (open ? changed(open) : open));
    }
  }

  onUpdated(updated: MediaView): void {
    this.items.update((list) => list.map((i) => (i.uuid === updated.uuid ? summaryOf(updated, i, i.folderPath) : i)));
    this.allMedia.update((list) => list.map((i) => (i.uuid === updated.uuid ? summaryOf(updated, i, i.folderPath) : i)));
    // A file saved from elsewhere (the upload panel's alt text, a replace) must not open its drawer.
    if (this.assetUuid() === updated.uuid || this.selectedMedia()?.uuid === updated.uuid) {
      this.selectedMedia.set(updated);
    }
  }

  /** Discard changes rewrote the file's draft: reload it and reopen the drawer on the new state (M27.6.1). */
  onDiscarded(uuid: string): void {
    this.selectedMedia.set(null);
    this.reload(() => {
      const found = this.items().find((i) => i.uuid === uuid);
      if (found && this.assetUuid() === uuid) {
        this.selectedMedia.set(found as MediaView);
      }
    });
    this.loadAllMedia(this.projectKey());
  }

  onDeleted(uuid: string): void {
    this.items.update((list) => list.filter((i) => i.uuid !== uuid));
    this.allMedia.update((list) => list.filter((i) => i.uuid !== uuid));
    this.totalElements.update((t) => Math.max(0, t - 1));
    this.selected.update((list) => list.filter((x) => x !== uuid));
    if (this.selectedMedia()?.uuid === uuid) {
      this.selectedMedia.set(null);
    }
    if (this.assetUuid() === uuid) {
      this.navigate({ asset: null }, true);
    }
  }

  /**
   * A freshly uploaded item heads the folder's list (when that folder is still open) and the project-wide list.
   * `folderUuid` is the folder the upload went to (`''`/`undefined`: the root).
   */
  prepend(media: MediaView, folderUuid = this.folderUuid()): void {
    const target = folderUuid ? findFolder(this.tree(), folderUuid) : null;
    const folderPath = target?.path ?? this.mediaRoot()?.path;
    const summary = summaryOf(media, undefined, folderPath);
    if ((folderUuid || '') === this.folderUuid()) {
      this.items.update((list) => [summary, ...list.filter((i) => i.uuid !== media.uuid)]);
      this.totalElements.update((t) => t + 1);
    }
    this.allMedia.update((list) => [summary, ...list.filter((i) => i.uuid !== media.uuid)]);
  }
}
