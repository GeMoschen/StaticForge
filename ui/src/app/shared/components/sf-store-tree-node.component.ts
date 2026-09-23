import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { ContextMenuItem, ContextMenuService } from '../services/context-menu.service';
import { SfIconComponent } from './sf-icon.component';
import { SfRenameAssetDialogComponent } from './sf-rename-asset-dialog.component';

/**
 * One node of a store tree, in the store-agnostic shape this component renders. A store maps its
 * own view model onto it rather than this component knowing about any store's wire types.
 */
export interface StoreTreeNode {
  uuid?: string;
  uid?: string;
  displayName?: string;
  /** `FOLDER` groups children; `LEAF` is whatever asset the store holds. */
  kind: 'FOLDER' | 'LEAF';
  /** Material icon for a leaf row. Folders always use the open/closed folder pair. */
  icon?: string;
  /** The fixed, protected store root: no rename, no drag, no context menu. */
  protectedFolder?: boolean;
  /**
   * Optional trailing annotation, e.g. a navigation reference's resolved page path or a record set's
   * record count; `label` is what assistive technology reads instead of the bare text.
   */
  badge?: { text: string; broken?: boolean; label?: string };
  /** A problem with this node, shown as a warning icon with this text as its tooltip. */
  warning?: string;
  children?: StoreTreeNode[];
}

/** A drag-move: put `source` inside the folder `target`. */
export interface StoreTreeMoveEvent {
  source: string;
  target: string;
}

/**
 * A store's own context-menu entries for a node, listed after the built-in "Rename" (M25.5.1: the
 * Content store's "New record set", "Move to…", "Delete" …). Return `[]` for none.
 */
export type StoreTreeMenuFn = (node: StoreTreeNode) => ContextMenuItem[];

/** How a folder rename is persisted; stores whose folders have a dedicated endpoint pass their own. */
export type FolderRenameFn = (projectKey: string, uuid: string, displayName: string) => Observable<unknown>;

/**
 * The recursive tree row shared by the project's store screens.
 *
 * <p>Before M17 every store (pages, media, navigation, templates) carried its own near-identical
 * copy of this file, which is why a keyboard or drag-and-drop fix only ever landed in one of them.
 * This is the one implementation: it renders a heterogeneous folder/leaf tree with expand/collapse,
 * selection, keyboard navigation, native HTML5 drag-move onto a folder, a rename dialog and the
 * fixed protected root's reduced affordances. Everything store-specific arrives as data
 * ({@link StoreTreeNode}) or as the `renameFolder` strategy, so adding a store means mapping a view
 * model, not copying a component.
 *
 * <p>Writes are blocked twice over while time travel is active: the read-only HTTP interceptor is
 * the backstop, and these guards give the immediate feedback a round trip would not.
 */
@Component({
  selector: 'sf-store-tree-node',
  standalone: true,
  imports: [SfIconComponent, SfRenameAssetDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-store-tree-node.component.html',
  styleUrl: './sf-store-tree-node.component.scss',
})
export class SfStoreTreeNodeComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly menu = inject(ContextMenuService);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly readOnly = this.timeTravel.isTimeTravel;

  readonly node = input.required<StoreTreeNode>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);
  readonly projectKey = input<string>('');
  /** What a leaf is called in toasts, e.g. "Reference" or "Property set". */
  readonly leafNoun = input<string>('Item');
  /**
   * Persists a folder rename. Defaults to the generic asset rename, which is right for every store
   * whose folders have no endpoint of their own.
   */
  readonly renameFolder = input<FolderRenameFn | null>(null);
  /** Store-specific context-menu entries, appended to "Rename" on every node of the tree. */
  readonly menuItems = input<StoreTreeMenuFn | null>(null);

  readonly select = output<string>();
  readonly move = output<StoreTreeMoveEvent>();
  /** Emitted after this node was renamed (display name or UID), so the parent reloads. */
  readonly changed = output<void>();

  protected readonly expanded = signal(true);
  protected readonly renameOpen = signal(false);
  protected readonly renamingName = signal(false);

  protected readonly isProtected = computed<boolean>(() => this.node().protectedFolder === true);

  protected isFolder(): boolean {
    return this.node().kind === 'FOLDER';
  }

  protected hasChildren(): boolean {
    return (this.node().children ?? []).length > 0;
  }

  protected isSelected(): boolean {
    const uuid = this.node().uuid;
    return uuid != null && this.selectedUuid() === uuid;
  }

  protected icon(): string {
    if (!this.isFolder()) {
      return this.node().icon ?? 'description';
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
    if (uuid == null || this.isProtected() || this.readOnly()) {
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
    if (source && target && source !== target && !this.readOnly()) {
      this.move.emit({ source, target });
    }
  }

  protected onContextMenu(event: MouseEvent): void {
    const uuid = this.node().uuid;
    if (!uuid || this.isProtected() || this.readOnly()) {
      return;
    }
    const items: ContextMenuItem[] = [
      { label: 'Rename', icon: 'edit', action: () => this.openRename() },
      ...(this.menuItems()?.(this.node()) ?? []),
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
    if (!uuid || !key || this.readOnly()) {
      return;
    }
    this.renamingName.set(true);
    const rename = this.isFolder() ? this.renameFolder() : null;
    const request$ = rename
      ? rename(key, uuid, displayName)
      : this.api.renameAsset(key, uuid, { displayName });
    request$.subscribe({
      next: () => {
        this.renamingName.set(false);
        this.renameOpen.set(false);
        this.toast.show(`${this.isFolder() ? 'Folder' : this.leafNoun()} renamed`, 'success');
        this.changed.emit();
      },
      error: () => {
        this.renamingName.set(false);
        this.toast.show('Could not rename — try again in a moment.', 'error');
      },
    });
  }

  protected onRenameUidChanged(): void {
    // sf-uid-rename already toasts "UID changed" itself — just reload.
    this.changed.emit();
  }
}
