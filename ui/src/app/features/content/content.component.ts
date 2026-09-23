import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, forkJoin, map, type Observable } from 'rxjs';
import { roleRank } from '../../core/auth/auth.guard';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import {
  SfStoreTreeNodeComponent,
  type StoreTreeMoveEvent,
  type StoreTreeNode,
} from '../../shared/components/sf-store-tree-node.component';
import { SfTreeComponent } from '../../shared/components/sf-tree.component';
import { consumeQueryParam } from '../../shared/deep-link';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import {
  contentTreeNodes,
  findFolder,
  folderMoveTargets,
  INVALID_QUERY_WARNING,
  isRecordSet,
  RECORD_SET_ICON,
  relativeFolderPath,
  storeFolderPath,
} from './content-tree.util';
import { ContentStoreRefresh } from './content-store-refresh.service';
import {
  ContentService,
  type DatasetSummaryView,
  type FolderView,
  type RecordSetSummaryView,
} from './content.service';
import { MoveTargetDialogComponent } from './move-target-dialog.component';
import { RecordSetActions } from './record-set-actions.service';

/** The chip value that shows the record sets of every dataset. */
const ALL = 'all';

/** `/p/{key}/content/sets/{uuid}` → the uuid of the set on screen. */
const SET_ROUTE = /\/content\/sets\/([^/?#;]+)/;

/**
 * Content store (M19.4.1, record sets since M25.5.1): Content folders holding **record sets**, each
 * of one dataset and holding that dataset's records.
 *
 * <p>The tree shows folders and, as leaves, the sets in them — with their record count and a
 * warning when a set's stored query no longer validates. Selecting a set opens the set view (a
 * child route: query panel and record grid); a record opens in the record editor, another child
 * route, so the tree stays where it is. Without a child the main area lists the record sets,
 * narrowed by the selected folder and by a dataset chip — the dataset filter editors had before
 * record sets, which now filters sets (the per-dataset record grids it used to show are gone:
 * records live in, and are listed by, their sets).
 *
 * <p>Datasets are defined by developers in the Templates store; with none defined the store explains
 * that and links developers there. Every create/move/delete control is disabled in time travel and
 * for viewers.
 */
@Component({
  selector: 'sf-content',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterOutlet,
    SfButtonComponent,
    SfCreateAssetDialogComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    SfStoreTreeNodeComponent,
    SfTreeComponent,
    MoveTargetDialogComponent,
  ],
  providers: [ContentStoreRefresh],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
})
export class ContentComponent {
  readonly projectKey = input.required<string>();
  /** `?dataset=<uuid>` preselects a dataset chip (the dataset editor's "Open record sets" link). */
  readonly dataset = input<string | undefined>();
  /** `?folder=<uuid>` selects that Content folder (search deep link, M23.4.1). */
  readonly folder = input<string | undefined>();
  private readonly route = inject(ActivatedRoute);

  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly refresh = inject(ContentStoreRefresh);
  private readonly setActions = inject(RecordSetActions);
  private readonly projectContext = inject(ProjectContextStore);

  protected readonly all = ALL;
  protected readonly setIcon = RECORD_SET_ICON;
  protected readonly invalidQueryWarning = INVALID_QUERY_WARNING;
  protected readonly setFolderPath = storeFolderPath;
  protected readonly loading = signal(false);
  protected readonly folders = signal<FolderView[]>([]);
  protected readonly datasets = signal<DatasetSummaryView[]>([]);
  protected readonly sets = signal<RecordSetSummaryView[]>([]);
  protected readonly activeChip = signal<string>(ALL);
  protected readonly selectedFolderUuid = signal<string | null>(null);
  protected readonly childOpen = signal(false);

  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  protected readonly newSetOpen = signal(false);
  protected readonly creatingSet = signal(false);
  /** Where "New folder" / "New record set" creates: the right-clicked or selected folder (`null`: root). */
  private readonly createTarget = signal<string | null>(null);
  /** The set being moved with "Move to…". */
  protected readonly movingSet = signal<FolderView | null>(null);
  protected readonly moving = signal(false);

  private readonly role = computed(() => this.auth.roleFor(this.projectKey()));
  protected readonly canEdit = computed(
    () => !this.timeTravel.isTimeTravel() && roleRank(this.role()) >= roleRank('EDITOR'),
  );
  protected readonly isDeveloper = computed(() => roleRank(this.role()) >= roleRank('DEVELOPER'));

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** The set whose view is open, highlighted in the tree. */
  protected readonly activeSetUuid = computed(() => SET_ROUTE.exec(this.url())?.[1] ?? null);

  /** The fixed "All Content" root, unwrapped for display like every store root. */
  private readonly rootFolder = computed<FolderView | null>(() => this.folders()[0] ?? null);

  private readonly setsByUuid = computed(
    () => new Map(this.sets().map((set) => [set.uuid ?? '', set] as [string, RecordSetSummaryView])),
  );

  protected readonly treeNodes = computed<StoreTreeNode[]>(() => contentTreeNodes(this.rootFolder(), this.setsByUuid()));

  /** Sets per dataset uuid, for the chip counts. */
  protected readonly setCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const set of this.sets()) {
      const uuid = set.dataset?.uuid ?? '';
      counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
    }
    return counts;
  });

  /** The Content-store-relative path of the selected folder (`/` for the whole store). */
  protected readonly folderPath = computed(() => {
    const uuid = this.selectedFolderUuid();
    const folder = uuid ? findFolder(this.folders(), uuid) : null;
    return relativeFolderPath(folder?.path);
  });

  /** The overview: sets in the selected folder (and below), of the chip's dataset. */
  protected readonly visibleSets = computed<RecordSetSummaryView[]>(() => {
    const chip = this.activeChip();
    const prefix = this.folderPath();
    return this.sets().filter(
      (set) =>
        (chip === ALL || set.dataset?.uuid === chip) && storeFolderPath(set.folderPath).startsWith(prefix),
    );
  });

  protected readonly moveTargets = computed(() => {
    const set = this.movingSet();
    return set ? folderMoveTargets(this.rootFolder(), this.setsByUuid().get(set.uuid ?? '')?.folderUuid) : [];
  });

  /** Store-specific tree menu entries, after the node's own "Rename" (which also changes the uid). */
  protected readonly nodeMenu = (node: StoreTreeNode): ContextMenuItem[] => {
    const uuid = node.uuid;
    if (!uuid || !this.canEdit()) {
      return [];
    }
    if (node.kind === 'FOLDER') {
      return [
        { label: 'New folder', icon: 'create_new_folder', action: () => this.newFolder(uuid) },
        {
          label: 'New record set',
          icon: RECORD_SET_ICON,
          disabled: this.datasets().length === 0,
          action: () => this.newSet(uuid),
        },
      ];
    }
    return [
      { label: 'New record', icon: 'post_add', action: () => this.openSet(uuid, { newRecord: '1' }) },
      { label: 'Move to…', icon: 'drive_file_move', action: () => this.startMove(uuid) },
      { label: 'History', icon: 'history', action: () => this.openSet(uuid, { panel: 'history' }) },
      { label: 'Used by', icon: 'link', action: () => this.openSet(uuid, { panel: 'usages' }) },
      { label: 'Delete…', icon: 'delete', danger: true, action: () => this.deleteSet(uuid) },
    ];
  };

  protected readonly renameFolder = (projectKey: string, uuid: string, displayName: string) =>
    this.content.renameFolder(projectKey, uuid, displayName);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      this.refresh.tick();
      untracked(() => this.reload(key));
    });
    effect(() => {
      const uuid = this.folder();
      if (!uuid || !findFolder(this.folders(), uuid)) {
        return;
      }
      untracked(() => {
        this.selectFolder(uuid);
        consumeQueryParam(this.router, this.route, 'folder');
      });
    });
    effect(
      () => {
        const requested = this.dataset();
        if (requested) {
          untracked(() => this.activeChip.set(requested));
        }
      },
      { allowSignalWrites: true },
    );
  }

  protected selectChip(chip: string): void {
    this.activeChip.set(chip);
    void this.router.navigate(['/p', this.projectKey(), 'content'], {
      queryParams: { dataset: chip === ALL ? null : chip },
    });
  }

  protected onChipKeydown(event: KeyboardEvent, index: number): void {
    const chips = [ALL, ...this.datasets().map((d) => d.uuid ?? '')];
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : -1;
    if (next < 0 || next >= chips.length) {
      return;
    }
    event.preventDefault();
    this.selectChip(chips[next]);
    queueMicrotask(() => (document.getElementById(`content-chip-${next}`) as HTMLElement | null)?.focus());
  }

  /** A tree row was selected: a set opens its view, a folder narrows the set list. */
  protected onTreeSelect(uuid: string): void {
    const node = findFolder(this.folders(), uuid);
    if (node && isRecordSet(node)) {
      this.openSet(uuid);
    } else {
      this.selectFolder(uuid);
    }
  }

  protected selectFolder(uuid: string): void {
    this.selectedFolderUuid.set(uuid);
    this.showOverview();
  }

  protected clearFolder(): void {
    this.selectedFolderUuid.set(null);
    this.showOverview();
  }

  protected openSet(uuid: string, queryParams: Record<string, string> = {}): void {
    void this.router.navigate(['/p', this.projectKey(), 'content', 'sets', uuid], { queryParams });
  }

  protected onChildActivated(): void {
    this.childOpen.set(true);
  }

  protected onChildDeactivated(): void {
    this.childOpen.set(false);
  }

  protected newFolder(parentUuid: string | null = this.selectedFolderUuid()): void {
    if (this.canEdit()) {
      this.createTarget.set(parentUuid);
      this.newFolderOpen.set(true);
    }
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    if (!this.canEdit()) {
      return;
    }
    this.creatingFolder.set(true);
    this.content.createFolder(this.projectKey(), value.displayName, this.createTarget() ?? undefined).subscribe({
      next: () => {
        this.creatingFolder.set(false);
        this.newFolderOpen.set(false);
        this.toasts.show('Folder created', 'success');
        this.reload(this.projectKey());
      },
      error: () => {
        this.creatingFolder.set(false);
        this.toasts.show('Could not create folder — a folder with that name may already exist here.', 'error');
      },
    });
  }

  protected newSet(folderUuid: string | null = this.selectedFolderUuid()): void {
    if (this.canEdit() && this.datasets().length > 0) {
      this.createTarget.set(folderUuid);
      this.newSetOpen.set(true);
    }
  }

  protected closeNewSet(): void {
    this.newSetOpen.set(false);
  }

  protected submitNewSet(value: CreateAssetFormValue): void {
    if (!this.canEdit() || !value.datasetUuid) {
      return;
    }
    this.creatingSet.set(true);
    this.content
      .createRecordSet(this.projectKey(), {
        folderUuid: this.createTarget() ?? undefined,
        datasetUuid: value.datasetUuid,
        uid: value.uid,
        displayName: value.displayName,
      })
      .subscribe({
        next: (created) => {
          this.creatingSet.set(false);
          this.newSetOpen.set(false);
          this.toasts.show('Record set created', 'success');
          this.reload(this.projectKey());
          if (created.uuid) {
            this.openSet(created.uuid);
          }
        },
        error: (err: unknown) => {
          this.creatingSet.set(false);
          const detail = err instanceof HttpErrorResponse ? (err.error as { detail?: string } | null)?.detail : undefined;
          this.toasts.show(detail ?? 'Could not create the record set — you may need the editor role.', 'error');
        },
      });
  }

  protected startMove(uuid: string): void {
    const set = findFolder(this.folders(), uuid);
    if (set && this.canEdit()) {
      this.movingSet.set(set);
    }
  }

  protected closeMove(): void {
    this.movingSet.set(null);
  }

  protected submitMove(folderUuid: string | null): void {
    const set = this.movingSet();
    if (!set?.uuid || !this.canEdit()) {
      return;
    }
    this.moving.set(true);
    this.content.moveAsset(this.projectKey(), set.uuid, folderUuid ?? undefined).subscribe({
      next: () => {
        this.moving.set(false);
        this.movingSet.set(null);
        this.toasts.show('Record set moved', 'success');
        this.refresh.notify();
      },
      error: () => {
        this.moving.set(false);
        this.toasts.show('Could not move the record set — try again in a moment.', 'error');
      },
    });
  }

  protected deleteSet(uuid: string): void {
    const node = findFolder(this.folders(), uuid);
    if (!node || !this.canEdit()) {
      return;
    }
    const recordCount = this.setsByUuid().get(uuid)?.recordCount ?? node.recordCount ?? 0;
    this.setActions
      .delete(this.projectKey(), { uuid, name: node.displayName ?? node.uid ?? '', recordCount })
      .subscribe((deleted) => {
        if (!deleted) {
          return;
        }
        if (this.activeSetUuid() === uuid) {
          this.showOverview();
        }
        this.refresh.notify();
      });
  }

  /** Drag-move in the tree: a set or folder dropped on a folder. */
  protected onMove(event: StoreTreeMoveEvent): void {
    if (!this.canEdit()) {
      return;
    }
    this.move(event.source, event.target).subscribe({
      next: () => {
        this.toasts.show('Moved', 'success');
        this.refresh.notify();
      },
      error: () => this.toasts.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  /** A folder or set dropped on the root row moves to the top of the store. */
  protected onRootDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  protected onRootDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    if (!source || !this.canEdit()) {
      return;
    }
    this.move(source, undefined).subscribe({
      next: () => {
        this.toasts.show('Moved to the store root', 'success');
        this.refresh.notify();
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  protected onRootContextMenu(event: MouseEvent): void {
    if (!this.canEdit()) {
      return;
    }
    this.clearFolder();
    const items: ContextMenuItem[] = [
      { label: 'New folder', icon: 'create_new_folder', action: () => this.newFolder(null) },
      {
        label: 'New record set',
        icon: RECORD_SET_ICON,
        disabled: this.datasets().length === 0,
        action: () => this.newSet(null),
      },
    ];
    this.menu.open(event, items);
  }

  protected onTreeChanged(): void {
    this.refresh.notify();
  }

  /** Folders move through the folder endpoint, sets through the generic asset move. */
  private move(source: string, target: string | undefined): Observable<unknown> {
    const node = findFolder(this.folders(), source);
    return node && isRecordSet(node)
      ? this.content.moveAsset(this.projectKey(), source, target)
      : this.content.moveFolder(this.projectKey(), source, target);
  }

  private showOverview(): void {
    if (this.childOpen()) {
      void this.router.navigate(['/p', this.projectKey(), 'content'], {
        queryParams: { dataset: this.activeChip() === ALL ? null : this.activeChip() },
      });
    }
  }

  private reload(key: string): void {
    if (!key) {
      return;
    }
    this.loading.set(true);
    forkJoin({
      folders: this.content.folders(key),
      datasets: this.content.listDatasets(key),
      sets: this.content.listRecordSets(key),
    }).subscribe({
      next: ({ folders, datasets, sets }) => {
        this.folders.set(folders ?? []);
        // Other screens (export picker, search) read the shared tree: keep it as current as this one.
        this.projectContext.updateContentFolderTree(key, folders ?? []);
        this.datasets.set(datasets ?? []);
        this.sets.set(sets ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show('Could not load the Content store — check your connection and try again.', 'error');
      },
    });
  }
}
