import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../shared/services/tree-clipboard.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfCreateAssetDialogComponent, type CreateAssetFormValue } from '../../shared/components/sf-create-asset-dialog.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { TemplateNavNodeComponent } from './template-nav-node.component';
import {
  DATASETS_ROOT_UID,
  PAGE_TEMPLATES_ROOT_UID,
  SECTION_TEMPLATES_ROOT_UID,
  TEMPLATES_ROOT_UID,
  type FolderMoveEvent,
  type TemplateAssetKind,
  type TemplateFolderSelectEvent,
} from './types';

type FolderView = components['schemas']['FolderView'];
type TemplateSummary = components['schemas']['TemplateSummary'];

/** `dataTransfer` key used (alongside the standard `text/plain` uuid) to stash the dragged
 * node's inherited template kind, so a drop target can reject a cross-kind move (a page
 * template folder dragged under "Section Templates" or vice versa) client-side, without a
 * round-trip to the backend's 422. */
const KIND_TRANSFER_KEY = 'application/x-sf-template-kind';

/**
 * Recursive folder-tree node for the templates screen sidebar. Modeled on
 * `sf-folder-node` (Pages) — templates are rendered as leaves directly inside
 * their folder, sorted after subfolders, exactly like a Pages folder renders
 * its own pages via `sf-page-nav-node` — with one addition: the two fixed,
 * protected roots ("Page Templates"/"Section Templates", `node.protectedFolder`)
 * render with no rename/move/delete affordances and are never a drag source —
 * everything nested beneath them gets the full folder toolset. `templateKind`
 * is threaded down unchanged from whichever root a node descends from (the
 * backend doesn't expose it per-node), and drives both the "new template"
 * dialog's kind and cross-kind move/paste prevention.
 */
