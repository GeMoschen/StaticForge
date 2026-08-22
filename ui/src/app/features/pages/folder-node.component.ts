import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { FolderMoveEvent } from './types';

type FolderView = components['schemas']['FolderView'];

/**
 * Recursive folder-tree node. Supports expand/collapse, selection, and
 * native HTML5 drag-move (drag a folder onto another folder to move it).
 * The parent is responsible for performing the move via the ApiClient.
 */
@Component({
  selector: 'sf-folder-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-node.component.html',
  styleUrl: './folder-node.component.scss',
})
export class FolderNodeComponent {
  readonly node = input.required<FolderView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);

  readonly select = output<string>();
  readonly move = output<FolderMoveEvent>();

  protected readonly expanded = signal(true);

  protected hasChildren(): boolean {
    return (this.node().children ?? []).length > 0;
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
    if (this.node().uuid != null) {
      this.select.emit(this.node().uuid as string);
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
    if (uuid == null) {
      return;
    }
    event.dataTransfer?.setData('text/plain', uuid);
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer && (event.dataTransfer.dropEffect = 'move');
    this.expanded.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const source = event.dataTransfer?.getData('text/plain');
    const target = this.node().uuid;
    if (source && target && source !== target) {
      this.move.emit({ source, target });
    }
  }

  protected onDragEnd(): void {
    // No-op; sibling visual state is managed by the parent.
  }
}
