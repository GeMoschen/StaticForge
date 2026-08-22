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
import { Router } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import type { components } from '../../core/api/generated/schema.d.ts';
import { FolderNodeComponent } from './folder-node.component';
import type { FolderMoveEvent } from './types';

type AssetSummaryView = components['schemas']['AssetSummaryView'];
type TemplateSummary = components['schemas']['TemplateSummary'];

/**
 * Pages list: a folder tree on the left and a page table on the right.
 * Supports folder filtering, search, multi-select, and bulk move/delete.
 */
@Component({
  selector: 'sf-pages-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FolderNodeComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './pages-list.component.html',
  styleUrl: './pages-list.component.scss',
})
export class PagesListComponent {
  private readonly api = inject(ApiClient);
  private readonly store = inject(ProjectContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly projectKey = input.required<string>();

  protected readonly tree = this.store.folderTree;
  protected readonly pageTemplates = computed<TemplateSummary[]>(() => this.store.pageTemplates());

  protected readonly selectedFolder = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly pages = signal<AssetSummaryView[]>([]);
  protected readonly selectedUuids = signal<string[]>([]);
  protected readonly loading = signal(false);

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
        const folder = this.selectedFolder();
        const q = this.search();
        this.reload(key, folder, q);
      },
      { allowSignalWrites: true },
    );
  }

  protected reload(
    key: string,
    folder: string | null,
    q: string,
  ): void {
    this.loading.set(true);
    this.api
      .listPages(key, {
        folder: folder ?? undefined,
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
    const displayName = window.prompt('Folder name');
    if (!displayName || !displayName.trim()) {
      return;
    }
    const key = this.projectKey();
    this.api
      .createFolder(key, {
        displayName: displayName.trim(),
        parentFolderUuid: this.selectedFolder() ?? undefined,
      })
      .subscribe({
        next: () => {
          this.toast.show('Folder created', 'success');
          this.store.loadFor(key, true).subscribe();
        },
        error: () => this.toast.show('Failed to create folder', 'error'),
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
          this.reload(key, this.selectedFolder(), this.search());
        },
        error: () => {
          this.creatingPage.set(false);
          this.toast.show('Failed to create page', 'error');
        },
      });
  }

  protected selectFolder(uuid: string | null): void {
    this.selectedFolder.set(uuid);
    this.selectedUuids.set([]);
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.search.set(value);
  }

  protected isSelected(uuid?: string): boolean {
    return uuid != null && this.selectedUuids().includes(uuid);
  }

  protected toggleSelect(uuid: string): void {
    if (!uuid) {
      return;
    }
    this.selectedUuids.update((list) =>
      list.includes(uuid) ? list.filter((u) => u !== uuid) : [...list, uuid],
    );
  }

  protected allSelected(): boolean {
    return (
      this.pages().length > 0 &&
      this.pages().every((p) => p.uuid != null && this.selectedUuids().includes(p.uuid as string))
    );
  }

  protected toggleAll(): void {
    if (this.allSelected()) {
      this.selectedUuids.set([]);
    } else {
      this.selectedUuids.set(
        (this.pages() as AssetSummaryView[])
          .map((p) => p.uuid)
          .filter((u): u is string => u != null),
      );
    }
  }

  protected open(uuid: string): void {
    if (!uuid) {
      return;
    }
    void this.router.navigate(['/p', this.projectKey(), 'pages', uuid]);
  }

  protected bulkMove(): void {
    const key = this.projectKey();
    const target = this.selectedFolder();
    const uuids = this.selectedUuids();
    if (uuids.length === 0) {
      return;
    }
    let pending = uuids.length;
    for (const uuid of uuids) {
      this.api.moveAsset(key, uuid, { folderUuid: target ?? undefined }).subscribe({
        next: () => this.afterBulk(uuids, --pending),
        error: () => this.afterBulk(uuids, --pending),
      });
    }
  }

  protected bulkDelete(): void {
    const uuids = this.selectedUuids();
    if (uuids.length === 0) {
      return;
    }
    if (
      uuids.length > 1 &&
      !window.confirm(`Delete ${uuids.length} pages? This cannot be undone.`)
    ) {
      return;
    }
    const key = this.projectKey();
    let pending = uuids.length;
    for (const uuid of uuids) {
      this.api.deleteAsset(key, uuid).subscribe({
        next: () => this.afterBulk(uuids, --pending),
        error: () => this.afterBulk(uuids, --pending),
      });
    }
  }

  private afterBulk(uuids: string[], remaining: number): void {
    if (remaining <= 0) {
      this.selectedUuids.set([]);
      this.reload(this.projectKey(), this.selectedFolder(), this.search());
    }
  }

  protected moveFolderTo(event: FolderMoveEvent): void {
    if (!event.source || !event.target) {
      return;
    }
    this.api
      .moveFolder(this.projectKey(), event.source, { folderUuid: event.target })
      .subscribe({
        next: () => {
          this.toast.show('Folder moved', 'success');
          this.store.loadFor(this.projectKey(), true).subscribe();
        },
        error: () => this.toast.show('Failed to move folder', 'error'),
      });
  }
}
