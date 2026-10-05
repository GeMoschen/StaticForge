import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfTooltipDirective } from '../directives/sf-tooltip.directive';
import { ContextMenuItem, ContextMenuService } from '../services/context-menu.service';
import { TreeClipboardService } from '../services/tree-clipboard.service';
import { SfVirtualScrollDirective } from '../virtual/virtual-window';
import { ConfirmService } from './dialog/confirm.service';
import { SfBadgeComponent } from './display/sf-badge.component';
import { SfStatusComponent } from './display/sf-status.component';
import { sfUniqueId } from './forms/sf-field-context';
import { SfSearchInputComponent } from './forms/sf-search-input.component';
import { SfSkeletonComponent } from './layout/sf-skeleton.component';
import { SfMenuComponent, SfMenuItem } from './menu/sf-menu.component';
import { toContextItems } from './menu/sf-menu-item';
import { SfButtonComponent } from './sf-button.component';
import { SfEmptyStateComponent } from './sf-empty-state.component';
import { SfIconComponent } from './sf-icon.component';
import {
  SF_TREE_CREATE_ROW,
  SfTreeCreateKind,
  SfTreeDropPosition,
  SfTreeLoader,
  SfTreeModel,
  SfTreeNode,
  SfTreeNodeRow,
  SfTreePlacement,
  SfTreeRow,
  SfTreeSort,
  highlightSegments,
} from './tree/tree-model';

export type {
  SfTreeBadge,
  SfTreeCreateKind,
  SfTreeDropPosition,
  SfTreeLoadResult,
  SfTreeLoader,
  SfTreeNode,
  SfTreeSort,
} from './tree/tree-model';

/** What the user may do in a tree: `move` covers drag and drop, cut + paste and "Move to…"; `copy` copy + paste. */
export type SfTreeAction = 'rename' | 'delete' | 'move' | 'copy' | 'create';

/** A value now, later, or as a one-shot stream. */
export type SfTreeAsync<V> = V | Promise<V> | Observable<V>;

export interface SfTreeNameContext<T = unknown> {
  mode: 'rename' | 'create';
  /** The node being renamed (rename). */
  node: SfTreeNode<T> | null;
  /** The parent the name lives in (`null` = root). */
  parent: SfTreeNode<T> | null;
  /** What is being created (create). */
  kind: SfTreeCreateKind | null;
}

/** Returns an error message for an unacceptable name, or `null`/`undefined` when it is fine. */
export type SfTreeNameValidator<T = unknown> = (
  name: string,
  context: SfTreeNameContext<T>,
) => SfTreeAsync<string | null | undefined>;

/** Server filter: the root-to-match id paths for a query. */
export type SfTreeSearch = (query: string) => SfTreeAsync<readonly (readonly string[])[]>;

/** Called by the host once it carried out a request; `undo` (if given) is offered on the confirmation toast. */
export type SfTreeCompleted = (undo?: () => void) => void;

export interface SfTreeRenameRequest<T = unknown> {
  node: SfTreeNode<T>;
  name: string;
}

export interface SfTreeCreateRequest<T = unknown> {
  /** `null` = root. */
  parent: SfTreeNode<T> | null;
  kind: SfTreeCreateKind;
  name: string;
}

export interface SfTreeDeleteRequest<T = unknown> {
  nodes: SfTreeNode<T>[];
  /** The host deleted the nodes: shows "Deleted …" with an Undo button when `undo` is given. */
  completed: SfTreeCompleted;
}

export interface SfTreeMoveRequest<T = unknown> {
  nodes: SfTreeNode<T>[];
  /** The new parent; `null` = root. */
  target: SfTreeNode<T> | null;
  /** A copy (copy + paste) rather than a move. */
  copy: boolean;
  via: 'drag' | 'paste';
  /** The host moved (copied) the nodes: shows "Moved …" with an Undo button when `undo` is given. */
  completed: SfTreeCompleted;
}

/**
 * A sibling reorder ({@link SfTreeComponent.reorderable}): put `node` at `index` among the children of `parent` (`null`
 * = root), counted after the move. `parent` is the node's own parent for `Alt+↑/↓` and usually for a drag; a drop
 * before or after a row of another folder moves the node there at that position.
 */
export interface SfTreeReorderRequest<T = unknown> {
  node: SfTreeNode<T>;
  parent: SfTreeNode<T> | null;
  index: number;
  via: 'drag' | 'keyboard';
  /** The host reordered: announces "Moved …" and shows a toast with an Undo button when `undo` is given. */
  completed: SfTreeCompleted;
}

/** A drag that started outside the tree (a card of the main pane) was dropped on a node of it (or, `null`, on the root). */
export interface SfTreeForeignDrop<T = unknown> {
  /** The node dropped on; `null` = the root level. */
  target: SfTreeNode<T> | null;
  /** The drop event: the dragged payload is in its `dataTransfer`. */
  event: DragEvent;
}

interface DropTarget {
  /** The row under the pointer; `null` = the empty area (the root). */
  id: string | null;
  valid: boolean;
  position: SfTreeDropPosition;
}

interface EditState {
  mode: 'rename' | 'create';
  id: string;
  /** The typed text, kept in state so an editor scrolled out of the virtual window comes back with it. */
  draft: string;
  error: string | null;
  busy: boolean;
}

const SEARCH_DEBOUNCE_MS = 250;
const DRAG_EXPAND_MS = 800;

function toPromise<V>(value: SfTreeAsync<V>): Promise<V> {
  return isObservable(value) ? firstValueFrom(value) : Promise.resolve(value);
}

/**
 * The one tree (M35.8, decision 17): lazily loaded, sorted by name (or the source order), virtualised, keyboard-first.
 * State lives in {@link SfTreeModel}; this component renders it and maps keys, pointer and drag events onto it. The
 * host owns every API call: renames, creates, deletes and moves are emitted as requests, and the host refreshes the
 * affected parent with {@link refresh} afterwards (the expansion survives).
 *
 * **Accessibility.** Virtual scrolling renders only a window of rows, so the DOM can't nest `role=group`s: the tree is
 * a flat list of `role=treeitem` rows that carry the hierarchy in `aria-level`, `aria-setsize` and `aria-posinset`
 * (the accepted pattern for virtualised trees), plus `aria-expanded`, `aria-selected` and, on the tree,
 * `aria-multiselectable`. Focus is a roving `tabindex`. Drag and drop feedback is announced in a polite live region
 * (`aria-dropeffect` is deprecated).
 *
 * **Keyboard.** ↑/↓ move, ←/→ collapse (or go to the parent) / expand (or go to the first child), Home/End, `*`
 * expands the siblings, letters type ahead; Enter opens, Space selects (Ctrl+Space toggles, Shift+Space and
 * Shift+arrows extend, Ctrl+arrows move focus only, Ctrl+A selects all); F2 renames, Del deletes (confirmed, with
 * Undo), Ctrl+X/C/V cut, copy and paste, Shift+F10 or the ContextMenu key open the context menu; with
 * {@link reorderable}, Alt+↑/↓ move the focused node among its siblings.
 *
 * **Expansion** is kept per project and tree (`projectKey` + `treeId`) in the user's preferences and restored on init,
 * loading the expanded branches level by level.
 */
