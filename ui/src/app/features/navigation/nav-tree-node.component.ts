import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { NavTreeView } from './navigation.service';

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
 * convention in the pages store). The navigation root (`isRoot`) is never a
 * drag source: moving/deleting the single eager root would break the
 * single-root assumption the whole navigation store relies on (`M8.1.2`).
 */
@Component({
  selector: 'sf-nav-tree-node',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-tree-node.component.html',
  styleUrl: './nav-tree-node.component.scss',
})
export class NavTreeNodeComponent {
  readonly node = input.required<NavTreeView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);
  readonly isRoot = input<boolean>(false);

  readonly select = output<string>();
  readonly move = output<NavMoveEvent>();

  protected readonly expanded = signal(true);

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

  /** Folders show open/closed folder icons; a folder with a `startNode` gets a "linked" badge icon so it's clear it's directly navigable, not just a grouping node. */
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
    if (uuid == null || this.isRoot()) {
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
}
