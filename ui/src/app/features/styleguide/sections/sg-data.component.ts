import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableFilter,
  SfDataTableSort,
} from '../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeCreateRequest,
  SfTreeDeleteRequest,
  SfTreeMoveRequest,
  SfTreeRenameRequest,
} from '../../../shared/components/sf-tree.component';
import { SfSplitterComponent } from '../../../shared/components/splitter/sf-splitter.component';
import { DATA } from '../styleguide.demo';
import {
  FAKE_LOCALES,
  FAKE_STATUSES,
  FakeNode,
  FakeNodeData,
  FakePageRow,
  FakeTree,
  fakePageRows,
} from '../styleguide.fake-data';
import { sectionOf } from '../styleguide.sections';

const STATUS_BY_VALUE = new Map(FAKE_STATUSES.map((s) => [s.value, s]));
const LOCALE_BY_VALUE = new Map(FAKE_LOCALES.map((l) => [l.value, l.label]));

/**
 * The data section of the style guide (M35.9): `sf-tree` over a fake lazily loaded page tree (renames, creates,
 * deletes with Undo and moves really happen, in memory), `sf-data-table` over 200 fake rows with selection, filters,
 * search and sorting — `urlSync` off, so the page URL stays clean — and `sf-splitter`.
 */
@Component({
  selector: 'sf-sg-data',
  standalone: true,
  imports: [
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfRelativeTimeComponent,
    SfSplitterComponent,
    SfStatusComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-data.component.html',
  styleUrl: './sg-data.component.scss',
})
export class SgDataComponent {
  private readonly toasts = inject(ToastService);
  private readonly tree = viewChild(SfTreeComponent);
  private readonly store = new FakeTree();

  protected readonly s = sectionOf('data');
  protected readonly d = DATA;
  protected readonly nodeCount = this.store.size;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'copy', 'create'];
  protected readonly loadChildren = (parent: FakeNode | null) => this.store.load(parent);

  protected readonly rows: readonly FakePageRow[] = fakePageRows();
  protected readonly columns: readonly SfDataTableColumn<FakePageRow>[] = [
    { id: 'title', header: DATA.columns.title, value: (r) => r.title, sortable: true, hideable: false, width: 220 },
    { id: 'path', header: DATA.columns.path, value: (r) => r.path, sortable: true, width: 260 },
    {
      id: 'status',
      header: DATA.columns.status,
      value: (r) => STATUS_BY_VALUE.get(r.status)?.label,
      sortable: true,
      width: 140,
    },
    { id: 'locale', header: DATA.columns.locale, value: (r) => LOCALE_BY_VALUE.get(r.locale), sortable: true, width: 110 },
    { id: 'author', header: DATA.columns.author, value: (r) => r.author, sortable: true, width: 170 },
    {
      id: 'modified',
      header: DATA.columns.modified,
      value: (r) => r.modified,
      compare: (a, b) => a.modified.getTime() - b.modified.getTime(),
      sortable: true,
      searchable: false,
      align: 'end',
      width: 140,
    },
  ];
  protected readonly filters: readonly SfDataTableFilter<FakePageRow>[] = [
    {
      id: 'status',
      label: DATA.filters.status,
      options: FAKE_STATUSES.map((s) => ({ value: s.value, label: s.label })),
      match: (row, values) => values.includes(row.status),
    },
    {
      id: 'locale',
      label: DATA.filters.locale,
      options: FAKE_LOCALES,
      match: (row, values) => values.includes(row.locale),
    },
  ];
  protected readonly initialSort: readonly SfDataTableSort[] = [{ id: 'modified', direction: 'desc' }];
  protected readonly bulkActions: readonly SfDataTableBulkAction<FakePageRow>[] = [
    {
      id: 'publish',
      label: DATA.bulk.publish,
      icon: 'publish',
      variant: 'secondary',
      action: (selection) => this.bulk(DATA.bulk.publish, selection.count),
    },
    {
      id: 'delete',
      label: DATA.bulk.delete,
      icon: 'delete',
      variant: 'danger',
      action: (selection) => this.bulk(DATA.bulk.delete, selection.count),
    },
  ];
  protected readonly rowKey = (row: FakePageRow) => row.id;
  protected readonly rowLabel = (row: FakePageRow) => row.title;

  protected statusOf(row: FakePageRow) {
    return STATUS_BY_VALUE.get(row.status)!;
  }

  protected opened(label: string): void {
    this.toasts.show(DATA.opened + label, 'info');
  }

  protected bulk(label: string, count: number): void {
    this.toasts.show(`${DATA.done}${label} (${count})`, 'success');
  }

  protected rename(request: SfTreeRenameRequest<FakeNodeData>): void {
    this.store.rename(request.node.id, request.name);
    void this.tree()?.refresh(this.store.parentOf(request.node.id));
  }

  protected create(request: SfTreeCreateRequest<FakeNodeData>): void {
    const parentId = request.parent?.id ?? null;
    this.store.create(parentId, request.kind, request.name);
    void this.tree()?.refresh(parentId);
  }

  protected delete(request: SfTreeDeleteRequest<FakeNodeData>): void {
    const parents = this.parentsOf(request.nodes.map((n) => n.id));
    const undo = this.store.remove(request.nodes.map((n) => n.id));
    this.refreshAll(parents);
    request.completed(() => {
      undo();
      this.refreshAll(parents);
    });
  }

  protected move(request: SfTreeMoveRequest<FakeNodeData>): void {
    const ids = request.nodes.map((n) => n.id);
    const targetId = request.target?.id ?? null;
    const parents = [...this.parentsOf(ids), targetId];
    const undo = this.store.move(ids, targetId, request.copy);
    this.refreshAll(parents);
    request.completed(() => {
      undo();
      this.refreshAll(parents);
    });
  }

  private parentsOf(ids: readonly string[]): (string | null)[] {
    return [...new Set(ids.map((id) => this.store.parentOf(id)))];
  }

  private refreshAll(parents: readonly (string | null)[]): void {
    for (const parent of new Set(parents)) {
      void this.tree()?.refresh(parent);
    }
  }
}