@Component({
  selector: 'sf-tree',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfMenuComponent,
    SfSearchInputComponent,
    SfSkeletonComponent,
    SfStatusComponent,
    SfTooltipDirective,
    SfVirtualScrollDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-tree.component.html',
  styleUrl: './sf-tree.component.scss',
  host: { class: 'sf-tree', '(focusin)': 'onFocusIn($event)', '(focusout)': 'onFocusOut($event)' },
})
export class SfTreeComponent<T = unknown> implements OnInit, OnDestroy {
  /** The tree's accessible name. */
  readonly label = input.required<string>();
  readonly loadChildren = input.required<SfTreeLoader<T>>();
  readonly sort = input<SfTreeSort>('name');
  /**
   * How status badges show: `icon` (default) keeps only the status icon, with the label as tooltip and screen-reader
   * text, so names get the room — names never truncate before secondary information. `label` shows full pills.
   */
  readonly badgeStyle = input<'icon' | 'label'>('icon');
  readonly multiselect = input(true, { transform: booleanAttribute });
  /** The selected node ids (two-way). */
  readonly selection = model<readonly string[]>([]);
  /** A plain click (no modifier) also opens the node; otherwise a double click does. */
  readonly openOnClick = input(true, { transform: booleanAttribute });
  /** The editing actions offered (keys, menus, drag and drop). Empty: a read-only tree. */
  readonly actions = input<readonly SfTreeAction[]>([]);
  /** Narrows {@link actions} per node set (e.g. the root page can't be deleted). */
  readonly allowAction = input<((action: SfTreeAction, nodes: readonly SfTreeNode<T>[]) => boolean) | null>(null);
  /** Whether `dragged` may go into `target` (`null` = root), on top of the built-in checks (droppable, no cycles). */
  readonly canDrop = input<((dragged: readonly SfTreeNode<T>[], target: SfTreeNode<T> | null) => boolean) | null>(
    null,
  );
  /**
   * Whether a drag that did not start in this tree — e.g. cards of the main pane — may be dropped on `target` (`null` =
   * the root), on top of the built-in check that the target is droppable. Without it foreign drags are ignored; with it
   * the node highlights as a drop target and the drop is reported through {@link foreignDrop}. The function sees only
   * what a drag reveals before the drop (`dataTransfer.types`), not the payload.
   */
  readonly acceptForeignDrag = input<((event: DragEvent, target: SfTreeNode<T> | null) => boolean) | null>(null);
  /** Nodes may be dropped or pasted at the root level. */
  readonly rootDroppable = input(false, { transform: booleanAttribute });
  /** What "New …" entries the `create` action offers. */
  readonly createKinds = input<readonly SfTreeCreateKind[]>(['folder', 'item']);
  readonly validateName = input<SfTreeNameValidator<T> | null>(null);
  /** Host entries for the context and ⋮ menus (inserted before "Delete"). */
  readonly menuItems = input<((nodes: readonly SfTreeNode<T>[]) => readonly ContextMenuItem[]) | null>(null);
  /**
   * The host's own confirmation before a delete (the typed word for a large delete, a dialog with redirect options for
   * a published page …). Resolves `true` to go on. Without it the tree asks its plain danger confirmation.
   */
  readonly confirmDelete = input<((nodes: readonly SfTreeNode<T>[]) => Promise<boolean>) | null>(null);
  readonly filterable = input(true, { transform: booleanAttribute });
  /** `client` filters the loaded nodes; `server` asks {@link search} for the matching paths (large trees). */
  readonly filterMode = input<'client' | 'server'>('client');
  readonly search = input<SfTreeSearch | null>(null);
  /** Shows the expand-all / collapse-all buttons. */
  readonly expandActions = input(true, { transform: booleanAttribute });
  /** With {@link treeId}: where the expansion is persisted. */
  readonly projectKey = input<string | null>(null);
  readonly treeId = input<string | null>(null);
  /** Trees of one scope share cut/copy/paste; defaults to {@link treeId}, then the label. */
  readonly clipboardScope = input<string | null>(null);
  /**
   * Siblings can be reordered (M35.9 decision 23; only with `sort="none"`, and with the `move` action): a drag shows a
   * drop indicator before / inside / after the row under the pointer — the upper and lower quarter of a row place the
   * node before or after it, the middle moves it into a droppable node — and `Alt+↑/↓` moves the focused node among its
   * siblings. Positions are emitted as {@link reorder}; moving into a node stays a {@link move}.
   */
  readonly reorderable = input(false, { transform: booleanAttribute });
  /**
   * The host owns the whole menu (M35.21, gate decision 157): the ⋮ and context menus list only the host's
   * {@link menuItems} and *Delete*, and there is no cut / copy / paste. Drag and drop and Del stay. F2 (and
   * {@link startRename}) then ask the host for a rename through {@link renameRequest} instead of editing in place.
   */
  readonly hostMenu = input(false, { transform: booleanAttribute });
  /**
   * The menu of a right click on empty space (below or beside the rows): the host's entries for "the root", normally only
   * its *New …* options. Without it (or with no entries) empty space has no menu.
   */
  readonly emptyMenuItems = input<(() => ContextMenuItem[]) | null>(null);

  /** Enter, double click, or a plain click with {@link openOnClick}. */
  readonly open = output<SfTreeNode<T>>();
  readonly rename = output<SfTreeRenameRequest<T>>();
  readonly create = output<SfTreeCreateRequest<T>>();
  readonly delete = output<SfTreeDeleteRequest<T>>();
  readonly move = output<SfTreeMoveRequest<T>>();
  /** With {@link hostMenu}: F2 on a node; the host shows its own rename dialog. */
  readonly renameRequest = output<SfTreeNode<T>>();
  /** A left click on empty space (below or beside the rows): the host opens the root (the store's top level). */
  readonly emptyClick = output<void>();
  /** "Move to…": the host asks for a destination with a picker and performs the move. */
  readonly moveTo = output<SfTreeNode<T>[]>();
  /** A sibling reorder ({@link reorderable}): the host applies it, then calls {@link refresh} and `completed`. */
  readonly reorder = output<SfTreeReorderRequest<T>>();
  /** A foreign drag ({@link acceptForeignDrag}) was dropped on a node: the host does what the drop means. */
  readonly foreignDrop = output<SfTreeForeignDrop<T>>();

