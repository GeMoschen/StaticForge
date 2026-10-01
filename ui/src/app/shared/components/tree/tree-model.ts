import { Signal, WritableSignal, computed, signal } from '@angular/core';
import { Observable, Subscription, from, isObservable, of, take } from 'rxjs';
import type { SfStatusTone } from '../display/sf-status.component';

/** A status or label shown after a node's name: `sf-status` (icon + text) by default, `sf-badge` with `kind: 'badge'`. */
export interface SfTreeBadge {
  label: string;
  tone?: SfStatusTone;
  kind?: 'status' | 'badge';
  icon?: string;
}

/** One node of an `sf-tree`. */
export interface SfTreeNode<T = unknown> {
  /** Unique within the tree. */
  id: string;
  /** The name: the accessible name, the sort key and what the filter and type-ahead match. */
  label: string;
  icon?: string;
  /** Secondary text (the developer-mode UID, decision 19): monospace and muted, shown only when given. */
  secondary?: string | null;
  badges?: readonly SfTreeBadge[];
  /** Whether the node can be expanded; its children are loaded on first expansion. */
  hasChildren?: boolean;
  /** Whether the node can be dragged (default: true when moving is enabled). */
  draggable?: boolean;
  /** Whether nodes can be dropped (moved, pasted, created) into it (default: `hasChildren`). */
  droppable?: boolean;
  /** The host's payload. */
  data?: T;
}

/** What a loader may return. */
export type SfTreeLoadResult<T = unknown> =
  | Observable<readonly SfTreeNode<T>[]>
  | Promise<readonly SfTreeNode<T>[]>
  | readonly SfTreeNode<T>[];

/** Loads the children of a node, or the root nodes for `null`. Called once per node until it is refreshed. */
export type SfTreeLoader<T = unknown> = (parent: SfTreeNode<T> | null) => SfTreeLoadResult<T>;

/** `name`: siblings sorted by label (locale compare, numeric); `none`: the loader's order (Navigation). */
export type SfTreeSort = 'name' | 'none';

export type SfTreeCreateKind = 'folder' | 'item';

/** The id of the inline-create row. */
export const SF_TREE_CREATE_ROW = '\u0000create';

/** Where a dragged node would land relative to the row under the pointer (`before`/`after` need `reorderable`). */
export type SfTreeDropPosition = 'before' | 'inside' | 'after';

/** A sibling position: the parent (`null` = root) and the node's index among its children after the move. */
export interface SfTreePlacement {
  parentId: string | null;
  index: number;
}

/** A rendered row of the flattened tree. */
export type SfTreeRow<T = unknown> =
  | {
      kind: 'node';
      id: string;
      node: SfTreeNode<T>;
      level: number;
      setSize: number;
      posInSet: number;
      parentId: string | null;
      expandable: boolean;
      expanded: boolean;
      loading: boolean;
      /** The node matches the active filter. */
      match: boolean;
    }
  | { kind: 'loading'; id: string; level: number; parentId: string }
  | { kind: 'create'; id: string; level: number; parentId: string | null; createKind: SfTreeCreateKind };

export type SfTreeNodeRow<T = unknown> = Extract<SfTreeRow<T>, { kind: 'node' }>;

interface Structure<T> {
  nodes: ReadonlyMap<string, SfTreeNode<T>>;
  /** Loaded child ids per parent (`null` = root). A missing entry means "not loaded yet". */
  children: ReadonlyMap<string | null, readonly string[]>;
  parents: ReadonlyMap<string, string | null>;
}

interface Filter {
  /** The ids shown while filtering: the matches and their ancestors. */
  visible: ReadonlySet<string>;
  matches: ReadonlySet<string>;
  /** Ancestors of matches: auto-expanded. */
  ancestors: ReadonlySet<string>;
}

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const TYPEAHEAD_MS = 500;

export interface SfTreeModelOptions {
  /** The selection (ids); usually the component's `selection` model. */
  selection: WritableSignal<readonly string[]>;
  sort: Signal<SfTreeSort>;
  /** Called with a load error; the node then shows as collapsed and can be retried by expanding it again. */
  onError?: (error: unknown, parent: string | null) => void;
}

/**
 * The headless state of `sf-tree` (M35.8): lazily loaded structure, expansion, selection, focus, type-ahead and filter,
 * flattened into {@link rows} for a virtualised, flat `role=treeitem` list. No DOM, no services: the component maps
 * keys, pointer and drag events to these operations.
 */
