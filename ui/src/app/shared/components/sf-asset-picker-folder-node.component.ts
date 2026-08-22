import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { SfIconComponent } from './sf-icon.component';

type FolderView = components['schemas']['FolderView'];

/**
 * Minimal recursive read-only folder row for `sf-asset-picker-dialog` — just
 * expand/collapse and select, no drag-drop or context menu (those belong to
 * the pages/media trees, not a one-shot asset picker).
 */
@Component({
  selector: 'sf-asset-picker-folder-node',
  standalone: true,
  imports: [SfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="node" [style.padding-left.px]="depth() * 14">
      <button
        type="button"
        class="node__row"
        [class.node__row--selected]="isSelected()"
        (click)="select.emit(node())"
      >
        <button
          type="button"
          class="node__toggle"
          [class.node__toggle--leaf]="!hasChildren()"
          (click)="toggle($event)"
          [attr.aria-label]="hasChildren() ? 'Toggle folder' : 'Folder'"
        >
          <sf-icon [name]="expanded() ? 'expand_more' : 'chevron_right'" />
        </button>
        <sf-icon class="node__icon" name="folder" />
        <span class="node__name">{{ node().displayName ?? node().uid }}</span>
      </button>

      @if (expanded() && hasChildren()) {
        @for (child of node().children ?? []; track child.uuid) {
          <sf-asset-picker-folder-node
            [node]="child"
            [depth]="depth() + 1"
            [selectedUuid]="selectedUuid()"
            (select)="select.emit($event)"
          />
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .node__row {
        display: flex;
        align-items: center;
        gap: var(--sf-1);
        width: 100%;
        padding: var(--sf-1) var(--sf-2);
        border: none;
        background: transparent;
        border-radius: var(--sf-radius-sm);
        cursor: pointer;
        text-align: left;
        color: var(--sf-ink);
        font-family: var(--sf-font-ui);
        font-size: var(--sf-text-sm);
      }
      .node__row:hover {
        background: var(--sf-surface);
      }
      .node__row--selected {
        background: var(--sf-signal);
        color: #fff;
      }
      .node__row--selected .node__icon {
        color: inherit;
      }
      .node__toggle {
        flex-shrink: 0;
        width: 16px;
        padding: 0;
        background: transparent;
        border: none;
        color: inherit;
        font-size: var(--sf-text-xs);
        cursor: pointer;
      }
      .node__toggle--leaf {
        visibility: hidden;
      }
      .node__icon {
        flex-shrink: 0;
        color: var(--sf-amber);
        font-size: 1.1em;
      }
      .node__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class SfAssetPickerFolderNodeComponent {
  readonly node = input.required<FolderView>();
  readonly depth = input<number>(0);
  readonly selectedUuid = input<string | null>(null);

  readonly select = output<FolderView>();

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
}
