import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfTreeComponent } from '../../../../shared/components/sf-tree.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import { injectSampleText } from '../changes/sample-area.util';
import { SampleEntry, childrenOf, entryById } from '../sample-data';
import { PagesMoveRequest } from './sample-pages-review';

/** The id of the project root in the picker. */
const ROOT = '__root__';

/**
 * The Move dialog of Pages (M35.18, gate round 12): one dialog for the folder table's bulk *Move…*, a folder's *Move…* in its
 * header menu and *Move to…* in the tree's context menu. The page folders are a tree to pick from; the first node, *Pages*,
 * is the project root. A folder that is being moved — and what lies inside it — shows "Inside the folder being moved" and
 * can't be chosen. **Move** stays disabled until a target is chosen. The sample's tree does not change: a toast says what
 * moved and offers Undo.
 */
@Component({
  selector: 'sf-sample-pages-move-dialog',
  standalone: true,
  imports: [SfButtonComponent, SfDialogComponent, SfDialogFooterDirective, SfTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-pages-move-dialog.component.scss',
  template: `
    <sf-dialog size="md" [title]="t('move.title', { count: rows().length, name: rows()[0].name })" (closed)="closed.emit()">
      <p class="move__lead">{{ t('move.lead') }}</p>
      <div class="move__tree">
        <sf-tree
          [label]="t('move.tree')"
          [loadChildren]="loader()"
          [selection]="selection()"
          [multiselect]="false"
          [filterable]="false"
          [expandActions]="false"
          (open)="onOpen($event)"
        />
      </div>
      <ng-container sfDialogFooter>
        <sf-button variant="ghost" (click)="closed.emit()">{{ t('move.cancel') }}</sf-button>
        <sf-button [disabled]="selected() === null" [disabledReason]="selected() === null ? t('move.chooseFirst') : null" (click)="choose()">{{
          t('move.confirm')
        }}</sf-button>
      </ng-container>
    </sf-dialog>
  `,
})
export class SamplePagesMoveDialogComponent {
  private readonly toasts = inject(ToastService);
  protected readonly t = injectSampleText('styleguide.sample.pages');

  readonly move = input.required<PagesMoveRequest>();
  readonly closed = output<void>();

  protected readonly rows = computed(() => this.move().rows);
  protected readonly selected = signal<string | null>(null);
  protected readonly selection = computed(() => (this.selected() === null ? [] : [this.selected()!]));

  /** Every folder that is being moved or lies inside one that is. */
  private readonly blocked = computed<ReadonlySet<string>>(() => {
    const blocked = new Set<string>();
    const mark = (entry: SampleEntry): void => {
      blocked.add(entry.id);
      (entry.children ?? []).forEach(mark);
    };
    this.rows()
      .filter((row) => row.kind === 'folder')
      .forEach(mark);
    return blocked;
  });

  protected readonly loader = computed<SfTreeLoader<SampleEntry>>(() => {
    const blocked = this.blocked();
    const toNode = (entry: SampleEntry): SfTreeNode<SampleEntry> => ({
      id: entry.id,
      label: entry.name,
      icon: 'folder',
      secondary: blocked.has(entry.id) ? this.t('move.blocked') : null,
      hasChildren: (entry.children ?? []).some((child) => child.kind === 'folder'),
      draggable: false,
      droppable: false,
      data: entry,
    });
    const folders = (parent: string | null) => childrenOf(parent).filter((entry) => entry.kind === 'folder').map(toNode);
    return (parent) =>
      parent === null
        ? [{ id: ROOT, label: this.t('move.root'), icon: 'home', hasChildren: false, draggable: false, droppable: false }, ...folders(null)]
        : folders(parent.id);
  });

  protected onOpen(node: SfTreeNode<SampleEntry>): void {
    if (!this.blocked().has(node.id)) {
      this.selected.set(node.id);
    }
  }

  protected choose(): void {
    const target = this.selected();
    if (target === null) {
      return;
    }
    const name = target === ROOT ? this.t('move.root') : (entryById(target)?.name ?? '');
    const first = this.rows()[0]?.name ?? '';
    this.closed.emit();
    this.toasts.undo(this.t('move.done', { count: this.rows().length, name: first, target: name }), () =>
      this.toasts.show(this.t('move.undone'), 'info'),
    );
  }
}