export class SfTreeModel<T = unknown> {
  private readonly structure = signal<Structure<T>>({ nodes: new Map(), children: new Map(), parents: new Map() });
  private loader: SfTreeLoader<T> | null = null;
  private readonly inFlight = new Map<
    string | null,
    { sub: Subscription; done: Promise<void>; resolve: () => void }
  >();
  private generation = 0;
  private anchor: string | null = null;
  private typed = '';
  private typedAt = 0;

  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly loading = signal<ReadonlySet<string | null>>(new Set());
  /** Parents (`null` = root) whose last load failed; cleared when they load again. */
  readonly failed = signal<ReadonlySet<string | null>>(new Set());
  readonly focused = signal<string | null>(null);
  /** The filter text; empty = no filter. */
  readonly query = signal('');
  /** Server-side filter result: root-to-match id paths. `null` = filter client-side over the loaded nodes. */
  readonly serverPaths = signal<readonly (readonly string[])[] | null>(null);
  /** Expansion overrides the user made while filtering (reset with the query). */
  private readonly filterOverrides = signal<ReadonlyMap<string, boolean>>(new Map());
  /** An inline-create row under a parent. */
  readonly creating = signal<{ parentId: string | null; kind: SfTreeCreateKind } | null>(null);

  readonly selectedIds: Signal<ReadonlySet<string>>;

  /** Whether the root level has been loaded. */
  readonly rootLoaded = computed(() => this.structure().children.has(null));

  readonly filter = computed<Filter | null>(() => {
    const query = this.query().trim().toLocaleLowerCase();
    if (!query) {
      return null;
    }
    const { nodes, parents } = this.structure();
    const paths = this.serverPaths();
    const matches = new Set<string>();
    const ancestors = new Set<string>();
    if (paths) {
      for (const path of paths) {
        if (path.length === 0) {
          continue;
        }
        matches.add(path[path.length - 1]);
        path.slice(0, -1).forEach((id) => ancestors.add(id));
      }
    } else {
      for (const node of nodes.values()) {
        if (node.label.toLocaleLowerCase().includes(query)) {
          matches.add(node.id);
          for (let parent = parents.get(node.id) ?? null; parent !== null; parent = parents.get(parent) ?? null) {
            if (ancestors.has(parent)) {
              break;
            }
            ancestors.add(parent);
          }
        }
      }
    }
    return { matches, ancestors, visible: new Set([...matches, ...ancestors]) };
  });

  /** The expansion in effect: the user's, or while filtering the auto-expanded ancestors of the matches. */
  readonly effectiveExpanded = computed<ReadonlySet<string>>(() => {
    const filter = this.filter();
    if (!filter) {
      return this.expanded();
    }
    const result = new Set(filter.ancestors);
    for (const [id, open] of this.filterOverrides()) {
      if (open) {
        result.add(id);
      } else {
        result.delete(id);
      }
    }
    return result;
  });

  /** The flattened, visible rows in display order. */
  readonly rows = computed<SfTreeRow<T>[]>(() => {
    const { nodes, children } = this.structure();
    const filter = this.filter();
    const expanded = this.effectiveExpanded();
    const loading = this.loading();
    const creating = this.creating();
    const rows: SfTreeRow<T>[] = [];
    const visit = (parentId: string | null, level: number): void => {
      if (creating && creating.parentId === parentId) {
        rows.push({ kind: 'create', id: SF_TREE_CREATE_ROW, level, parentId, createKind: creating.kind });
      }
      const loaded = children.get(parentId);
      if (!loaded) {
        if (parentId !== null && loading.has(parentId)) {
          rows.push({ kind: 'loading', id: `\u0000loading:${parentId}`, level, parentId });
        }
        return;
      }
      const ids = filter ? loaded.filter((id) => filter.visible.has(id)) : loaded;
      ids.forEach((id, index) => {
        const node = nodes.get(id);
        if (!node) {
          return;
        }
        const own = children.get(id);
        const expandable = own ? own.length > 0 : !!node.hasChildren;
        const isExpanded = expanded.has(id) && (expandable || creating?.parentId === id);
        rows.push({
          kind: 'node',
          id,
          node,
          level,
          setSize: ids.length,
          posInSet: index + 1,
          parentId,
          expandable,
          expanded: isExpanded,
          loading: loading.has(id),
          match: !!filter?.matches.has(id),
        });
        if (isExpanded) {
          visit(id, level + 1);
        }
      });
    };
    visit(null, 1);
    return rows;
  });

