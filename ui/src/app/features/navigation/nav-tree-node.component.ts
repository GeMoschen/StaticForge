import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { ContextMenuItem, ContextMenuService } from '../../shared/services/context-menu.service';
import { NavigationService, type NavTreeView } from './navigation.service';

export interface NavMoveEvent {
  source: string;
  target: string;
}

/**
 * Recursive navigation-tree node. Renders both node shapes returned by
 * `GET .../navigation/tree` — `FOLDER` (a grouping node, possibly with a
 * `startNode`) and `PAGE_REFERENCE` (a leaf pointing at a page or page-store
 * folder) — with distinct icons, since the shared `sf-tree` component is
 * only a content-projection shell with no built-in node rendering (see
 * `sf-tree.component.html`: just `<ng-content />`) and has no notion of
 * heterogeneous node types itself.
 *
 * Supports expand/collapse, selection, and native HTML5 drag-move (drag any
 * node onto a folder node to move it there — mirrors `sf-folder-node`'s
 * convention in the pages store). The fixed, protected "All Navigation" root
 * folder (`node().protectedFolder`) renders with no rename/drag affordance —
 * mirrors `sf-template-folder-node`'s treatment of its own two fixed roots —
 * everything nested beneath it gets the full toolset.
 */
@Component({
  selector: 'sf-nav-tree-node',
  standalone: true,
  imports: [SfIconComponent, SfRenameAssetDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-tree-node.component.html',
  styleUrl: './nav-tree-node.component.scss',
})
export class NavTreeNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly nav = inject(NavigationService);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);

  readonly node = input.required<NavTreeView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);
  readonly projectKey = input<string>('');

  readonly select = output<string>();
  readonly move = output<NavMoveEvent>();
  /** Emitted after this node was renamed (display name or UID), so the parent reloads. */
  readonly changed = output<void>();

  protected readonly expanded = signal(true);
  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected readonly isProtected = computed<boolean>(() => this.node().protectedFolder === true);

  protected isFolder(): boolean {
    return this.node().type === 'FOLDER';
  }

  protected hasChildren(): boolean {
    return (this.node().children ?? []).length > 0;
  }

  protected isSelected(): boolean {
    const uuid = this.node().uuid;
    return uuid != null && this.selectedUuid() === uuid;
  }

  /** Folders show open/closed folder icons; a folder with a resolved `startNode` is instead
   * distinguished by the `→ path` label rendered next to its name (see the template) — the same
   * treatment a `PAGE_REFERENCE` leaf gets for its own resolved target. */
  protected icon(): string {
    if (!this.isFolder()) {
      return 'link';
    }
    return this.expanded() && this.hasChildren() ? 'folder_open' : 'folder';
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }

  protected onSelect(): void {
    const uuid = this.node().uuid;
    if (uuid != null) {
      this.select.emit(uuid);
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
    const uuid = this.node().uuid;
    if (uuid == null || this.isProtected()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.isFolder()) {
      return;
    }
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
    this.expanded.set(true);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.isFolder()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer?.getData('text/plain');
    const target = this.node().uuid;
    if (source && target && source !== target) {
      this.move.emit({ source, target });
    }
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.node().uuid;
    if (!uuid || this.isProtected()) {
      return;
    }
    const items: ContextMenuItem[] = [
      { label: 'Rename', icon: 'edit', action: () => this.openRename() },
    ];
    this.menu.open(event, items);
  }

  protected openRename(): void {
    this.renameOpen.set(true);
  }

  protected closeRename(): void {
    this.renameOpen.set(false);
  }

  protected submitRenameDisplayName(displayName: string): void {
    const uuid = this.node().uuid;
    const key = this.projectKey();
    if (!uuid || !key) {
      return;
    }
    this.renamingName.set(true);
    const onSuccess = (): void => {
      this.renamingName.set(false);
      this.renameOpen.set(false);
      this.toast.show(this.isFolder() ? 'Folder renamed' : 'Reference renamed', 'success');
      this.changed.emit();
    };
    const onError = (): void => {
      this.renamingName.set(false);
      this.toast.show('Could not rename — try again in a moment.', 'error');
    };
    if (this.isFolder()) {
      this.nav.renameFolder(key, uuid, displayName).subscribe({ next: onSuccess, error: onError });
    } else {
      this.api.renameAsset(key, uuid, { displayName }).subscribe({ next: onSuccess, error: onError });
    }
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }
}
