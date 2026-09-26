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
import { ActivatedRoute, Router } from '@angular/router';
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
import { MediaNavNodeComponent } from './media-nav-node.component';
import { sortByDisplayName } from '../../shared/tree-sort.util';
import { consumeQueryParam } from '../../shared/deep-link';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { ReleaseBadgeComponent } from '../release/release-badge.component';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';
import { deleteQuestion, isOnline } from '../release/release-status.util';

type MediaView = components['schemas']['MediaView'];
type MediaSummaryView = components['schemas']['MediaSummaryView'];
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
    MediaNavNodeComponent,
    ReleaseBadgeComponent,
  ],
  templateUrl: './media-library.component.html',
  styleUrl: './media-library.component.scss',
})
export class MediaLibraryComponent implements AfterViewInit, OnDestroy {
  readonly projectKey = input.required<string>();
  /** `?asset=<uuid>` opens that media item's detail drawer (search deep link, M23.4.1). */
  readonly asset = input<string | undefined>();
  /** `?folder=<uuid>` selects that folder. */
  readonly folder = input<string | undefined>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  protected readonly clipboard = inject(TreeClipboardService);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  /** Localized media shows the editing language's file (M27.6.4). */
  private readonly editingLocale = inject(EditingLocaleStore);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;
  protected readonly readOnlyLabel = inject(ProjectAccessStore).readOnlyLabel;

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
  private readonly detailDrawer = viewChild<MediaDetailDrawerComponent>('detailDrawer');

  private readonly thumbUrls = signal<Record<string, string>>({});
  private readonly thumbRequested = new Set<string>();

  readonly hasMore = computed(() => this.items().length < this.totalElements());
  readonly dragActive = computed(() => this.dragCounter() > 0);

  protected readonly tree = this.project.mediaFolderTree;

  /** The project's fixed, protected "All Media" wrapper root (mirrors `NAVIGATION`'s own fixed
   * root) — always the tree's sole top-level entry now, but this screen already has its own
   * "All media" affordance (the `library__clear` button), so it's unwrapped here rather than
   * rendered a second time as an ordinary folder row. */
  protected readonly mediaRoot = computed<FolderView | null>(() => this.tree()[0] ?? null);
  /** The store's real top-level folders — the wrapper root's children. */
  protected readonly topLevelFolders = computed<FolderView[]>(() => this.mediaRoot()?.children ?? []);

  /** Media items living directly in the "All Media" wrapper root, rendered as tree leaves
   * alongside `topLevelFolders` (mirrors `PagesListComponent.rootPages`). */
  protected readonly rootMedia = computed<MediaSummaryView[]>(
    () => this.mediaByFolder().get(this.mediaRoot()?.path ?? '/') ?? [],
  );

  /** The selected folder's direct subfolders (top-level store folders when nothing is
   * selected) — the content grid shows these, then this folder's own media, never descendants. */
  protected readonly currentFolderChildren = computed<FolderView[]>(() => {
    const uuid = this.folderUuid();
    if (!uuid) {
      return this.topLevelFolders();
    }
    return findFolder(this.tree(), uuid)?.children ?? [];
  });

  /** Every media item in the project, fetched once (unfiltered — no `folder`/`q`/`mimeType`),
   * independent of the grid's own paginated/filtered `items()` — feeds the sidebar tree's leaf
   * rows (mirrors `PagesListComponent.pages`/`pagesByFolder`), so the tree shows every item
   * regardless of the grid's current folder/search/type filter. */
  protected readonly allMedia = signal<MediaSummaryView[]>([]);