  /** The node rows only (what focus, selection ranges and type-ahead move over). */
  readonly nodeRows = computed(() => this.rows().filter((row): row is SfTreeNodeRow<T> => row.kind === 'node'));

  constructor(private readonly options: SfTreeModelOptions) {
    this.selectedIds = computed(() => new Set(options.selection()));
  }

  // ── Structure and loading ──────────────────────────────────────────────────

  node(id: string | null | undefined): SfTreeNode<T> | null {
    return id == null ? null : (this.structure().nodes.get(id) ?? null);
  }

  parentOf(id: string): string | null {
    return this.structure().parents.get(id) ?? null;
  }

  childrenOf(id: string | null): readonly string[] | undefined {
    return this.structure().children.get(id);
  }

  /** Whether `id` is `ancestor` or lies below it (over the loaded structure). */
  isSelfOrDescendant(id: string, ancestor: string): boolean {
    const parents = this.structure().parents;
    for (let current: string | null = id; current !== null; current = parents.get(current) ?? null) {
      if (current === ancestor) {
        return true;
      }
    }
    return false;
  }

  /** Root-to-node ids (the node included), over the loaded structure. */
  pathOf(id: string): string[] {
    const path: string[] = [];
    const parents = this.structure().parents;
    for (let current: string | null = id; current !== null; current = parents.get(current) ?? null) {
      path.unshift(current);
    }
    return path;
  }

  // ── Sibling order (reorderable trees) ──────────────────────────────────────

  /**
   * Where `nodeId` lands when dropped before or after `targetId`: among the target's siblings, at the index it has
   * after the move (over the loaded, unfiltered order). "After" an expanded folder with loaded children means its first
   * child: the row below it, where the drop line is drawn, is that child. `null` when nothing would change (next to
   * itself).
   */
  placement(nodeId: string, targetId: string, position: 'before' | 'after'): SfTreePlacement | null {
    if (nodeId === targetId || !this.node(targetId)) {
      return null;
    }
    if (position === 'after' && this.row(targetId)?.expanded && this.childrenOf(targetId)?.length) {
      return this.placeAt(nodeId, targetId, 0);
    }
    const parentId = this.parentOf(targetId);
    const target = (this.childrenOf(parentId) ?? []).indexOf(targetId);
    if (target < 0) {
      return null;
    }
    return this.placeAt(nodeId, parentId, position === 'before' ? target : target + 1);
  }

  /** `nodeId` inserted among the children of `parentId` at `insertion` (counted with the node still in place). */
  private placeAt(nodeId: string, parentId: string | null, insertion: number): SfTreePlacement | null {
    const siblings = this.childrenOf(parentId) ?? [];
    const from = this.node(nodeId) && this.parentOf(nodeId) === parentId ? siblings.indexOf(nodeId) : -1;
    if (from < 0) {
      return { parentId, index: insertion };
    }
    const index = insertion > from ? insertion - 1 : insertion;
    return index === from ? null : { parentId, index };
  }

  /** `Alt+↑/↓`: the node's position `delta` places along its siblings; `null` at the ends. */
  siblingStep(nodeId: string, delta: number): SfTreePlacement | null {
    const parentId = this.parentOf(nodeId);
    const siblings = this.childrenOf(parentId) ?? [];
    const from = siblings.indexOf(nodeId);
    const index = from + delta;
    return from < 0 || index < 0 || index >= siblings.length ? null : { parentId, index };
  }

  /** Replaces the data source: forgets the loaded structure (not the expansion) and loads the root. */
  setLoader(loader: SfTreeLoader<T>): Promise<void> {
    this.loader = loader;
    this.cancelAll();
    this.generation++;
    this.structure.set({ nodes: new Map(), children: new Map(), parents: new Map() });
    return this.load(null);
  }