  private readonly prefs = inject(PreferencesService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly clipboard = inject(TreeClipboardService);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly transloco = inject(TranslocoService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly virtual = viewChild(SfVirtualScrollDirective);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  protected readonly state = new SfTreeModel<T>({
    selection: this.selection,
    sort: this.sort,
    onError: (_error, parentId) => this.onLoadError(parentId),
  });
  protected readonly uid = sfUniqueId('sf-tree');
  protected readonly createRowId = SF_TREE_CREATE_ROW;

  protected readonly edit = signal<EditState | null>(null);
  protected readonly hovered = signal<string | null>(null);
  protected readonly dropTarget = signal<DropTarget | null>(null);
  /** Reordering is on: {@link reorderable} with the loader's order (a sorted tree has no order to change). */
  protected readonly canReorder = computed(() => this.reorderable() && this.sort() === 'none');
  protected readonly announcement = signal('');
  protected readonly searching = signal(false);
  /** Ids whose names are cut off (their tooltip shows the full name). */
  protected readonly truncated = signal<ReadonlySet<string>>(new Set());

  private dragged: SfTreeNode<T>[] | null = null;
  private expansionTouched = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchToken = 0;
  private dragExpandTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressContextMenu = false;
  private initialized = false;
  private activeLoader: SfTreeLoader<T> | null = null;
  /** The project/tree key whose saved expansion was last restored. */
  private restoredKey: string | null = null;
  /** The element inside the tree that has (or last had) focus; null once focus left the tree. */
  private focusedElement: HTMLElement | null = null;

  protected readonly window = computed(() => this.virtual()?.window() ?? null);
  protected readonly windowRows = computed<SfTreeRow<T>[]>(() => {
    const rows = this.state.rows();
    const window = this.window();
    return window ? rows.slice(window.start, window.end) : rows;
  });

  /** The row with `tabindex=0`: the focused one when rendered, else the first selected or first rendered row. */
  protected readonly tabStop = computed(() => {
    const rendered = this.windowRows().filter((row) => row.kind === 'node');
    const focused = this.state.focused();
    if (focused !== null && rendered.some((row) => row.id === focused)) {
      return focused;
    }
    return (rendered.find((row) => this.state.isSelected(row.id)) ?? rendered[0])?.id ?? null;
  });

  protected readonly rootLoading = computed(() => !this.state.rootLoaded() && this.state.loading().has(null));
  protected readonly rootFailed = computed(
    () => !this.state.rootLoaded() && !this.state.loading().has(null) && this.state.failed().has(null),
  );
  protected readonly noResults = computed(
    () => !!this.state.filter() && this.state.rootLoaded() && !this.searching() && this.state.nodeRows().length === 0,
  );
  /** Per project and tree: the same tree id in another project is another clipboard scope. */
  protected readonly scope = computed(() => {
    const treeId = this.treeId() ?? this.label();
    const projectKey = this.projectKey();
    return this.clipboardScope() ?? (projectKey ? `${projectKey}:${treeId}` : treeId);
  });
  private readonly expansionKey = computed(() => {
    const projectKey = this.projectKey();
    const treeId = this.treeId();
    return projectKey && treeId ? `${projectKey}\u0000${treeId}` : null;
  });
  protected readonly cutIds = computed<ReadonlySet<string>>(() => {
    const clip = this.clipboard.nodes();
    return clip?.mode === 'cut' && clip.scope === this.scope() ? new Set(clip.nodes.map((n) => n.id)) : new Set();
  });

  /** The ⋮ menus: rendered only for the hovered and the focused row (so a tab stop exists only there). */
  protected readonly rowMenus = computed(() => {
    const menus = new Map<string, SfMenuItem[]>();
    for (const id of [this.hovered(), this.state.focused()]) {
      if (id !== null && !menus.has(id) && this.state.node(id)) {
        const items = this.menuEntries(this.state.targetsOf(id));
        if (items.length) {
          menus.set(id, items);
        }
      }
    }
    return menus;
  });

  constructor() {
    // The keys the rows answer to, listed on the `?` sheet; the tree handles them itself (M35.14).
    const keys = (id: string, keys: string, enabled?: () => boolean) => ({
      id: `tree.${id}`,
      keys,
      scope: 'component' as const,
      group: 'tree' as const,
      description: `frame.shortcuts.items.${id}`,
      enabled,
    });
    inject(ShortcutService).use([
      keys('treeExpand', 'ArrowRight'),
      keys('treeCollapse', 'ArrowLeft'),
      keys('treeRename', 'F2', () => this.actions().includes('rename')),
      keys('treeReorder', 'Alt+ArrowUp', () => this.canReorder()),
    ]);

    // A later data source replaces the loaded structure (the first one is loaded in ngOnInit, synchronously).
    effect(
      () => {
        const loader = this.loadChildren();
        untracked(() => {
          if (this.initialized && loader !== this.activeLoader) {
            this.activeLoader = loader;
            void this.state.setLoader(loader);
          }
        });
      },
      { allowSignalWrites: true },
    );
    // Tracks the preferences document: a late load (after login) still restores, until the user expands anything.
    // Another project or tree id starts afresh with that key's saved expansion.
    effect(
      () => {
        const key = this.expansionKey();
        const ids = this.savedExpansion();
        untracked(() => {
          if (!this.initialized) {
            return;
          }
          if (key !== this.restoredKey) {
            this.restoredKey = key;
            this.expansionTouched = false;
            this.state.restoreExpansion(ids ?? []);
          } else if (ids) {
            this.restoreExpansion(ids);
          }
        });
      },
      { allowSignalWrites: true },
    );
    afterRender({ read: () => this.measureTruncation(), write: () => this.syncFocus() });

    // A drag whose source row left the virtual window never gets `dragend` (Chrome): clear the drag state on any
    // drop or drag end in the document, and when a drag starts outside this tree.
    const document = inject(DOCUMENT);
    const onDragEnd = () => this.endDrag();
    const onDrop = () => setTimeout(() => this.endDrag());
    const onDragStart = (event: Event) => {
      if (!(event.target instanceof Node && this.host.contains(event.target))) {
        this.endDrag();
      }
    };
    document.addEventListener('dragend', onDragEnd, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('dragstart', onDragStart, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('dragend', onDragEnd, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('dragstart', onDragStart, true);
    });
  }

  ngOnInit(): void {
    const ids = this.savedExpansion();
    if (ids) {
      this.restoreExpansion(ids);
    }
    this.restoredKey = this.expansionKey();
    this.activeLoader = this.loadChildren();
    void this.state.setLoader(this.activeLoader);
    this.initialized = true;
  }

  ngOnDestroy(): void {
    this.state.cancelAll();
    this.clearTimer(this.searchTimer);
    this.clearTimer(this.dragExpandTimer);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Reloads the children of `parentId` (`null` = root) after a create, move or delete; the expansion is kept. */
  refresh(parentId: string | null = null): Promise<void> {
    return this.state.load(parentId);
  }

  /** Reloads the whole tree; the expansion is kept and its branches load again. */
  reload(): Promise<void> {
    return this.state.setLoader(this.loadChildren());
  }

  expand(id: string): Promise<void> {
    return this.expandNode(id);
  }

  collapse(id: string): void {
    this.collapseNode(id);
  }

  async expandAll(): Promise<void> {
    this.expansionTouched = true;
    await this.state.expandAll();
    this.persistExpansion();
  }

  collapseAll(): void {
    this.expansionTouched = true;
    this.state.collapseAll();
    this.persistExpansion();
  }

  /** Loads and expands the ancestors along a root-to-node id path and focuses the node. */
  async reveal(path: readonly string[]): Promise<void> {
    await this.state.loadPaths([path]);
    for (const id of path.slice(0, -1)) {
      await this.expandNode(id);
    }
    const id = path[path.length - 1];
    if (id !== undefined && this.state.row(id)) {
      this.focusRow(id);
    }
  }

  /** Moves focus to a visible node (scrolling it into view). */
  focusNode(id: string): void {
    if (this.state.row(id)) {
      this.focusRow(id);
    }
  }

  /** Starts an inline rename (F2). */
  startRename(id: string): void {
    const node = this.state.node(id);
    if (!node || !this.allowed('rename', [node]) || !this.state.row(id)) {
      return;
    }
    if (this.hostMenu()) {
      this.renameRequest.emit(node);
      return;
    }
    this.edit.set({ mode: 'rename', id, draft: node.label, error: null, busy: false });
    this.focusEditor(id);
  }

  /** Starts an inline create row as the first child of `parentId` (`null` = root). */
  async startCreate(parentId: string | null, kind: SfTreeCreateKind): Promise<void> {
    if (parentId !== null) {
      this.expansionTouched = true;
      await this.state.expand(parentId);
      this.persistExpansion();
    }
    this.state.creating.set({ parentId, kind });
    this.edit.set({ mode: 'create', id: SF_TREE_CREATE_ROW, draft: '', error: null, busy: false });
    this.focusEditor(SF_TREE_CREATE_ROW);
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  protected segments(row: SfTreeNodeRow<T>) {
    return row.match ? highlightSegments(row.node.label, this.state.query()) : [{ text: row.node.label, match: false }];
  }

  protected isDraggable(row: SfTreeNodeRow<T>): boolean {
    return row.node.draggable !== false && this.allowed('move', [row.node]) && this.edit()?.id !== row.id;
  }

  protected editErrorId(): string {
    return `${this.uid}-edit-error`;
  }

  protected createLabel(kind: SfTreeCreateKind): string {
    return this.t(kind === 'folder' ? 'newFolder' : 'newItem');
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  protected onRowClick(event: MouseEvent, row: SfTreeNodeRow<T>): void {
    if (this.edit()?.id === row.id) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (this.multiselect() && event.shiftKey) {
      this.state.selectRange(row.id, mod);
    } else if (this.multiselect() && mod) {
      this.state.toggle(row.id);
    } else {
      this.state.selectOnly(row.id);
      if (this.openOnClick()) {
        this.open.emit(row.node);
      }
    }
    this.focusRow(row.id);
  }

  protected onRowDoubleClick(row: SfTreeNodeRow<T>): void {
    if (!this.openOnClick() && this.edit()?.id !== row.id) {
      this.open.emit(row.node);
    }
  }

  protected onToggleClick(event: MouseEvent, row: SfTreeNodeRow<T>): void {
    event.stopPropagation();
    if (row.expanded) {
      this.collapseNode(row.id);
    } else if (row.expandable) {
      void this.expandNode(row.id);
    }
    this.focusRow(row.id);
  }

  protected onRowFocus(row: SfTreeNodeRow<T>): void {
    this.state.focused.set(row.id);
  }

  protected onEmptyClick(event: MouseEvent): void {
    if (event.button === 0 && !(event.target instanceof Element && event.target.closest('[role="treeitem"]'))) {
      this.emptyClick.emit();
    }
  }

  protected onEmptyContextMenu(event: MouseEvent): void {
    if (this.suppressContextMenu || (event.target instanceof Element && event.target.closest('[role="treeitem"]'))) {
      return; // a row's own menu
    }
    const items = this.emptyMenuItems()?.() ?? [];
    if (items.length) {
      event.preventDefault();
      this.contextMenu.open(event, items);
    }
  }

  protected onContextMenu(event: MouseEvent, row: SfTreeNodeRow<T>): void {
    if (this.suppressContextMenu) {
      // The key press already opened the menu (Shift+F10 also fires `contextmenu` in some browsers).
      this.suppressContextMenu = false;
      event.preventDefault();
      return;
    }
    if (!this.state.isSelected(row.id)) {
      this.state.selectOnly(row.id);
    }
    this.state.focused.set(row.id);
    const items = this.contextItems(this.state.targetsOf(row.id));
    if (items.length) {
      this.contextMenu.open(event, items);
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  protected onKeydown(event: KeyboardEvent): void {
    // Keys on a row, or on the scroller while the focused row is scrolled out of the virtual window — not the rename
    // input or a row's ⋮ menu button.
    const target = event.target;
    const onRow = target instanceof HTMLElement && target.matches('[role="treeitem"][data-node-id]');
    if (!onRow && target !== this.viewport()?.nativeElement) {
      return;
    }
    const row = this.state.row(this.state.focused()) ?? this.state.row(this.tabStop());
    if (!row) {
      return;
    }
    if (this.handleKey(event, row)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private handleKey(event: KeyboardEvent, row: SfTreeNodeRow<T>): boolean {
    const mod = event.ctrlKey || event.metaKey;
    if (event.altKey && !mod && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && this.canReorder()) {
      this.keyReorder(row, event.key === 'ArrowUp' ? -1 : 1);
      return true;
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        this.moveFocus(row, this.state.step(row.id, event.key === 'ArrowDown' ? 1 : -1), event);
        return true;
      case 'Home':
        this.moveFocus(row, this.state.first(), event);
        return true;
      case 'End':
        this.moveFocus(row, this.state.last(), event);
        return true;
      case 'ArrowRight':
        if (row.expandable && !row.expanded) {
          void this.expandNode(row.id);
        } else if (row.expanded) {
          const child = this.state.step(row.id, 1);
          if (child && child.parentId === row.id) {
            this.focusRow(child.id);
          }
        }
        return true;
      case 'ArrowLeft':
        if (row.expanded) {
          this.collapseNode(row.id);
        } else if (row.parentId !== null && this.state.row(row.parentId)) {
          this.focusRow(row.parentId);
        }
        return true;
      case '*':
        this.expansionTouched = true;
        void this.state.expandSiblings(row.id).then(() => this.persistExpansion());
        return true;
      case 'Enter':
        this.open.emit(row.node);
        return true;
      case ' ':
        if (this.multiselect() && event.shiftKey) {
          this.state.selectRange(row.id, mod);
        } else if (this.multiselect() && mod) {
          this.state.toggle(row.id);
        } else {
          this.state.selectOnly(row.id);
        }
        return true;
      case 'F2':
        this.startRename(row.id);
        return true;
      case 'Delete':
        void this.deleteNodes(this.state.targetsOf(row.id));
        return true;
      case 'F10':
        if (!event.shiftKey) {
          return false;
        }
        this.openContextMenuFromKey(event, row);
        return true;
      case 'ContextMenu':
        this.openContextMenuFromKey(event, row);
        return true;
    }
    if (mod && !event.altKey) {
      switch (event.key.toLowerCase()) {
        case 'x':
          if (this.hostMenu()) {
            return false;
          }
          this.cut(this.state.targetsOf(row.id));
          return true;
        case 'c':
          if (this.hostMenu()) {
            return false;
          }
          this.copy(this.state.targetsOf(row.id));
          return true;
        case 'v':
          if (this.hostMenu()) {
            return false;
          }
          this.paste(row.node);
          return true;
        case 'a':
          if (this.multiselect()) {
            this.state.selectAll();
            return true;
          }
          return false;
      }
      return false;
    }
    if (event.key.length === 1 && !event.altKey && event.key.trim()) {
      const match = this.state.typeahead(event.key, row.id);
      if (match) {
        this.focusRow(match.id);
      }
      return true;
    }
    return false;
  }

  private moveFocus(from: SfTreeNodeRow<T>, next: SfTreeNodeRow<T> | null, event: KeyboardEvent): void {
    if (!next) {
      return;
    }
    if (event.shiftKey && this.multiselect()) {
      this.state.ensureAnchor(from.id);
      this.state.selectRange(next.id, event.ctrlKey || event.metaKey);
    }
    this.focusRow(next.id);
  }

  private openContextMenuFromKey(event: KeyboardEvent, row: SfTreeNodeRow<T>): void {
    const items = this.contextItems(this.state.targetsOf(row.id));
    if (!items.length) {
      return;
    }
    this.suppressContextMenu = true;
    setTimeout(() => (this.suppressContextMenu = false));
    const element = this.rowElement(row.id);
    this.contextMenu.open(element ?? event, items);
  }

  // ── Expansion ──────────────────────────────────────────────────────────────

  private expandNode(id: string): Promise<void> {
    this.expansionTouched = true;
    const done = this.state.expand(id);
    this.persistExpansion();
    return done;
  }

  private collapseNode(id: string): void {
    this.expansionTouched = true;
    const focused = this.state.focused();
    const focusInside = focused !== null && focused !== id && this.state.isSelfOrDescendant(focused, id);
    this.state.collapse(id);
    this.persistExpansion();
    if (focusInside) {
      this.focusRow(id, this.host.contains(this.host.ownerDocument.activeElement));
    }
  }

  private savedExpansion(): readonly string[] | null {
    const projectKey = this.projectKey();
    const treeId = this.treeId();
    return projectKey && treeId ? this.prefs.treeExpansion(projectKey, treeId) : null;
  }

  private restoreExpansion(ids: readonly string[]): void {
    const current = this.state.expanded();
    const same = ids.length === current.size && ids.every((id) => current.has(id));
    if (!this.expansionTouched && !same) {
      this.state.restoreExpansion(ids);
    }
  }

  private persistExpansion(): void {
    const projectKey = this.projectKey();
    const treeId = this.treeId();
    // While filtering, the expansion shown is the filter's, not the user's.
    if (projectKey && treeId && !this.state.filter()) {
      this.prefs.setTreeExpansion(projectKey, treeId, this.state.persistableExpansion());
    }
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  /** Focuses a row: scrolls it into the rendered window, renders now, then moves DOM focus (unless `domFocus` false). */
  private focusRow(id: string, domFocus = true): void {
    this.state.focused.set(id);
    this.scrollToRow(id);
    if (domFocus) {
      this.rowElement(id)?.focus();
    }
  }

  /**
   * Scrolls a row into the virtual window and renders it. Renders first, so the spacers already reflect a grown row
   * count (an expanded branch) — otherwise the browser clamps the scroll to the old height and the row isn't rendered.
   */
  private scrollToRow(id: string): void {
    this.changeDetector.detectChanges();
    const index = this.state.indexOf(id);
    if (index >= 0) {
      this.virtual()?.scrollToIndex(index);
    }
    this.changeDetector.detectChanges();
  }

  protected onFocusIn(event: FocusEvent): void {
    this.focusedElement = event.target instanceof HTMLElement ? event.target : null;
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) {
      return;
    }
    const left = event.target;
    // A row removed by the virtual window may blur first; only a still-connected element really lost focus.
    queueMicrotask(() => {
      if (left instanceof HTMLElement && left.isConnected && this.focusedElement === left) {
        this.focusedElement = null;
      }
    });
  }

  protected onScroll(): void {
    this.virtual()?.measure();
    this.changeDetector.detectChanges();
    this.syncFocus();
  }

  /**
   * Keeps keyboard focus in the tree across the virtual window: when the focused row (or the open editor) is scrolled
   * out and removed, focus parks on the scroller (`tabindex=-1`, which handles the keys for the focused row); when that
   * row (or editor) renders again, focus returns to it.
   */
  private syncFocus(): void {
    const viewport = this.viewport()?.nativeElement;
    if (!viewport) {
      return;
    }
    const document = this.host.ownerDocument;
    const active = document.activeElement;
    const lost = this.focusedElement !== null && !this.focusedElement.isConnected;
    if (lost && (active === null || active === document.body)) {
      viewport.focus({ preventScroll: true });
      this.focusedElement = viewport;
      return;
    }
    if (active === viewport) {
      const focused = this.state.focused();
      const target =
        (this.edit() ? this.host.querySelector<HTMLInputElement>('.sf-tree__edit-input') : null) ??
        (focused !== null ? this.rowElement(focused) : null);
      target?.focus({ preventScroll: true });
    }
  }

  private rowElement(id: string): HTMLElement | null {
    const rows = this.host.querySelectorAll<HTMLElement>('[role="treeitem"][data-node-id]');
    return Array.from(rows).find((row) => row.dataset['nodeId'] === id) ?? null;
  }

  private measureTruncation(): void {
    const names = this.host.querySelectorAll<HTMLElement>('.sf-tree__name[data-node-id]');
    const cut = new Set<string>();
    names.forEach((name) => {
      if (name.scrollWidth > name.clientWidth) {
        cut.add(name.dataset['nodeId'] ?? '');
      }
    });
    const current = this.truncated();
    if (cut.size !== current.size || [...cut].some((id) => !current.has(id))) {
      this.truncated.set(cut);
    }
  }

  // ── Inline rename / create ─────────────────────────────────────────────────

  private focusEditor(rowId: string): void {
    this.scrollToRow(rowId);
    const editor = this.host.querySelector<HTMLInputElement>('.sf-tree__edit-input');
    if (editor) {
      editor.value = this.edit()?.draft ?? '';
      editor.focus();
      editor.select();
    }
  }

  protected onEditKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitEdit(event.target as HTMLInputElement);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.endEdit(true);
    }
  }

  protected onEditInput(event: Event): void {
    const draft = (event.target as HTMLInputElement).value;
    this.edit.update((edit) => edit && { ...edit, draft, error: null });
  }

  /**
   * Leaving the editor cancels it — unless the virtual window removed it (scrolled away): then it keeps its draft and
   * comes back, focused, when its row renders again.
   */
  protected onEditBlur(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    queueMicrotask(() => {
      const edit = this.edit();
      if (edit && !edit.busy && input.isConnected && this.host.ownerDocument.activeElement !== input) {
        this.endEdit(false);
      }
    });
  }

  private async commitEdit(input: HTMLInputElement): Promise<void> {
    const edit = this.edit();
    if (!edit || edit.busy) {
      return;
    }
    const name = input.value.trim();
    const creating = edit.mode === 'create' ? this.state.creating() : null;
    const node = edit.mode === 'rename' ? this.state.node(edit.id) : null;
    const parentId = creating ? creating.parentId : node ? this.state.parentOf(node.id) : null;
    const parent = this.state.node(parentId);
    if (!name) {
      this.setEditError(this.t('nameRequired'));
      return;
    }
    if (node && name === node.label) {
      this.endEdit(true);
      return;
    }
    const validator = this.validateName();
    if (validator) {
      this.edit.set({ ...edit, busy: true });
      let error: string | null | undefined;
      try {
        error = await toPromise(validator(name, { mode: edit.mode, node, parent, kind: creating?.kind ?? null }));
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      if (this.edit()?.id !== edit.id) {
        return; // cancelled meanwhile
      }
      if (error) {
        this.edit.set({ ...edit, busy: false });
        this.setEditError(error);
        return;
      }
    }
    if (node) {
      this.rename.emit({ node, name });
    } else if (creating) {
      this.create.emit({ parent, kind: creating.kind, name });
    }
    this.endEdit(true);
  }

  private setEditError(error: string): void {
    this.edit.update((edit) => edit && { ...edit, error, busy: false });
    this.changeDetector.detectChanges();
    this.host.querySelector<HTMLInputElement>('.sf-tree__edit-input')?.focus();
  }

  private endEdit(refocus: boolean): void {
    const edit = this.edit();
    if (!edit) {
      return;
    }
    const creating = this.state.creating();
    this.edit.set(null);
    this.state.creating.set(null);
    this.changeDetector.detectChanges();
    if (refocus) {
      const target = edit.mode === 'rename' ? edit.id : creating?.parentId;
      if (target != null && this.state.row(target)) {
        this.focusRow(target);
      } else {
        const first = this.state.first();
        if (first) {
          this.focusRow(first.id);
        }
      }
    }
  }

  private onLoadError(parentId: string | null): void {
    if (parentId === null) {
      return; // the root shows an error state with Retry
    }
    const message = this.t('loadChildrenFailed', { name: this.state.node(parentId)?.label ?? '' });
    this.toasts.show(message, 'error', {
      label: 'shared.tree.retry',
      translate: true,
      run: () => void this.expandNode(parentId),
    });
  }

  protected retryRoot(): void {
    void this.state.load(null);
  }

  // ── Delete, clipboard, move ────────────────────────────────────────────────

  private async deleteNodes(nodes: SfTreeNode<T>[]): Promise<void> {
    if (!nodes.length || !this.allowed('delete', nodes)) {
      return;
    }
    const params = { count: nodes.length, name: nodes[0].label };
    const host = this.confirmDelete();
    const confirmed = host
      ? await host(nodes)
      : await this.confirms.confirm({
          title: this.t('deleteTitle', params),
          confirmLabel: this.t('deleteConfirm', params),
          tone: 'danger',
        });
    if (!confirmed) {
      return;
    }
    this.delete.emit({ nodes, completed: (undo) => this.completed(this.t('deleted', params), undo) });
  }

  private cut(nodes: SfTreeNode<T>[]): void {
    if (nodes.length && this.allowed('move', nodes)) {
      this.clipboard.cutNodes(this.scope(), nodes as SfTreeNode[]);
      this.announce(this.t('cut'));
    }
  }

  private copy(nodes: SfTreeNode<T>[]): void {
    if (nodes.length && this.allowed('copy', nodes)) {
      this.clipboard.copyNodes(this.scope(), nodes as SfTreeNode[]);
      this.announce(this.t('copy'));
    }
  }

  /** Where a paste onto `node` goes: into it when droppable, else next to it. `undefined` = nowhere. */
  private pasteTarget(node: SfTreeNode<T>): SfTreeNode<T> | null | undefined {
    if (this.isDroppable(node)) {
      return node;
    }
    const parentId = this.state.parentOf(node.id);
    return parentId === null ? (this.rootDroppable() ? null : undefined) : this.state.node(parentId);
  }

  private pasteRequest(node: SfTreeNode<T>): { nodes: SfTreeNode<T>[]; target: SfTreeNode<T> | null; copy: boolean } | null {
    const clip = this.clipboard.nodes();
    if (!clip || clip.scope !== this.scope()) {
      return null;
    }
    const nodes = clip.nodes as SfTreeNode<T>[];
    const copy = clip.mode === 'copy';
    const target = this.pasteTarget(node);
    if (target === undefined || !this.allowed(copy ? 'copy' : 'move', nodes) || !this.isValidDrop(nodes, target, copy)) {
      return null;
    }
    return { nodes, target, copy };
  }

  private paste(node: SfTreeNode<T>): void {
    const clip = this.clipboard.nodes();
    if (!clip || clip.scope !== this.scope()) {
      return;
    }
    const request = this.pasteRequest(node);
    if (!request) {
      this.announce(this.t('cannotDrop'));
      return;
    }
    if (!request.copy) {
      this.clipboard.clear();
    }
    this.requestMove(request.nodes, request.target, request.copy, 'paste');
  }

  private requestMove(nodes: SfTreeNode<T>[], target: SfTreeNode<T> | null, copy: boolean, via: 'drag' | 'paste'): void {
    const params = { count: nodes.length, name: nodes[0].label };
    this.move.emit({
      nodes,
      target,
      copy,
      via,
      completed: (undo) => this.completed(this.t(copy ? 'copied' : 'moved', params), undo),
    });
  }

  // ── Reorder ────────────────────────────────────────────────────────────────

  /** `Alt+↑/↓`: one place up or down among the siblings; at the ends it only says so. */
  private keyReorder(row: SfTreeNodeRow<T>, delta: -1 | 1): void {
    if (!this.allowed('move', [row.node]) || row.node.draggable === false) {
      return;
    }
    const placement = this.state.siblingStep(row.id, delta);
    if (!placement) {
      this.announce(this.t(delta < 0 ? 'reorderAtStart' : 'reorderAtEnd', { name: row.node.label }));
      return;
    }
    this.requestReorder(row.node, placement, 'keyboard');
  }

  /** A drop before / after: allowed in place among the siblings, or into another parent the node may move to. */
  private isValidReorder(nodes: readonly SfTreeNode<T>[], placement: SfTreePlacement | null): placement is SfTreePlacement {
    if (!placement || nodes.length !== 1) {
      return false;
    }
    const [node] = nodes;
    if (this.state.parentOf(node.id) === placement.parentId && this.state.node(node.id)) {
      return true;
    }
    const parent = this.state.node(placement.parentId);
    if (placement.parentId === null ? !this.rootDroppable() : !parent || !this.isDroppable(parent)) {
      return false;
    }
    if (placement.parentId !== null && this.state.isSelfOrDescendant(placement.parentId, node.id)) {
      return false;
    }
    return this.canDrop()?.(nodes, parent) ?? true;
  }

  private requestReorder(node: SfTreeNode<T>, placement: SfTreePlacement, via: 'drag' | 'keyboard'): void {
    const sameParent = this.state.parentOf(node.id) === placement.parentId;
    const count = (this.state.childrenOf(placement.parentId)?.length ?? 0) + (sameParent ? 0 : 1);
    const message = this.t('reordered', { name: node.label, position: placement.index + 1, count });
    const refocus = via === 'keyboard';
    this.reorder.emit({
      node,
      parent: this.state.node(placement.parentId),
      index: placement.index,
      via,
      completed: (undo) => {
        this.completed(message, undo);
        // The row re-rendered at its new place: keep the keyboard on it.
        if (refocus && this.state.row(node.id)) {
          this.focusRow(node.id);
        }
      },
    });
  }

  /**
   * Where a drag over `row` would drop: by the pointer's height in the row when reordering one node, else inside (a
   * reorder moves a single node, so several dragged nodes keep the whole row as the drop zone).
   */
  private dropPosition(event: DragEvent, row: SfTreeNodeRow<T>): SfTreeDropPosition {
    if (!this.canReorder() || (this.dragged?.length ?? 0) > 1) {
      return 'inside';
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = event.clientY - rect.top;
    if (offset < rect.height / 4) {
      return 'before';
    }
    if (offset > (rect.height * 3) / 4) {
      return 'after';
    }
    if (this.isDroppable(row.node)) {
      return 'inside';
    }
    return offset < rect.height / 2 ? 'before' : 'after';
  }

  private completed(message: string, undo?: () => void): void {
    this.announce(message);
    if (undo) {
      this.toasts.undo(message, undo);
    } else {
      this.toasts.show(message, 'success');
    }
  }

  private isDroppable(node: SfTreeNode<T>): boolean {
    return node.droppable ?? !!node.hasChildren;
  }

  /** Built-in drop rules (droppable target, no cycles, not where it already is) plus the host's {@link canDrop}. */
  private isValidDrop(nodes: readonly SfTreeNode<T>[], target: SfTreeNode<T> | null, copy: boolean): boolean {
    if (!nodes.length) {
      return false;
    }
    if (target === null) {
      if (!this.rootDroppable()) {
        return false;
      }
    } else if (!this.isDroppable(target)) {
      return false;
    }
    const targetId = target?.id ?? null;
    for (const node of nodes) {
      if (targetId !== null && this.state.isSelfOrDescendant(targetId, node.id)) {
        return false;
      }
      if (!copy && this.state.node(node.id) && this.state.parentOf(node.id) === targetId) {
        return false;
      }
    }
    return this.canDrop()?.(nodes, target) ?? true;
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  protected onDragStart(event: DragEvent, row: SfTreeNodeRow<T>): void {
    if (!this.isDraggable(row)) {
      event.preventDefault();
      return;
    }
    if (!this.state.isSelected(row.id)) {
      this.state.selectOnly(row.id);
    }
    this.dragged = this.state.targetsOf(row.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.dragged.map((node) => node.label).join('\n'));
    }
  }

  protected onDragOver(event: DragEvent, row: SfTreeNodeRow<T> | null): void {
    if (row === null && event.target instanceof Element && event.target.closest('.sf-tree__row')) {
      return; // the row's own handler decided
    }
    if (!this.dragged) {
      this.onForeignDragOver(event, row);
      return;
    }
    const target = row?.node ?? null;
    const position = row ? this.dropPosition(event, row) : 'inside';
    const valid =
      position === 'inside'
        ? this.isValidDrop(this.dragged, target, false)
        : this.isValidReorder(this.dragged, this.state.placement(this.dragged[0].id, row!.id, position));
    if (valid) {
      event.preventDefault();
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    }
    const id = row?.id ?? null;
    const current = this.dropTarget();
    if (current?.id === id && current.valid === valid && current.position === position) {
      return;
    }
    this.dropTarget.set({ id, valid, position });
    // Announced per row: moving between its before / inside / after zones would be too chatty.
    if (current === null || current.id !== id) {
      const name = target?.label ?? this.label();
      const messages = { before: 'dropBefore', inside: 'dropInto', after: 'dropAfter' } as const;
      this.announce(valid ? this.t(messages[position], { name }) : this.t('cannotDrop'));
    }
    this.clearTimer(this.dragExpandTimer);
    if (valid && position === 'inside' && row && row.expandable && !row.expanded) {
      this.dragExpandTimer = setTimeout(() => {
        if (this.dropTarget()?.id === row.id) {
          void this.expandNode(row.id);
        }
      }, DRAG_EXPAND_MS);
    }
  }

  /** Whether a foreign drag may land on `target` (`null` = the root). */
  private acceptsForeign(event: DragEvent, target: SfTreeNode<T> | null): boolean {
    const accept = this.acceptForeignDrag();
    if (!accept) {
      return false;
    }
    const droppable = target === null ? this.rootDroppable() : this.isDroppable(target);
    return droppable && accept(event, target);
  }

  private onForeignDragOver(event: DragEvent, row: SfTreeNodeRow<T> | null): void {
    if (!this.acceptForeignDrag()) {
      return;
    }
    const target = row?.node ?? null;
    const valid = this.acceptsForeign(event, target);
    if (valid) {
      event.preventDefault();
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    }
    const id = row?.id ?? null;
    const current = this.dropTarget();
    if (current?.id === id && current.valid === valid) {
      return;
    }
    this.dropTarget.set({ id, valid, position: 'inside' });
    if (current === null || current.id !== id) {
      this.announce(valid ? this.t('dropInto', { name: target?.label ?? this.label() }) : this.t('cannotDrop'));
    }
    this.clearTimer(this.dragExpandTimer);
    if (valid && row && row.expandable && !row.expanded) {
      this.dragExpandTimer = setTimeout(() => {
        if (this.dropTarget()?.id === row.id) {
          void this.expandNode(row.id);
        }
      }, DRAG_EXPAND_MS);
    }
  }

  protected onDragLeave(event: DragEvent, row: SfTreeNodeRow<T>): void {
    const related = event.relatedTarget;
    if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) {
      return;
    }
    if (this.dropTarget()?.id === row.id) {
      this.dropTarget.set(null);
    }
  }

  protected onDrop(event: DragEvent, row: SfTreeNodeRow<T> | null): void {
    if (row === null && event.target instanceof Element && event.target.closest('.sf-tree__row')) {
      return;
    }
    const nodes = this.dragged;
    if (!nodes) {
      const target = row?.node ?? null;
      if (this.acceptsForeign(event, target)) {
        event.preventDefault();
        event.stopPropagation();
        this.endDrag();
        this.foreignDrop.emit({ target, event });
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = row?.node ?? null;
    const position = row ? this.dropPosition(event, row) : 'inside';
    this.endDrag();
    if (position !== 'inside') {
      const placement = this.state.placement(nodes[0].id, row!.id, position);
      if (this.isValidReorder(nodes, placement)) {
        this.requestReorder(nodes[0], placement, 'drag');
      } else {
        this.announce(this.t('cannotDrop'));
      }
    } else if (this.isValidDrop(nodes, target, false)) {
      this.requestMove(nodes, target, false, 'drag');
    } else {
      this.announce(this.t('cannotDrop'));
    }
  }

  protected endDrag(): void {
    this.dragged = null;
    this.dropTarget.set(null);
    this.clearTimer(this.dragExpandTimer);
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  protected onQuery(value: string): void {
    this.state.setQuery(value);
    this.clearTimer(this.searchTimer);
    const search = this.search();
    if (this.filterMode() !== 'server' || !search) {
      return;
    }
    const token = ++this.searchToken;
    if (!value.trim()) {
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => void this.runSearch(search, value, token), SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(search: SfTreeSearch, query: string, token: number): Promise<void> {
    let paths: readonly (readonly string[])[];
    try {
      paths = (await toPromise(search(query))) ?? [];
      await this.state.loadPaths(paths);
    } catch {
      paths = [];
    }
    if (token === this.searchToken) {
      this.state.serverPaths.set(paths);
      this.searching.set(false);
    }
  }

  // ── Menus ──────────────────────────────────────────────────────────────────

  private allowed(action: SfTreeAction, nodes: readonly SfTreeNode<T>[]): boolean {
    return this.actions().includes(action) && (this.allowAction()?.(action, nodes) ?? true);
  }

  /** The entries of the ⋮ and context menus for an action target set. */
  private menuEntries(nodes: SfTreeNode<T>[]): SfMenuItem[] {
    if (!nodes.length) {
      return [];
    }
    const single = nodes.length === 1 ? nodes[0] : null;
    const items: SfMenuItem[] = [];
    if (this.hostMenu()) {
      items.push(...fromContextItems(this.menuItems()?.(nodes) ?? [], 'host'));
      if (this.allowed('delete', nodes)) {
        items.push({
          id: 'delete',
          label: this.t('deleteConfirm', { count: nodes.length }),
          icon: 'delete',
          danger: true,
          shortcut: 'Del',
          separatorBefore: items.length > 0,
          action: () => void this.deleteNodes(nodes),
        });
      }
      return items;
    }
    const section = (start: number) => {
      if (start > 0 && items.length > start) {
        items[start] = { ...items[start], separatorBefore: true };
      }
    };
    if (single && this.isDroppable(single) && this.allowed('create', [single])) {
      for (const kind of this.createKinds()) {
        items.push({
          id: `create-${kind}`,
          label: this.createLabel(kind),
          icon: kind === 'folder' ? 'create_new_folder' : 'note_add',
          action: () => void this.startCreate(single.id, kind),
        });
      }
    }
    if (single && this.allowed('rename', [single])) {
      items.push({ id: 'rename', label: this.t('rename'), icon: 'edit', shortcut: 'F2', action: () => this.startRename(single.id) });
    }
    let start = items.length;
    const canMove = this.allowed('move', nodes);
    const canCopy = this.allowed('copy', nodes);
    if (canMove) {
      items.push({ id: 'cut', label: this.t('cut'), icon: 'content_cut', shortcut: 'Mod+X', action: () => this.cut(nodes) });
    }
    if (canCopy) {
      items.push({ id: 'copy', label: this.t('copy'), icon: 'content_copy', shortcut: 'Mod+C', action: () => this.copy(nodes) });
    }
    if (canMove || canCopy) {
      items.push({
        id: 'paste',
        label: this.t('paste'),
        icon: 'content_paste',
        shortcut: 'Mod+V',
        disabled: !single || !this.pasteRequest(single),
        action: () => single && this.paste(single),
      });
    }
    if (canMove) {
      items.push({ id: 'move-to', label: this.t('moveTo'), icon: 'drive_file_move', action: () => this.moveTo.emit(nodes) });
    }
    section(start);
    start = items.length;
    items.push(...fromContextItems(this.menuItems()?.(nodes) ?? [], 'host'));
    section(start);
    if (this.allowed('delete', nodes)) {
      start = items.length;
      items.push({
        id: 'delete',
        label: this.t('deleteConfirm', { count: nodes.length }),
        icon: 'delete',
        danger: true,
        shortcut: 'Del',
        action: () => void this.deleteNodes(nodes),
      });
      section(start);
    }
    // A leading separator (host entries first) would have nothing above it.
    if (items[0]?.separatorBefore) {
      items[0] = { ...items[0], separatorBefore: false };
    }
    return items;
  }

  private contextItems(nodes: SfTreeNode<T>[]): ContextMenuItem[] {
    return toContextItems(this.menuEntries(nodes));
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  private announce(message: string): void {
    // Cleared first, so the same message twice in a row is announced twice.
    this.announcement.set('');
    this.changeDetector.detectChanges();
    this.announcement.set(message);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`shared.tree.${key}`, params);
  }

  private clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/** A host's context-menu entries as menu items: separator entries become `separatorBefore` on the next item. */
function fromContextItems(entries: readonly ContextMenuItem[], idPrefix: string): SfMenuItem[] {
  const items: SfMenuItem[] = [];
  let separatorBefore = false;
  entries.forEach((entry, index) => {
    if (entry.separator) {
      separatorBefore = true;
      return;
    }
    const id = `${idPrefix}-${index}`;
    items.push({
      id,
      label: entry.label,
      icon: entry.icon,
      danger: entry.danger,
      disabled: entry.disabled,
      disabledReason: entry.disabledReason,
      shortcut: entry.shortcut,
      group: entry.group,
      separatorBefore,
      children: entry.children?.length ? fromContextItems(entry.children, id) : undefined,
      action: entry.action,
    });
    separatorBefore = false;
  });
  return items;
}