  /** `allMedia` grouped by canonical folder path, for the tree (mirrors
   * `PagesListComponent.pagesByFolder`/`FolderNodeComponent.ownPages`). */
  protected readonly mediaByFolder = computed<Map<string, MediaSummaryView[]>>(() => {
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

  /** The uuid of whichever media item's detail drawer is currently open, for tree-leaf
   * highlighting. */
  protected readonly selectedMediaUuid = computed<string | null>(() => this.selectedMedia()?.uuid ?? null);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => {
        this.reload();
        this.loadAllMedia(key);
      });
    });

    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((q) => {
        this.search.set(q);
        this.reload();
      });

    // Deep links apply once what they name has loaded, then clear themselves.
    effect(() => {
      const uuid = this.asset();
      if (!uuid || !this.allMedia().some((item) => item.uuid === uuid)) {
        return;
      }
      untracked(() => {
        this.onSelectMediaLeaf(uuid);
        consumeQueryParam(this.router, this.route, 'asset');
      });
    });
    effect(() => {
      const uuid = this.folder();
      const node = uuid ? findFolder(this.tree(), uuid) : null;
      if (!node) {
        return;
      }
      untracked(() => {
        this.selectFolder(node);
        consumeQueryParam(this.router, this.route, 'folder');
      });
    });

    effect(() => {
      const key = this.projectKey();
      const locale = this.editingLocale.locale();
      for (const item of this.items()) {
        if (item.uuid && (item.mimeType ?? '').startsWith('image/')) {
          this.requestThumb(key, item.uuid, item.localized ? locale : null, item.revision ?? null);
        }
      }
    });

    // A release, unpublish, discard or schedule anywhere: the grid and the tree leaves re-read their statuses
    // (the folder tree itself is refreshed by the project shell).
    let seenReleaseVersion = this.releaseEvents.version();
    effect(() => {
      const version = this.releaseEvents.version();
      if (version === seenReleaseVersion) {
        return;
      }
      seenReleaseVersion = version;
      untracked(() => {
        this.reload();
        this.loadAllMedia(this.projectKey());
      });
    });

    // The drawer's release bar read a new status (e.g. after a save): the rows show it at once (M27.6.1).
    effect(
      () => {
        const observed = this.releaseEvents.observed();
        untracked(() => {
          const items = withObservedRelease(this.items(), observed);
          if (items) {
            this.items.set(items);
          }
          const all = withObservedRelease(this.allMedia(), observed);
          if (all) {
            this.allMedia.set(all);
          }
          const open = this.selectedMedia();
          const patched = open ? withObservedRelease([open], observed) : null;
          if (patched) {
            this.selectedMedia.set(patched[0]);
          }
        });
      },
      { allowSignalWrites: true },
    );
  }

  ngOnDestroy(): void {
    for (const url of Object.values(this.thumbUrls())) {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * `locale` for localized media: the thumbnail of the file that language renders, cached per language. Keyed by
   * revision too, so a replaced file (or a language's new own file) is fetched again instead of served stale.
   */
  private requestThumb(projectKey: string, uuid: string, locale: string | null, revision: number | null): void {
    const key = thumbKey(uuid, locale, revision);
    if (this.thumbRequested.has(key)) {
      return;
    }
    this.thumbRequested.add(key);
    this.api.mediaThumbnailBlob(projectKey, uuid, locale).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const stale = thumbKey(uuid, locale, null);
        this.thumbUrls.update((map) => {
          const next = { ...map };
          for (const [cached, old] of Object.entries(map)) {
            if (cached !== key && cached.startsWith(stale + '@')) {
              URL.revokeObjectURL(old);
              delete next[cached];
              this.thumbRequested.delete(cached);
            }
          }
          next[key] = url;
          return next;
        });
      },
      error: () => this.thumbRequested.delete(key),
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

  thumb(item: MediaView): string | null {
    if (!item.uuid) {
      return null;
    }
    const locale = item.localized ? this.editingLocale.locale() : null;
    return this.thumbUrls()[thumbKey(item.uuid, locale, item.revision ?? null)] ?? null;
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
    if (item?.uuid !== this.selectedMediaUuid() && !this.canLeaveDetail()) {
      return;
    }
    this.selectedMedia.set(item);
  }

  /** The open drawer may hold unsaved source edits (M18.4.1): switching files asks first. */
  private canLeaveDetail(): boolean {
    return this.detailDrawer()?.confirmDiscard() ?? true;
  }

  /** A tree leaf (`sf-media-nav-node`) was clicked — opens its detail drawer even when the item
   * isn't in the grid's current folder/search/type filter, by switching to its own folder and
   * clearing any active filter first (mirrors `openDetail`, but sourced from `allMedia` — the
   * unfiltered project-wide list — instead of the grid's own `items()`). */
  protected onSelectMediaLeaf(uuid: string): void {
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

  deleteSelection(): void {
    const uuids = this.selected();
    if (uuids.length === 0 || this.readOnly()) {
      return;
    }
    this.toasts.show(`Deleting ${uuids.length} media item(s)`, 'warning');
    // A published item stays online until its deletion is released (M27.6.1).
    const anyOnline = this.items().some((i) => i.uuid != null && uuids.includes(i.uuid) && isOnline(i.release));
    const confirmed = window.confirm(
      anyOnline
        ? `Delete ${uuids.length} media item(s)? Published items stay online until you release their deletion.`
        : `Delete ${uuids.length} media item(s)? This cannot be undone.`,
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
          this.allMedia.update((list) => list.filter((i) => i.uuid !== uuid));
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
    if (this.readOnly()) {
      return;
    }
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
    this.loadAllMedia(this.projectKey());
  }

  protected moveItemTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target || this.readOnly()) {
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
    if (!source || this.readOnly()) {
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
    if (this.readOnly()) {
      return;
    }
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
    if (!uuid || this.readOnly()) {
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
    if (!folder.uuid || this.readOnly()) {
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
    if (!uuid || this.readOnly()) {
      return;
    }
    const name = folder.displayName ?? folder.uid ?? 'this folder';
    if (!window.confirm(deleteQuestion(`Delete "${name}" and everything inside it? This cannot be undone.`, folder.release))) {
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
    if (this.readOnly()) {
      return;
    }
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
    const items: ContextMenuItem[] = [
      { label: 'Open details', icon: 'info', action: () => this.openDetail(uuid) },
    ];
    if (!this.readOnly()) {
      items.push(
        { label: 'Rename', icon: 'edit', action: () => this.renamingItem.set(item) },
        { label: 'Cut', icon: 'content_cut', action: () => this.clipboard.cut('MEDIA', uuid, label) },
        { label: '', separator: true },
        { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteOne(uuid, label) },
      );
    }
    this.menu.open(event, items);
  }

  protected closeRenameItem(): void {
    this.renamingItem.set(null);
  }

  protected submitRenameItemDisplayName(displayName: string): void {
    const item = this.renamingItem();
    const uuid = item?.uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    this.renamingItemName.set(true);
    this.api.renameAsset(this.projectKey(), uuid, { displayName }, item.revision ?? undefined).subscribe({
      next: () => {
        this.renamingItemName.set(false);
        this.renamingItem.set(null);
        this.toasts.show('Media renamed', 'success');
        this.reload();
        this.loadAllMedia(this.projectKey());
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
    this.loadAllMedia(this.projectKey());
  }

  /** A tree leaf's own rename/delete succeeded — refresh both the grid and the tree's leaf
   * bucket (mirrors `reloadFolders`, but without a folder-tree refetch since only the leaf
   * itself changed). */
  protected onMediaLeafChanged(): void {
    this.reload();
    this.loadAllMedia(this.projectKey());
  }

  private deleteOne(uuid: string, label: string): void {
    if (this.readOnly()) {
      return;
    }
    const release = this.items().find((i) => i.uuid === uuid)?.release;
    if (!window.confirm(deleteQuestion(`Delete "${label}"? This cannot be undone.`, release))) {
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
    if (this.readOnly()) {
      return;
    }
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
    // `MediaView` (the upload response) has no `folderPath` of its own — it was uploaded to
    // whichever folder is currently selected, so that's its folder now.
    const folderPath = this.folderPath() || this.mediaRoot()?.path;
    this.allMedia.update((list) => [
      { ...media, folderPath },
      ...list.filter((i) => i.uuid !== media.uuid),
    ]);
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

  private reload(onLoaded?: () => void): void {
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
  private loadAllMedia(key: string): void {
    if (!key) {
      return;
    }
    this.api.listMedia(key, { page: 0, size: 10000 }).subscribe({
      next: (res) => this.allMedia.set(res.content ?? []),
      error: () => this.allMedia.set([]),
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

/** `uuid|locale@revision`; without a revision, the prefix every revision of that file shares. */
function thumbKey(uuid: string, locale: string | null, revision: number | null): string {
  return `${uuid}|${locale ?? ''}${revision != null ? `@${revision}` : ''}`;
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

function findFolderByPath(nodes: FolderView[], path: string): FolderView | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const found = findFolderByPath(node.children ?? [], path);
    if (found) {
      return found;
    }
  }
  return null;
}
