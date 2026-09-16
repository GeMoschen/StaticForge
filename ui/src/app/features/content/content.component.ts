import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { roleRank } from '../../core/auth/auth.guard';
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
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, type DatasetDetailView, type DatasetSummaryView, type FolderView } from './content.service';
import { RecordGridComponent } from './record-grid.component';

/** The chip value that shows every dataset's first records at once. */
const ALL = 'all';

/**
 * Content store (M19.4.1): dataset records and their folders.
 *
 * <p>The tree holds the Content folders; the records themselves live in a server-paged grid per
 * dataset, because a dataset can have thousands of them — the tree narrows the grid to a folder
 * instead of listing records itself. A chip row picks the dataset; "All" shows the first records of
 * every dataset, each with its dataset as a badge. A record opens in the record editor, a child route
 * rendered in place of the grid, so the tree and chips stay where they are.
 *
 * <p>Datasets are defined by developers in the Templates store; with none defined the store explains
 * that and links developers there. Every create/move control is disabled in time travel and for
 * viewers.
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
    RecordGridComponent,
  ],
  templateUrl: './content.component.html',
  styleUrl: './content.component.scss',
})
export class ContentComponent {
  readonly projectKey = input.required<string>();
  /** `?dataset=<uuid>` preselects a dataset chip (the dataset editor's "Open records" link). */
  readonly dataset = input<string | undefined>();

  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly all = ALL;
  protected readonly loading = signal(false);
  protected readonly folders = signal<FolderView[]>([]);
  protected readonly datasets = signal<DatasetSummaryView[]>([]);
  /** Full dataset details (schemas) by uuid, loaded once per store visit for the grid columns. */
  protected readonly details = signal<Map<string, DatasetDetailView>>(new Map());
  protected readonly activeChip = signal<string>(ALL);
  protected readonly selectedFolderUuid = signal<string | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly refreshKey = signal(0);

  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  protected readonly newRecordOpen = signal(false);
  protected readonly creatingRecord = signal(false);

  private readonly role = computed(() => this.auth.roleFor(this.projectKey()));
  protected readonly canEditRecords = computed(
    () => !this.timeTravel.isTimeTravel() && roleRank(this.role()) >= roleRank('EDITOR'),
  );
  protected readonly isDeveloper = computed(() => roleRank(this.role()) >= roleRank('DEVELOPER'));

  /** The fixed "All Content" root, unwrapped for display like every store root. */
  private readonly rootFolder = computed<FolderView | null>(() => this.folders()[0] ?? null);

  protected readonly treeNodes = computed<StoreTreeNode[]>(() => (this.rootFolder()?.children ?? []).map(folderNode));

  /** The Content-store-relative path of the selected folder (`/` for the whole store). */
  protected readonly folderPath = computed(() => {
    const uuid = this.selectedFolderUuid();
    const folder = uuid ? findFolder(this.folders(), uuid) : null;
    return relativeFolderPath(folder?.path);
  });

  protected readonly visibleDatasets = computed<DatasetDetailView[]>(() => {
    const chip = this.activeChip();
    const details = this.details();
    const list = this.datasets()
      .map((d) => (d.uuid ? details.get(d.uuid) : undefined))
      .filter((d): d is DatasetDetailView => !!d);
    return chip === ALL ? list : list.filter((d) => d.uuid === chip);
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.reload(key));
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

  protected selectFolder(uuid: string): void {
    this.selectedFolderUuid.set(uuid);
  }

  protected clearFolder(): void {
    this.selectedFolderUuid.set(null);
  }

  protected openRecord(uuid: string): void {
    void this.router.navigate(['/p', this.projectKey(), 'content', 'records', uuid], {
      queryParamsHandling: 'preserve',
    });
  }

  protected onEditorActivated(): void {
    this.editorOpen.set(true);
  }

  protected onEditorDeactivated(): void {
    this.editorOpen.set(false);
    this.refreshKey.update((k) => k + 1);
  }

  protected onRecordChanged(): void {
    this.refreshKey.update((k) => k + 1);
  }

  protected newFolder(): void {
    if (this.canEditRecords()) {
      this.newFolderOpen.set(true);
    }
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    if (!this.canEditRecords()) {
      return;
    }
    this.creatingFolder.set(true);
    this.content.createFolder(this.projectKey(), value.displayName, this.selectedFolderUuid() ?? undefined).subscribe({
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

  protected newRecord(): void {
    if (this.canEditRecords() && this.datasets().length > 0) {
      this.newRecordOpen.set(true);
    }
  }

  protected closeNewRecord(): void {
    this.newRecordOpen.set(false);
  }

  protected submitNewRecord(value: CreateAssetFormValue): void {
    const datasetUuid = value.datasetUuid || this.datasets()[0]?.uuid;
    if (!this.canEditRecords() || !datasetUuid) {
      return;
    }
    this.creatingRecord.set(true);
    this.content
      .createRecord(this.projectKey(), datasetUuid, {
        folderUuid: this.selectedFolderUuid() ?? undefined,
        displayName: value.displayName,
        content: {},
      })
      .subscribe({
        next: (created) => {
          this.creatingRecord.set(false);
          this.newRecordOpen.set(false);
          this.toasts.show('Record created', 'success');
          this.onRecordChanged();
          if (created.uuid) {
            this.openRecord(created.uuid);
          }
        },
        error: () => {
          this.creatingRecord.set(false);
          this.toasts.show('Could not create the record — you may need the editor role.', 'error');
        },
      });
  }

  protected onMove(event: StoreTreeMoveEvent): void {
    if (!this.canEditRecords()) {
      return;
    }
    this.content.moveFolder(this.projectKey(), event.source, event.target).subscribe({
      next: () => {
        this.toasts.show('Moved', 'success');
        this.reload(this.projectKey());
      },
      error: () => this.toasts.show('Could not move — that may create a cycle.', 'error'),
    });
  }

  /** A folder dropped on the root row moves to the top of the store. */
  protected onRootDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
  }

  protected onRootDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    if (!source || !this.canEditRecords()) {
      return;
    }
    this.content.moveFolder(this.projectKey(), source, undefined).subscribe({
      next: () => {
        this.toasts.show('Moved to the store root', 'success');
        this.reload(this.projectKey());
      },
      error: () => this.toasts.show('Could not move — try again in a moment.', 'error'),
    });
  }

  protected onRootContextMenu(event: MouseEvent): void {
    if (!this.canEditRecords()) {
      return;
    }
    this.clearFolder();
    const items: ContextMenuItem[] = [
      { label: 'New folder', icon: 'create_new_folder', action: () => this.newFolder() },
      { label: 'New record', icon: 'post_add', disabled: this.datasets().length === 0, action: () => this.newRecord() },
    ];
    this.menu.open(event, items);
  }

  protected readonly renameFolder = (projectKey: string, uuid: string, displayName: string) =>
    this.content.renameFolder(projectKey, uuid, displayName);

  private reload(key: string): void {
    if (!key) {
      return;
    }
    this.loading.set(true);
    forkJoin({ folders: this.content.folders(key), datasets: this.content.listDatasets(key) }).subscribe({
      next: ({ folders, datasets }) => {
        this.folders.set(folders ?? []);
        this.datasets.set(datasets ?? []);
        this.loadDetails(key, datasets ?? []);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show('Could not load the Content store — check your connection and try again.', 'error');
      },
    });
  }

  private loadDetails(key: string, datasets: DatasetSummaryView[]): void {
    const uuids = datasets.map((d) => d.uuid).filter((u): u is string => !!u);
    if (uuids.length === 0) {
      this.details.set(new Map());
      this.loading.set(false);
      return;
    }
    forkJoin(uuids.map((uuid) => this.content.getDataset(key, uuid))).subscribe({
      next: (details) => {
        this.details.set(new Map(details.map((d) => [d.uuid ?? '', d])));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.show('Could not load the dataset schemas — try again in a moment.', 'error');
      },
    });
  }
}

function folderNode(folder: FolderView): StoreTreeNode {
  return {
    uuid: folder.uuid,
    uid: folder.uid,
    displayName: folder.displayName,
    kind: 'FOLDER',
    protectedFolder: folder.protectedFolder === true,
    children: (folder.children ?? []).map(folderNode),
  };
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

/** `/content_root/team/leads/` → `/team/leads/`; the root itself and nothing selected → `/`. */
export function relativeFolderPath(storedPath: string | null | undefined): string {
  const root = '/content_root/';
  if (!storedPath || !storedPath.startsWith(root)) {
    return '/';
  }
  return '/' + storedPath.slice(root.length);
}