  /**
   * Loads (or reloads) the children of `parentId`. Expanded children whose own children aren't loaded yet are loaded
   * next, so a restored expansion opens level by level. Resolves when this level is in.
   */
  load(parentId: string | null): Promise<void> {
    const loader = this.loader;
    if (!loader) {
      return Promise.resolve();
    }
    // A superseded load is unsubscribed; whoever awaits it continues when this one is done.
    const previous = this.inFlight.get(parentId);
    previous?.sub.unsubscribe();
    this.inFlight.delete(parentId);
    const parent = parentId === null ? null : this.node(parentId);
    if (parentId !== null && !parent) {
      this.setLoading(parentId, false);
      previous?.resolve();
      return Promise.resolve();
    }
    const generation = this.generation;
    this.setLoading(parentId, true);
    this.setFailed(parentId, false);
    let source: Observable<readonly SfTreeNode<T>[]>;
    try {
      const result = loader(parent);
      source = isObservable(result)
        ? result.pipe(take(1))
        : Array.isArray(result)
          ? of(result as readonly SfTreeNode<T>[])
          : from(Promise.resolve(result));
    } catch (error) {
      source = new Observable((subscriber) => subscriber.error(error));
    }
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    if (previous) {
      void done.then(previous.resolve);
    }
    let finished = false;
    const finish = () => {
      finished = true;
      if (this.inFlight.get(parentId)?.done === done) {
        this.inFlight.delete(parentId);
      }
      this.setLoading(parentId, false);
      resolve();
    };
    const sub = source.subscribe({
      next: (nodes) => {
        if (generation === this.generation) {
          this.setChildren(parentId, nodes);
        }
      },
      error: (error) => {
        finish();
        if (generation === this.generation) {
          this.setFailed(parentId, true);
          if (parentId !== null) {
            // Shown collapsed again, so it doesn't claim children it hasn't got; expanding retries.
            this.collapse(parentId);
          }
          this.options.onError?.(error, parentId);
        }
      },
      complete: () => {
        if (!finished) {
          finish();
          if (generation === this.generation) {
            this.loadExpandedBelow(parentId);
          }
        }
      },
    });
    if (!finished) {
      this.inFlight.set(parentId, { sub, done, resolve });
    }
    return done;
  }

  /** Loads `parentId`'s children unless they are loaded or loading; resolves when they are in. */
  ensureLoaded(parentId: string | null): Promise<void> {
    if (this.structure().children.has(parentId)) {
      return Promise.resolve();
    }
    return this.inFlight.get(parentId)?.done ?? this.load(parentId);
  }

  /** Loads the nodes along root-to-node id paths, level by level (server filter, reveal). */
  async loadPaths(paths: readonly (readonly string[])[]): Promise<void> {
    await this.ensureLoaded(null);
    await Promise.all(
      paths.map(async (path) => {
        for (const id of path.slice(0, -1)) {
          if (!this.node(id)) {
            return;
          }
          await this.ensureLoaded(id);
        }
      }),
    );
  }

  /** Unsubscribes every pending load (destroy, new data source); their awaiters continue at once. */
  cancelAll(): void {
    for (const { sub, resolve } of this.inFlight.values()) {
      sub.unsubscribe();
      resolve();
    }
    this.inFlight.clear();
    this.loading.set(new Set());
  }

