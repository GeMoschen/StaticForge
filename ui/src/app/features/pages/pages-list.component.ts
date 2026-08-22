import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FolderDetailComponent } from './folder-detail.component';
import { FolderNodeComponent } from './folder-node.component';
import { PageNavNodeComponent } from './page-nav-node.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { FolderMoveEvent } from './types';

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
    SfEmptyStateComponent,
    SfFieldComponent,
    SfIconComponent,
    ReactiveFormsModule,
    RouterOutlet,
  ],
  templateUrl: './pages-list.component.html',
  styleUrl: './pages-list.component.scss',
})
export class PagesListComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly menu = inject(ContextMenuService);
  protected readonly clipboard = inject(TreeClipboardService);

  readonly projectKey = input.required<string>();

  protected readonly tree = this.store.pageFolderTree;
  protected readonly pageTemplates = computed<TemplateSummary[]>(() => this.store.pageTemplates());

  protected readonly selectedFolder = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly pages = signal<AssetSummaryView[]>([]);
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

  protected readonly rootPages = computed<AssetSummaryView[]>(() => this.pagesByFolder().get('/') ?? []);

  protected readonly newPageOpen = signal(false);
  protected readonly creatingPage = signal(false);
  protected readonly newPageForm = this.fb.nonNullable.group({
    displayName: ['', Validators.required],
    templateUuid: ['', Validators.required],
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      this.store.loadFor(key).subscribe();
    });

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        const q = this.search();
        this.reload(key, q);
      },
      { allowSignalWrites: true },
    );
  }

  protected reload(key: string, q: string): void {
    this.loading.set(true);
    this.api
      .listPages(key, {
        q: q.trim() || undefined,
      })
      .subscribe({
        next: (pages) => {
          this.pages.set(pages ?? []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected newFolder(): void {
    this.createFolderUnder(this.selectedFolder() ?? undefined);
  }

  private createFolderUnder(parentUuid: string | undefined): void {
    const displayName = window.prompt('Folder name');
    if (!displayName || !displayName.trim()) {
      return;
    }
    const key = this.projectKey();
    this.api
      .createFolder(key, { displayName: displayName.trim(), parentFolderUuid: parentUuid, scope: 'PAGES' })
      .subscribe({
        next: () => {
          this.toast.show('Folder created', 'success');
          this.onTreeChanged();
        },
        error: () => this.toast.show('Could not create folder — a folder with that name may already exist here.', 'error'),
      });
  }

  protected openNewPage(): void {
    this.newPageForm.reset({ displayName: '', templateUuid: '' });
    this.newPageOpen.set(true);
  }

  protected closeNewPage(): void {
    this.newPageOpen.set(false);
  }

  protected submitNewPage(): void {
    if (this.newPageForm.invalid || this.creatingPage()) {
      return;
    }
    const key = this.projectKey();
    const value = this.newPageForm.getRawValue();
    this.creatingPage.set(true);
    this.api
      .createPage(key, {
        displayName: value.displayName.trim(),
        templateUuid: value.templateUuid,
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
    if (!event.source || !event.target) {
      return;
    }
    this.api.moveAsset(this.projectKey(), event.source, { folderUuid: event.target }).subscribe({
      next: () => {
        this.toast.show('Moved', 'success');
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
    if (!source) {
      return;
    }
    this.api.moveAsset(this.projectKey(), source, {}).subscribe({
      next: () => {
        this.toast.show('Moved to root', 'success');
        this.onTreeChanged();
      },
      error: () => this.toast.show('Could not move — try again in a moment.', 'error'),
    });
  }

  /** "All pages" is the project's page root — it can't be renamed, deleted, cut, or pasted into, but you can create pages/subfolders directly in it. */
  protected onRootContextMenu(event: MouseEvent): void {
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