@Component({
  selector: 'sf-template-folder-node',
  standalone: true,
  imports: [SfIconComponent, SfCreateAssetDialogComponent, SfRenameAssetDialogComponent, TemplateNavNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './template-folder-node.component.html',
  styleUrl: './template-folder-node.component.scss',
})
export class TemplateFolderNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  readonly node = input.required<FolderView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);
  readonly projectKey = input<string>('');
  readonly templateKind = input.required<TemplateAssetKind>();
  /** Templates grouped by their canonical folder path (mirrors `FolderNodeComponent.pagesByFolder`) — threaded down unchanged so every recursive level can pick out its own leaves without a second query. */
  readonly templatesByFolder = input<ReadonlyMap<string, TemplateSummary[]>>(new Map());
  /** The template currently open in the detail pane, for leaf highlighting — distinct from `selectedUuid`, which tracks folder selection. */
  readonly selectedTemplateUuid = input<string | null>(null);

  readonly select = output<TemplateFolderSelectEvent>();
  readonly move = output<FolderMoveEvent>();
  /** A template leaf (anywhere in this subtree) was clicked — bubbles up to open it in the detail pane. */
  readonly selectTemplate = output<string>();
  /** Request to open the "new template" form targeting this folder (already selected). */
  readonly newTemplate = output<void>();
  /** Emitted after this folder (or something inside it) was created/renamed/moved/deleted, so the parent reloads. */
  readonly changed = output<void>();

  protected readonly expanded = signal(true);
  protected readonly newFolderOpen = signal(false);
  protected readonly creatingFolder = signal(false);
  private pendingNewFolderParentUuid: string | null = null;

  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected readonly isProtected = computed<boolean>(() => this.node().protectedFolder === true);
  /** True only for the fixed "All Templates" wrapper root — it has no determined kind of its
   * own (its two children each do), so content can never be created directly under it. */
  protected readonly isAmbiguousRoot = computed<boolean>(() => this.node().uid === TEMPLATES_ROOT_UID);

  /** The kind a given CHILD of this node should use — re-derived per-child rather than blindly
   * inherited, since the wrapper root's two children (`page_templates`/`section_templates`)
   * fork into different kinds; every other descendant simply inherits `this.templateKind()`
   * unchanged, exactly as before. */
  protected childTemplateKind(child: FolderView): TemplateAssetKind {
    if (child.uid === SECTION_TEMPLATES_ROOT_UID) {
      return 'SECTION_TEMPLATE';
    }
    if (child.uid === PAGE_TEMPLATES_ROOT_UID) {
      return 'PAGE_TEMPLATE';
    }
    if (child.uid === DATASETS_ROOT_UID) {
      return 'DATASET';
    }
    return this.templateKind();
  }

  protected ownTemplates(): TemplateSummary[] {
    return this.templatesByFolder().get(this.node().path ?? '') ?? [];
  }

  protected hasChildren(): boolean {
    return (this.node().children ?? []).length > 0 || this.ownTemplates().length > 0;
  }

  protected isSelected(): boolean {
    const uuid = this.node().uuid;
    return uuid != null && this.selectedUuid() === uuid;
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  protected onSelect(): void {
    const uuid = this.node().uuid;
    if (uuid != null) {
      this.select.emit({ uuid, templateKind: this.templateKind() });
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect();
    } else if (event.key === 'ArrowRight' && !this.expanded()) {
      this.expanded.set(true);
    } else if (event.key === 'ArrowLeft' && this.expanded()) {
      this.expanded.set(false);
    }
  }

  protected onDragStart(event: DragEvent): void {
    if (this.isProtected() || this.readOnly()) {
      // Guards against a stale `draggable` attribute — the template also unsets it.
      event.preventDefault();
      return;
    }
    const uuid = this.node().uuid;
    if (uuid == null) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer?.setData(KIND_TRANSFER_KEY, this.templateKind());
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
    this.expanded.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer?.getData('text/plain');
    const sourceKind = event.dataTransfer?.getData(KIND_TRANSFER_KEY);
    const target = this.node().uuid;
    if (!source || !target || source === target || this.readOnly()) {
      return;
    }
    if (sourceKind && sourceKind !== this.templateKind()) {
      this.toast.show('Page templates, section templates and datasets each keep to their own folders.', 'error');
      return;
    }
    this.move.emit({ source, target });
  }

  protected onDragEnd(): void {
    // No-op; sibling visual state is managed by the parent.
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.node().uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    const items: ContextMenuItem[] = [];
    if (!this.isAmbiguousRoot()) {
      items.push(
        {
          label: this.templateKind() === 'DATASET' ? 'New dataset here' : 'New template here',
          icon: 'note_add',
          action: () => {
            this.select.emit({ uuid, templateKind: this.templateKind() });
            this.newTemplate.emit();
          },
        },
        { label: 'New subfolder', icon: 'create_new_folder', action: () => this.newSubfolder(uuid) },
      );
    }
    if (!this.isProtected()) {
      const clip = this.clipboard.entry();
      items.push(
        { label: 'Rename', icon: 'edit', action: () => this.renameOpen.set(true) },
        { label: '', separator: true },
        {
          label: 'Cut',
          icon: 'content_cut',
          action: () =>
            this.clipboard.cut('FOLDER', uuid, this.node().displayName ?? this.node().uid ?? 'folder', this.templateKind()),
        },
        { label: 'Paste', icon: 'content_paste', disabled: !this.canPaste(clip), action: () => this.paste(uuid) },
        { label: '', separator: true },
        { label: 'Delete', icon: 'delete', danger: true, action: () => this.deleteFolder(uuid) },
      );
    }
    if (items.length === 0) {
      return;
    }
    this.menu.open(event, items);
  }

  private canPaste(clip: ReturnType<TreeClipboardService['entry']>): boolean {
    if (!clip) {
      return false;
    }
    if (clip.assetType !== 'FOLDER' && clip.assetType !== 'TEMPLATE') {
      return false;
    }
    return !clip.templateKind || clip.templateKind === this.templateKind();
  }

  private newSubfolder(parentUuid: string): void {
    this.pendingNewFolderParentUuid = parentUuid;
    this.newFolderOpen.set(true);
  }

  protected closeNewFolder(): void {
    this.newFolderOpen.set(false);
  }

  protected submitNewFolder(value: CreateAssetFormValue): void {
    const parentUuid = this.pendingNewFolderParentUuid;
    if (!parentUuid || this.readOnly()) {
      return;
    }
    this.creatingFolder.set(true);
    this.api
      .createFolder(this.projectKey(), { displayName: value.displayName, parentFolderUuid: parentUuid, scope: 'TEMPLATES' })
      .subscribe({
        next: () => {
          this.creatingFolder.set(false);
          this.newFolderOpen.set(false);
          this.toast.show('Folder created', 'success');
          this.changed.emit();
        },
        error: () => {
          this.creatingFolder.set(false);
          this.toast.show('Could not create folder — a folder with that name may already exist here.', 'error');
        },
      });
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const uuid = this.node().uuid;
    if (!uuid || this.readOnly()) {
      return;
    }
    this.renamingName.set(true);
    this.api.renameFolder(this.projectKey(), uuid, { displayName }).subscribe({
      next: () => {
        this.renamingName.set(false);
        this.renameOpen.set(false);
        this.toast.show('Folder renamed', 'success');
        this.changed.emit();
      },
      error: () => {
        this.renamingName.set(false);
        this.toast.show('Could not rename folder — try again in a moment.', 'error');
      },
    });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }

  private deleteFolder(uuid: string): void {
    if (this.readOnly()) {
      return;
    }
    const name = this.node().displayName ?? this.node().uid ?? 'this folder';
    if (!window.confirm(`Delete "${name}" and everything inside it? This cannot be undone.`)) {
      return;
    }
    this.api.deleteFolder(this.projectKey(), uuid, true).subscribe({
      next: () => {
        this.toast.show('Folder deleted', 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not delete folder — try again in a moment.', 'error'),
    });
  }

  private paste(targetUuid: string): void {
    if (this.readOnly()) {
      return;
    }
    const entry = this.clipboard.entry();
    if (!entry || !this.canPaste(entry)) {
      this.toast.show('Nothing compatible to paste here.', 'error');
      return;
    }
    if (entry.mode !== 'cut') {
      this.toast.show('Only Cut items can be pasted here — no duplicate exists for this item.', 'error');
      return;
    }
    this.api.moveAsset(this.projectKey(), entry.uuid, { folderUuid: targetUuid }).subscribe({
      next: () => {
        this.clipboard.clear();
        this.toast.show(`Moved "${entry.label}"`, 'success');
        this.changed.emit();
      },
      error: () => this.toast.show('Could not move — try again in a moment.', 'error'),
    });
  }
}