  private setFailed(id: string | null, failed: boolean): void {
    this.failed.update((set) => {
      if (set.has(id) === failed) {
        return set;
      }
      const next = new Set(set);
      if (failed) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private setLoading(id: string | null, loading: boolean): void {
    this.loading.update((set) => {
      if (set.has(id) === loading) {
        return set;
      }
      const next = new Set(set);
      if (loading) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /** Puts a level in: replaced children keep their own loaded subtrees; removed ones are dropped with theirs. */
  private setChildren(parentId: string | null, loaded: readonly SfTreeNode<T>[]): void {
    const list = [...loaded];
    if (this.options.sort() === 'name') {
      list.sort((a, b) => COLLATOR.compare(a.label, b.label));
    }
    this.structure.update(({ nodes, children, parents }) => {
      const nextNodes = new Map(nodes);
      const nextChildren = new Map(children);
      const nextParents = new Map(parents);
      const keep = new Set(list.map((node) => node.id));
      const drop = (id: string): void => {
        for (const child of nextChildren.get(id) ?? []) {
          drop(child);
        }
        nextChildren.delete(id);
        nextNodes.delete(id);
        nextParents.delete(id);
      };
      for (const old of children.get(parentId) ?? []) {
        if (!keep.has(old)) {
          drop(old);
        }
      }
      for (const node of list) {
        // A node that moved here from elsewhere leaves its old parent's list.
        const previousParent = nextParents.get(node.id);
        if (previousParent !== undefined && previousParent !== parentId) {
          const siblings = nextChildren.get(previousParent);
          if (siblings) {
            nextChildren.set(
              previousParent,
              siblings.filter((id) => id !== node.id),
            );
          }
        }
        nextNodes.set(node.id, node);
        nextParents.set(node.id, parentId);
      }
      nextChildren.set(
        parentId,
        list.map((node) => node.id),
      );
      return { nodes: nextNodes, children: nextChildren, parents: nextParents };
    });
  }

  /** Loads the children of every expanded, loaded node under `parentId` that has none loaded yet. */
  private loadExpandedBelow(parentId: string | null): void {
    const expanded = this.effectiveExpanded();
    for (const id of this.structure().children.get(parentId) ?? []) {
      const node = this.node(id);
      if (node?.hasChildren && expanded.has(id) && !this.structure().children.has(id) && !this.inFlight.has(id)) {
        void this.load(id);
      }
    }
  }

  // ── Expansion ──────────────────────────────────────────────────────────────

  isExpanded(id: string): boolean {
    return this.effectiveExpanded().has(id);
  }

  /** Expands a node, loading its children on first expansion. Resolves when they are in. */
  expand(id: string): Promise<void> {
    if (this.filter()) {
      this.setOverride(id, true);
    } else if (!this.expanded().has(id)) {
      this.expanded.update((set) => new Set(set).add(id));
    }
    const node = this.node(id);
    return node?.hasChildren ? this.ensureLoaded(id) : Promise.resolve();
  }

  collapse(id: string): void {
    if (this.filter()) {
      this.setOverride(id, false);
      return;
    }
    if (this.expanded().has(id)) {
      this.expanded.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * The expansion worth saving: expanded nodes whose ancestors are all expanded (collapsed-away and deleted ids are
   * dropped). Ids not loaded yet are kept while some reachable expanded branch is still unloaded — they may lie below.
   */
  persistableExpansion(): string[] {
    const { nodes, children } = this.structure();
    const expanded = this.expanded();
    const result: string[] = [];
    let complete = children.has(null);
    const visit = (parentId: string | null): void => {
      for (const id of children.get(parentId) ?? []) {
        if (!expanded.has(id)) {
          continue;
        }
        result.push(id);
        if (children.has(id)) {
          visit(id);
        } else if (nodes.get(id)?.hasChildren) {
          complete = false;
        }
      }
    };
    visit(null);
    if (!complete) {
      result.push(...[...expanded].filter((id) => !nodes.has(id)));
    }
    return result;
  }

  /** Replaces the expansion (a restored preference) and loads the expanded branches that are reachable. */
  restoreExpansion(ids: readonly string[]): void {
    this.expanded.set(new Set(ids));
    const children = this.structure().children;
    for (const parent of children.keys()) {
      this.loadExpandedBelow(parent);
    }
  }

  /** Expands every expandable loaded node, loading their children level by level (so: the whole tree). */
  async expandAll(): Promise<void> {
    const queue: (string | null)[] = [null];
    while (queue.length) {
      const level = queue.splice(0);
      await Promise.all(level.map((id) => (id === null ? this.ensureLoaded(null) : this.expand(id))));
      for (const id of level) {
        for (const child of this.structure().children.get(id) ?? []) {
          const node = this.node(child);
          const own = this.structure().children.get(child);
          if (own ? own.length > 0 : node?.hasChildren) {
            queue.push(child);
          }
        }
      }
    }
  }

  collapseAll(): void {
    if (this.filter()) {
      this.filterOverrides.set(new Map([...this.effectiveExpanded()].map((id) => [id, false])));
      return;
    }
    this.expanded.set(new Set());
  }

  /** `*`: expands every sibling of a node. */
  expandSiblings(id: string): Promise<void> {
    const siblings = this.structure().children.get(this.parentOf(id)) ?? [];
    return Promise.all(
      siblings.filter((sibling) => this.node(sibling)?.hasChildren).map((sibling) => this.expand(sibling)),
    ).then(() => undefined);
  }

  private setOverride(id: string, open: boolean): void {
    this.filterOverrides.update((map) => new Map(map).set(id, open));
  }

  /** Sets the filter text; a changed query resets the expansion overrides made while filtering. */
  setQuery(query: string): void {
    if (query.trim() !== this.query().trim()) {
      this.filterOverrides.set(new Map());
      this.serverPaths.set(null);
    }
    this.query.set(query);
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  selectOnly(id: string): void {
    this.anchor = id;
    this.options.selection.set([id]);
  }

  /** Anchors range selection on `id` unless a visible anchor exists (Shift+arrow from a row never clicked). */
  ensureAnchor(id: string): void {
    if (this.anchor === null || !this.nodeRows().some((row) => row.id === this.anchor)) {
      this.anchor = id;
    }
  }

  toggle(id: string): void {
    this.anchor = id;
    const current = this.options.selection();
    this.options.selection.set(current.includes(id) ? current.filter((s) => s !== id) : [...current, id]);
  }

  /** Selects the visible nodes from the anchor to `id`; `additive` keeps the rest of the selection (Ctrl+Shift). */
  selectRange(id: string, additive = false): void {
    const rows = this.nodeRows();
    const anchor = this.anchor !== null && rows.some((row) => row.id === this.anchor) ? this.anchor : id;
    const from = rows.findIndex((row) => row.id === anchor);
    const to = rows.findIndex((row) => row.id === id);
    if (to < 0) {
      return;
    }
    const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id);
    const base = additive ? this.options.selection().filter((s) => !range.includes(s)) : [];
    this.anchor = anchor;
    this.options.selection.set([...base, ...range]);
  }

  selectAll(): void {
    this.options.selection.set(this.nodeRows().map((row) => row.id));
  }

  /** The nodes an action on `id` applies to: the selection when `id` is part of it, else just `id`. */
  targetsOf(id: string): SfTreeNode<T>[] {
    const ids = this.isSelected(id) ? this.nodeRows().filter((row) => this.isSelected(row.id)).map((r) => r.id) : [id];
    return ids.map((target) => this.node(target)).filter((node): node is SfTreeNode<T> => !!node);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  indexOf(id: string | null): number {
    return id === null ? -1 : this.rows().findIndex((row) => row.id === id);
  }

  /** The node row `delta` rows from `id` (clamped). */
  step(id: string | null, delta: number): SfTreeNodeRow<T> | null {
    const rows = this.nodeRows();
    if (rows.length === 0) {
      return null;
    }
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) {
      return rows[0];
    }
    return rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
  }

  first(): SfTreeNodeRow<T> | null {
    return this.nodeRows()[0] ?? null;
  }

  last(): SfTreeNodeRow<T> | null {
    const rows = this.nodeRows();
    return rows[rows.length - 1] ?? null;
  }

  row(id: string | null): SfTreeNodeRow<T> | null {
    return id === null ? null : (this.nodeRows().find((row) => row.id === id) ?? null);
  }

  /**
   * Type-ahead: the next visible node (after `from`, wrapping) whose name starts with the typed text. Keys within
   * {@link TYPEAHEAD_MS} extend the text; repeating one letter cycles through the nodes starting with it.
   */
  typeahead(char: string, from: string | null, now = Date.now()): SfTreeNodeRow<T> | null {
    this.typed = now - this.typedAt > TYPEAHEAD_MS ? char : this.typed + char;
    this.typedAt = now;
    const lower = this.typed.toLocaleLowerCase();
    const repeated = lower.length > 1 && [...lower].every((c) => c === lower[0]);
    const prefix = repeated ? lower[0] : lower;
    const rows = this.nodeRows();
    const start = rows.findIndex((row) => row.id === from);
    // A fresh search starts after the focused node; a longer prefix may still match the focused one.
    const offset = lower.length > 1 && !repeated ? 0 : 1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[(start + offset + i + rows.length) % rows.length];
      if (row.node.label.toLocaleLowerCase().startsWith(prefix)) {
        return row;
      }
    }
    return null;
  }
}

/** Splits a label around the first case-insensitive occurrence of `query`, for highlighting. */
export function highlightSegments(label: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLocaleLowerCase();
  const index = needle ? label.toLocaleLowerCase().indexOf(needle) : -1;
  if (index < 0) {
    return [{ text: label, match: false }];
  }
  return [
    { text: label.slice(0, index), match: false },
    { text: label.slice(index, index + needle.length), match: true },
    { text: label.slice(index + needle.length), match: false },
  ].filter((segment) => segment.text.length > 0);
}
