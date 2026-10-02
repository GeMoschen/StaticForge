import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { tap, type Subscription } from 'rxjs';
import { consumeQueryParam } from '../../shared/deep-link';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import { findFolderByPath, findParentFolder, moveBackBody } from '../../shared/folder-tree.util';
import { FolderDetailComponent } from './folder-detail.component';
import { FolderNodeComponent } from './folder-node.component';
import { PageNavNodeComponent } from './page-nav-node.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { FolderMoveEvent } from './types';
import { sortByDisplayName, sortFolderTree } from '../../shared/tree-sort.util';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { PagesTreeRefresh } from './pages-tree-refresh.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ReleaseEventsStore, withObservedRelease } from '../release/release-events.store';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type TemplateSummary = components['schemas']['TemplateSummary'];
type FolderView = components['schemas']['FolderView'];

/**
 * Pages list: one unified navigation tree — folders contain pages, pages
 * contain bodies, bodies contain their currently assigned sections.
 * Clicking a page/body/section navigates to `PageEditorComponent` (see
 * `PageNavNodeComponent`). Supports search; "All pages" is the project's
 * page root.
 */
@Component({
  selector: 'sf-pages-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FolderDetailComponent,
    FolderNodeComponent,
    PageNavNodeComponent,
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    RouterOutlet,
  ],
  templateUrl: './pages-list.component.html',
  styleUrl: './pages-list.component.scss',
})
export class PagesListComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly treeRefresh = inject(PagesTreeRefresh);
  private readonly menu = inject(ContextMenuService);
  protected readonly clipboard = inject(TreeClipboardService);

  /** Time travel or an archived project (M26). */
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  readonly projectKey = input.required<string>();
  /** `?folder=<uuid>` selects that folder (search deep link, M23.4.1). */
  readonly folder = input<string | undefined>();
  private readonly router = inject(Router);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  private readonly route = inject(ActivatedRoute);

  private readonly timeTravel = inject(TimeTravelStore);
  /** The folder tree as it was at the revision being viewed (time travel); `null` until that read returns. */
  private readonly travelTree = signal<FolderView[] | null>(null);
  /** The store's tree, or while travelling the one of that revision — none meanwhile, never the present one. */
  protected readonly tree = computed<FolderView[]>(() =>
    this.timeTravel.isTimeTravel() ? (this.travelTree() ?? []) : this.store.pageFolderTree(),
  );
  protected readonly pageTemplates = computed<TemplateSummary[]>(() => this.store.pageTemplates());

  /** The project's fixed, protected "All Pages" wrapper root (mirrors `NAVIGATION`'s own fixed
   * root) — always the tree's sole top-level entry now, but this screen already has its own
   * "All pages" affordance (the `pages__clear` button below), so it's unwrapped here rather than
   * rendered a second time as an ordinary folder row. */
  protected readonly pagesRoot = computed<FolderView | null>(() => this.tree()[0] ?? null);
  /** The store's real top-level folders — the wrapper root's children. */
  protected readonly topLevelFolders = computed<FolderView[]>(() => this.pagesRoot()?.children ?? []);

  protected readonly selectedFolder = signal<string | null>(null);
  protected readonly search = signal('');
  private readonly loadedPages = signal<AssetSummaryView[]>([]);
  protected readonly pages = this.loadedPages.asReadonly();
  protected readonly loading = signal(false);

  /** Pages grouped by their canonical folder path, for the unified tree. */
  protected readonly pagesByFolder = computed<Map<string, AssetSummaryView[]>>(() => {
    const map = new Map<string, AssetSummaryView[]>();
    for (const page of this.pages()) {
      const path = page.folderPath ?? '/';
      const list = map.get(path);
      if (list) {
        list.push(page);
      } else {
        map.set(path, [page]);
      }
    }
    for (const [path, list] of map) {
      map.set(path, sortByDisplayName(list));
    }
    return map;
  });

  /** The currently selected folder's own node, for the metadata panel. */
  protected readonly selectedFolderNode = computed<FolderView | null>(() => {
    const uuid = this.selectedFolder();
    return uuid ? findFolder(this.tree(), uuid) : null;
  });

  protected readonly selectedFolderPageCount = computed<number>(
    () => (this.pagesByFolder().get(this.selectedFolderNode()?.path ?? '') ?? []).length,
  );

  protected readonly selectedFolderSubfolderCount = computed<number>(
    () => (this.selectedFolderNode()?.children ?? []).length,
  );

  /** Pages living directly in the "All Pages" wrapper root, keyed by its own canonical path
   * (no longer the bare project root path — see `pagesRoot`). */
  protected readonly rootPages = computed<AssetSummaryView[]>(
    () => this.pagesByFolder().get(this.pagesRoot()?.path ?? '/') ?? [],
  );

  protected readonly newPageOpen = signal(false);
  protected readonly creatingPage = signal(false);
  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  /** Parent folder targeted by the currently open "New subfolder" dialog — captured at open time since context-menu actions (e.g. "New subfolder" on the root) may target a folder other than whatever is currently selected. */
  private folderParentUuid: string | undefined = undefined;

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      this.store.loadFor(key).subscribe();
    });

    effect(() => {
      const uuid = this.folder();
      if (!uuid || !findFolder(this.tree(), uuid)) {
        return;
      }
      untracked(() => {
        this.selectFolder(uuid);
        consumeQueryParam(this.router, this.route, 'folder');
      });
    });

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        const q = this.search();
        this.releaseEvents.version();
        this.timeTravel.activeRevision();
        this.reload(key, q);
      },
      { allowSignalWrites: true },
    );

    // An undo restored or moved something back (M35.13): re-read the folder tree and the pages.
    effect(() => {
      if (this.treeRefresh.version() > 0) {
        untracked(() => this.onTreeChanged());
      }
    });

    // Time travel: the tree as it was then, with what was deleted since and without what was created later.
    effect(
      (onCleanup) => {
        const key = this.projectKey();
        const revision = this.timeTravel.activeRevision();
        this.travelTree.set(null);
        if (!key || revision === null) {
          return;
        }
        const read = this.api.listFolders(key, 'PAGES', 10, revision).subscribe({
          next: (tree) => this.travelTree.set(sortFolderTree(tree ?? [])),
          error: () => this.travelTree.set([]),
        });
        onCleanup(() => read.unsubscribe());
      },
      { allowSignalWrites: true },
    );

    // An open editor's release bar read a new status: the tree row shows it at once (M27.6.1).
    effect(
      () => {
        const observed = this.releaseEvents.observed();
        const next = untracked(() => withObservedRelease(this.loadedPages(), observed));
        if (next) {
          this.loadedPages.set(next);
        }
      },
      { allowSignalWrites: true },
    );
  }

  /** The read of the list in flight: a newer one (another search, another revision) replaces it. */
  private pagesRead: Subscription | null = null;

  protected reload(key: string, q: string): void {
    this.loading.set(true);
    this.pagesRead?.unsubscribe();
    this.pagesRead = this.api
      .listPages(key, {
        q: q.trim() || undefined,
        revision: this.timeTravel.activeRevision() ?? undefined,
      })
      .subscribe({
        next: (pages) => {
          this.loadedPages.set(pages ?? []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected newFolder(): void {
    this.createFolderUnder(this.selectedFolder() ?? undefined);
  }

  private createFolderUnder(parentUuid: string | undefined): void {
    if (this.readOnly()) {
      return;
    }
    this.folderParentUuid = parentUuid;
    this.newFolderOpen.set(true);
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    if (this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    this.creatingFolder.set(true);
    this.api
      .createFolder(key, {
        displayName: value.displayName,
        parentFolderUuid: this.folderParentUuid,
        scope: 'PAGES',
      })
      .subscribe({
        next: () => {
          this.creatingFolder.set(false);
          this.newFolderOpen.set(false);
          this.toast.show('Folder created', 'success');
          this.onTreeChanged();
        },
        error: () => {
          this.creatingFolder.set(false);
          this.toast.show('Could not create folder — a folder with that name may already exist here.', 'error');
        },
      });
  }

  protected openNewPage(): void {
    if (this.readOnly()) {
      return;
    }
    this.newPageOpen.set(true);
  }

  protected closeNewPage(): void {
    this.newPageOpen.set(false);
  }

  protected submitNewPage(value: CreateAssetFormValue): void {
    if (this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    this.creatingPage.set(true);
    this.api
      .createPage(key, {
        displayName: value.displayName,
        templateUuid: value.templateUuid,
        // Read live, at submit time — the folder targeted by the dialog is
        // whichever one is selected right now, not whatever was selected
        // when the dialog first opened.
        folderUuid: this.selectedFolder() ?? undefined,
      })
      .subscribe({
        next: () => {
          this.creatingPage.set(false);
          this.newPageOpen.set(false);
          this.toast.show('Page created', 'success');
          this.reload(key, this.search());
        },
        error: () => {
          this.creatingPage.set(false);
          this.toast.show('Could not create page — check a template is selected and try again.', 'error');
        },
      });
  }

  protected selectFolder(uuid: string | null): void {
    this.selectedFolder.set(uuid);
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.set(value);
  }

  /** Handles both folder-onto-folder and page-onto-folder drags — the generic move endpoint dispatches by asset type. */
  protected moveItemTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target || this.readOnly()) {
      return;
    }
    const key = this.projectKey();
    const back = this.moveBack(event.source);
    const message = `Moved “${this.nameOf(event.source)}” to ${this.nameOf(event.target)}.`;
    this.api.moveAsset(key, event.source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.offerMoveUndo(key, event.source!, back, message);
        this.onTreeChanged();
      },
      error: () => this.toast.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  /** Drop target for the "All pages" root button — moves the dragged item to the project root. */
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
    const key = this.projectKey();
    const back = this.moveBack(source);
    const message = `Moved “${this.nameOf(source)}” to the root.`;
    this.api.moveAsset(key, source, {}).subscribe({
      next: () => {
        this.offerMoveUndo(key, source, back, message);
        this.onTreeChanged();
      },
      error: () => this.toast.show('Could not move — try again in a moment.', 'error'),
    });
  }

  /** The display name of a page or folder in the tree, for the toast text. */
  private nameOf(uuid: string): string {
    const page = this.loadedPages().find((p) => p.uuid === uuid);
    const folder = findFolder(this.tree(), uuid);
    return page?.displayName ?? page?.uid ?? folder?.displayName ?? folder?.uid ?? 'item';
  }

  /** Where a page or folder lives now, as the body of the move that puts it back (`{}` = the project root). */
  private moveBack(uuid: string): { folderUuid?: string } {
    const root = this.pagesRoot();
    const page = this.loadedPages().find((p) => p.uuid === uuid);
    const parent = page
      ? findFolderByPath(this.tree(), page.folderPath ?? '/')
      : findParentFolder(this.tree(), uuid);
    return moveBackBody(parent, root?.uuid);
  }

  /** One Undo for a move: moves the item back to the folder it came from. */
  private offerMoveUndo(key: string, uuid: string, back: { folderUuid?: string }, message: string): void {
    this.undo.offer(message, () => this.api.moveAsset(key, uuid, back).pipe(tap(() => this.treeRefresh.notify())));
  }

  /** "All pages" is the project's page root — it can't be renamed, deleted, cut, or pasted into, but you can create pages/subfolders directly in it. */
  protected onRootContextMenu(event: MouseEvent): void {
    if (this.readOnly()) {
      return;
    }
    const items: ContextMenuItem[] = [
      {
        label: 'New page',
        icon: 'note_add',
        action: () => {
          this.selectFolder(null);
          this.openNewPage();
        },
      },
      { label: 'New subfolder', icon: 'create_new_folder', action: () => this.createFolderUnder(undefined) },
    ];
    this.menu.open(event, items);
  }

  /** Reloads both the folder tree and the pages list — used after any create/rename/move/delete/duplicate. */
  protected onTreeChanged(): void {
    this.store.loadFor(this.projectKey(), true).subscribe();
    this.reload(this.projectKey(), this.search());
  }

  protected onFolderDeleted(): void {
    this.selectedFolder.set(null);
    this.onTreeChanged();
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
