import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { HashMap, TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDataTableBulkAction, SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../../shared/components/forms/sf-radio-group.component';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../../shared/components/layout/sf-section.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../../shared/components/sf-empty-state.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import {
  SfTreeAction,
  SfTreeComponent,
  SfTreeDeleteRequest,
  SfTreeMoveRequest,
  SfTreeRenameRequest,
  SfTreeReorderRequest,
} from '../../../../shared/components/sf-tree.component';
import { SfSplitterComponent } from '../../../../shared/components/splitter/sf-splitter.component';
import { SfTreeLoader, SfTreeNode } from '../../../../shared/components/tree/tree-model';
import type { ContextMenuItem } from '../../../../shared/services/context-menu.service';
import { SampleEntry, SampleLang } from '../sample-data';
import { STATUS_ICONS, STATUS_TONES, SampleState } from '../sample-state';
import {
  SampleNavEntry,
  ROOT_ID,
  SampleNavOrder,
  initialNavEntries,
  initialNavOrder,
  pageById,
  pageUuid,
} from './navigation-data';
import { SamplePagePickerComponent } from './sample-page-picker.component';

/** A row of a menu folder's table. */
interface NavRow {
  readonly entry: SampleNavEntry;
  readonly target: SampleEntry | null;
  readonly url: string | null;
  readonly isEntryPage: boolean;
}

const TREE_WIDTH = 300;
const TREE_WIDTH_NARROW = 260;
const WIDE_QUERY = '(min-width: 1280px)';

/** Sets (or, with `null`, removes) query parameters in place, keeping the others (the screen owns those). */
function replaceQuery(location: Location, values: Readonly<Record<string, string | null>>): void {
  const [path, query = ''] = location.path().split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  location.replaceState(path, params.toString());
}

/**
 * The sample's Navigation area (M35.9 decision 24, M35.22): the menu tree in navigation order — each entry with the
 * public URL it leads to ("Company → /about/our-story"), reorderable among its siblings by drag and `Alt+↑/↓`
 * (decision 23) and movable into folders, both with Undo — next to the detail of the selection: a menu folder's table
 * of items with its entry page, or a menu item's form with the target page as a picker card and the restyled page
 * picker. Developer mode adds UIDs and the target's UUID (decision 19). Changes live in memory only.
 *
 * Query parameters (read on load, kept in sync in place): `nav=<entry id>` selects a folder or item, `navpicker=1`
 * opens the page picker of the selected item. Developer mode is the sample's {@link SampleState} `devMode`, or the
 * `dev=1` query parameter when the area is used without the sample screen.
 */
@Component({
  selector: 'sf-sample-navigation-area',
  standalone: true,
  imports: [
    SamplePagePickerComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfEmptyStateComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfRadioGroupComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfSplitterComponent,
    SfStatusComponent,
    SfSwitchComponent,
    SfTreeComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-navigation-area.component.html',
  styleUrls: ['../sample-tree-pane.scss', './sample-navigation-area.component.scss'],
})
export class SampleNavigationAreaComponent {
  private readonly sample = inject(SampleState, { optional: true });
  private readonly location = inject(Location);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
  private readonly translation = toSignal(this.transloco.selectTranslation(), { initialValue: null });
  private readonly tree = viewChild.required<SfTreeComponent<SampleNavEntry>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move'];
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;

  /** Developer mode: the sample's switch, else the `dev` query parameter. */
  protected readonly devMode = computed(() => this.sample?.devMode() ?? this.devParam);
  protected readonly lang = computed<SampleLang>(() => this.sample?.lang() ?? 'en');

  // ── The menu (in memory) ───────────────────────────────────────────────────
  private readonly entries = signal(initialNavEntries());
  private readonly order = signal<SampleNavOrder>(initialNavOrder());
  protected readonly selectedId = signal<string | null>(null);
  protected readonly pickerOpen = signal(false);
  private readonly devParam: boolean;
  private created = 0;

  protected readonly selected = computed(() => this.entryOf(this.selectedId()));
  protected readonly isRoot = computed(() => this.selectedId() === ROOT_ID);
  protected readonly entryDrawerOpen = signal(false);
  /** The choice in the entry-page drawer before Apply: `''` for none. */
  protected readonly entryDraft = signal('');
  protected readonly selectedItem = computed(() => {
    const entry = this.selected();
    return entry?.kind === 'item' ? entry : null;
  });
  protected readonly treeSelection = computed(() => {
    const id = this.selectedId();
    return id === null || id === ROOT_ID ? [] : [id];
  });

  /** Each entry with the public URL it leads to and, in developer mode, its UID; hidden ones marked. */
  protected readonly loader = computed<SfTreeLoader<SampleNavEntry>>(() => {
    const dev = this.devMode();
    const hidden = this.t('hidden');
    // Read at load time: a reorder or move refreshes the affected parents.
    return (parent) => untracked(() => this.childrenOf(parent?.id ?? null).map((entry) => this.toNode(entry, dev, hidden)));
  });

  /** The tree's context menu: *Entry page…* on a folder, *Hide from menu* / *Show in menu* on any entry. */
  protected readonly treeMenu = (nodes: readonly SfTreeNode<SampleNavEntry>[]): ContextMenuItem[] => {
    const entry = nodes.length === 1 ? nodes[0].data : null;
    if (!entry) {
      return [];
    }
    const items: ContextMenuItem[] = [];
    if (entry.kind === 'folder') {
      items.push({ label: this.t('actions.entry'), icon: 'login', action: () => this.openEntryDrawer(entry.id) });
    }
    items.push(
      entry.visible
        ? { label: this.t('actions.hide'), icon: 'visibility_off', action: () => this.setVisibility([entry.id], false) }
        : { label: this.t('actions.show'), icon: 'visibility', action: () => this.setVisibility([entry.id], true) },
    );
    return items;
  };

  protected readonly newItems = computed<SfMenuItem[]>(() => [
    { id: 'item', label: this.t('newItem'), icon: 'add_link', action: () => this.create('item') },
    { id: 'folder', label: this.t('newFolder'), icon: 'create_new_folder', action: () => this.create('folder') },
  ]);

  // ── Folder view ────────────────────────────────────────────────────────────
  protected readonly rows = computed<NavRow[]>(() => {
    const folder = this.selected();
    if (folder?.kind !== 'folder') {
      return [];
    }
    const entryId = this.entryPageOf(folder);
    return this.childrenOf(folder.id).map((entry) => {
      const target = this.targetOf(entry);
      return { entry, target, url: target?.url ?? null, isEntryPage: entry.id === entryId };
    });
  });
  protected readonly rowKey = (row: NavRow) => row.entry.id;
  protected readonly rowLabel = (row: NavRow) => row.entry.label;
  protected readonly columns = computed<SfDataTableColumn<NavRow>[]>(() => [
    { id: 'label', header: this.t('columns.label'), value: (r) => r.entry.label, hideable: false, width: 220 },
    { id: 'target', header: this.t('columns.target'), value: (r) => r.target?.name ?? '', width: 200 },
    { id: 'url', header: this.t('columns.url'), value: (r) => r.url ?? '', width: 220 },
    { id: 'visible', header: this.t('columns.visible'), value: (r) => (r.entry.visible ? 1 : 0), sortable: true, width: 170 },
  ]);
  /** The bulk actions of the table's selection (decision 168). */
  protected readonly bulkActions = computed<SfDataTableBulkAction<NavRow>[]>(() => [
    { id: 'show', label: this.t('bulk.show'), icon: 'visibility', action: (selection) => this.setVisibility(selection.rows.map((r) => r.entry.id), true) },
    { id: 'hide', label: this.t('bulk.hide'), icon: 'visibility_off', action: (selection) => this.setVisibility(selection.rows.map((r) => r.entry.id), false) },
  ]);
  /** The folder's entry page: the line in its header and the drawer's choices (decision 169). */
  protected readonly entryPage = computed(() => {
    const folder = this.selected();
    return folder?.kind === 'folder' ? this.entryPageOf(folder) : null;
  });
  protected readonly entryPageEntry = computed(() => this.entryOf(this.entryPage()));
  protected readonly entryTarget = computed(() => this.targetOf(this.entryOf(this.selectedId()))?.name ?? null);
  protected readonly folderUrl = computed(() => this.targetOf(this.entryOf(this.entryPage()))?.url ?? null);
  protected readonly entryOptions = computed<SfRadioOption<string>[]>(() => {
    const folder = this.selected();
    if (folder?.kind !== 'folder') {
      return [];
    }
    return [
      { value: '', label: this.t('entry.none'), description: this.t('entry.noneHint') },
      ...this.childrenOf(folder.id).map((child) => {
        const url = this.targetOf(child)?.url;
        const kind = this.t(child.kind === 'item' ? 'entry.kindItem' : 'entry.kindFolder');
        return {
          value: child.id,
          label: child.label,
          description: url ? this.t('entry.leadsTo', { kind, where: url }) : this.t('entry.leadsNowhere', { kind }),
        };
      }),
    ];
  });

  protected readonly folderActions = computed<SfMenuItem[]>(() => {
    const folder = this.selected();
    const entry: SfMenuItem = { id: 'entry', label: this.t('actions.entry'), icon: 'login' };
    if (!folder || folder.id === ROOT_ID) {
      return [entry];
    }
    return [
      entry,
      { id: 'rename', label: this.t('actions.rename'), icon: 'edit', shortcut: 'F2', separatorBefore: true },
      folder.visible
        ? { id: 'hide', label: this.t('actions.hide'), icon: 'visibility_off' }
        : { id: 'show', label: this.t('actions.show'), icon: 'visibility' },
      { id: 'delete', label: this.t('actions.delete'), icon: 'delete', danger: true, separatorBefore: true },
    ];
  });
  protected readonly itemActions = computed<SfMenuItem[]>(() => [
    { id: 'duplicate', label: this.t('actions.duplicate'), icon: 'content_copy' },
    { id: 'delete', label: this.t('actions.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  // ── Item view ──────────────────────────────────────────────────────────────
  protected readonly target = computed(() => this.targetOf(this.selectedItem()));
  protected readonly targetUuid = computed(() => {
    const target = this.target();
    return target ? pageUuid(target.id) : null;
  });

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    this.devParam = params.get('dev') === '1';
    const nav = params.get('nav');
    if (nav && this.entries().has(nav)) {
      this.selectedId.set(nav);
      this.pickerOpen.set(params.get('navpicker') === '1' && this.entries().get(nav)?.kind === 'item');
    }

    effect(() => {
      const nav = this.selectedId();
      const picker = this.pickerOpen();
      untracked(() => replaceQuery(this.location, { nav, navpicker: picker ? '1' : null }));
    });

    // Keep the selection visible: its folder expanded (a folder itself too).
    afterNextRender(() => void this.reveal());
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  protected urlOf(entry: SampleNavEntry): string | null {
    return this.targetOf(entry)?.url ?? null;
  }

  protected statusOf(page: SampleEntry) {
    return page.status[this.lang()];
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  /** The tree title: the "All navigation" wrapper with the menu's own entry page. */
  protected openRoot(): void {
    this.select(ROOT_ID);
  }

  protected select(id: string | null): void {
    this.pickerOpen.set(false);
    this.selectedId.set(id);
  }

  protected onOpen(node: SfTreeNode<SampleNavEntry>): void {
    this.select(node.id);
  }

  protected openRow(row: NavRow): void {
    this.select(row.entry.id);
    void this.reveal();
  }

  // ── Tree requests (in memory, with Undo) ───────────────────────────────────

  protected onReorder(request: SfTreeReorderRequest<SampleNavEntry>): void {
    const parentId = request.parent?.id ?? null;
    const undo = this.changeOrder((order) => {
      detach(order, request.node.id);
      const list = order.get(parentId) ?? [];
      list.splice(Math.min(request.index, list.length), 0, request.node.id);
      order.set(parentId, list);
    });
    request.completed(undo);
  }

  protected onMove(request: SfTreeMoveRequest<SampleNavEntry>): void {
    const parentId = request.target?.id ?? null;
    const undo = this.changeOrder((order) => {
      for (const node of request.nodes) {
        detach(order, node.id);
      }
      order.set(parentId, [...(order.get(parentId) ?? []), ...request.nodes.map((node) => node.id)]);
    });
    request.completed(undo);
  }

  protected onDelete(request: SfTreeDeleteRequest<SampleNavEntry>): void {
    request.completed(this.remove(request.nodes.map((node) => node.id)));
  }

  protected onRename(request: SfTreeRenameRequest<SampleNavEntry>): void {
    this.update(request.node.id, { label: request.name });
  }

  // ── Detail actions ─────────────────────────────────────────────────────────

  protected setLabel(id: string, label: string): void {
    this.update(id, { label });
  }

  protected setVisible(id: string, visible: boolean): void {
    this.update(id, { visible });
  }

  protected setEntryPage(folderId: string, entryId: string | null): void {
    this.update(folderId, { entryId });
  }

  /** *Entry page…*: the drawer starts on the folder's current entry page. */
  protected openEntryDrawer(folderId: string): void {
    this.select(folderId);
    this.entryDraft.set(this.entryOf(folderId)?.entryId ?? '');
    this.entryDrawerOpen.set(true);
  }

  protected applyEntry(): void {
    const folder = this.selected();
    if (!folder) {
      return;
    }
    const before = folder.entryId;
    const next = this.entryDraft() || null;
    this.entryDrawerOpen.set(false);
    if (next === before) {
      return;
    }
    this.setEntryPage(folder.id, next);
    const name = this.entryOf(next)?.label ?? '';
    this.toasts.undo(this.t(next ? 'entryToast' : 'entryClearedToast', { name }), () => this.setEntryPage(folder.id, before));
  }

  /** *Show in menu* / *Hide from menu* on entries (the table's selection, a folder's ⋮ menu, the tree's menu), with Undo. */
  protected setVisibility(ids: readonly string[], visible: boolean): void {
    const changed = ids.map((id) => this.entryOf(id)).filter((e): e is SampleNavEntry => !!e && e.visible !== visible && e.id !== ROOT_ID);
    if (changed.length === 0) {
      return;
    }
    changed.forEach((entry) => this.update(entry.id, { visible }));
    this.toasts.undo(this.t(visible ? 'shownToast' : 'hiddenToast', { count: changed.length, name: changed[0].label }), () =>
      changed.forEach((entry) => this.update(entry.id, { visible: !visible })),
    );
  }

  protected setTarget(itemId: string, pageId: string): void {
    this.pickerOpen.set(false);
    this.update(itemId, { targetId: pageId });
    const page = pageById(pageId);
    if (page) {
      this.toasts.show(this.t('targetChanged', { name: page.name }), 'success');
    }
  }

  protected openTarget(page: SampleEntry): void {
    this.toasts.show(this.t('openNotice', { url: page.url }), 'info');
  }

  protected onAction(item: SfMenuItem): void {
    const entry = this.selected();
    if (entry && item.id === 'entry') {
      this.openEntryDrawer(entry.id);
    } else if (entry && (item.id === 'hide' || item.id === 'show')) {
      this.setVisibility([entry.id], item.id === 'show');
    } else if (entry && item.id === 'delete') {
      const undo = this.remove([entry.id]);
      this.toasts.undo(this.t('deleted', { name: entry.label }), undo);
    } else {
      this.toasts.show(this.t('notice'), 'info');
    }
  }

  /** A new item or folder in the selected folder (or next to the selected item), selected at once. */
  protected create(kind: 'item' | 'folder', parentId: string | null = this.creationParent()): void {
    const id = `n-new-${++this.created}`;
    const entry: SampleNavEntry = {
      id,
      kind,
      label: this.t(kind === 'item' ? 'newItemName' : 'newFolderName'),
      uid: `nav_new_${this.created}`,
      visible: true,
      targetId: null,
      entryId: null,
    };
    this.entries.update((all) => new Map(all).set(id, entry));
    this.changeOrder((order) => order.set(parentId, [...(order.get(parentId) ?? []), id]));
    this.select(id);
    void this.reveal();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private entryOf(id: string | null | undefined): SampleNavEntry | null {
    return id ? (this.entries().get(id) ?? null) : null;
  }

  private childrenOf(parentId: string | null): SampleNavEntry[] {
    return (this.order().get(parentId === ROOT_ID ? null : parentId) ?? []).map((id) => this.entryOf(id)).filter((e): e is SampleNavEntry => !!e);
  }

  private parentOf(id: string): string | null {
    for (const [parent, ids] of this.order()) {
      if (ids.includes(id)) {
        return parent;
      }
    }
    return null;
  }

  /** A folder's entry page while it is still one of its items. */
  private entryPageOf(folder: SampleNavEntry): string | null {
    return folder.entryId && (this.order().get(folder.id === ROOT_ID ? null : folder.id) ?? []).includes(folder.entryId) ? folder.entryId : null;
  }

  /** The page an entry leads to: an item's target, a folder's entry page's target. */
  private targetOf(entry: SampleNavEntry | null): SampleEntry | null {
    if (!entry) {
      return null;
    }
    if (entry.kind === 'item') {
      return pageById(entry.targetId);
    }
    const entryPage = this.entryPageOf(entry);
    return entryPage && entryPage !== entry.id ? this.targetOf(this.entryOf(entryPage)) : null;
  }

  private toNode(entry: SampleNavEntry, dev: boolean, hidden: string): SfTreeNode<SampleNavEntry> {
    const url = this.urlOf(entry);
    const secondary = [url ? `→ ${url}` : null, dev ? entry.uid : null].filter(Boolean).join('  ·  ');
    const isFolder = entry.kind === 'folder';
    return {
      id: entry.id,
      label: entry.label,
      icon: isFolder ? 'folder' : 'link',
      secondary: secondary || null,
      badges: entry.visible ? [] : [{ label: hidden, tone: 'neutral', icon: 'visibility_off' }],
      muted: !entry.visible,
      hasChildren: isFolder && (this.order().get(entry.id)?.length ?? 0) > 0,
      droppable: isFolder,
      data: entry,
    };
  }

  private creationParent(): string | null {
    const entry = this.selected();
    if (!entry) {
      return null;
    }
    return entry.kind === 'folder' ? entry.id : this.parentOf(entry.id);
  }

  /** Changes an entry and refreshes its row (label, URL and badges show in the tree). */
  private update(id: string, patch: Partial<SampleNavEntry>): void {
    const entry = this.entryOf(id);
    if (!entry) {
      return;
    }
    this.entries.update((all) => new Map(all).set(id, { ...entry, ...patch }));
    // Its own row, and a folder whose entry page it may be.
    const parent = this.parentOf(id);
    void this.tree().refresh(parent);
    if (parent !== null) {
      void this.tree().refresh(this.parentOf(parent));
    }
  }

  /** Takes entries out of the menu; returns their undo. */
  private remove(ids: readonly string[]): () => void {
    if (ids.includes(this.selectedId() ?? '')) {
      this.select(null);
    }
    return this.changeOrder((order) => ids.forEach((id) => detach(order, id)));
  }

  /** Applies an order change and refreshes the parents it touched; returns the undo (which does the same). */
  private changeOrder(mutate: (order: Map<string | null, string[]>) => void): () => void {
    const before = this.order();
    const next = new Map([...before].map(([parent, ids]) => [parent, [...ids]]));
    mutate(next);
    this.applyOrder(before, next);
    return () => this.applyOrder(this.order(), before);
  }

  private applyOrder(from: SampleNavOrder, to: SampleNavOrder): void {
    this.order.set(to);
    const changed = [...new Set([...from.keys(), ...to.keys()])].filter(
      (parent) => (from.get(parent) ?? []).join() !== (to.get(parent) ?? []).join(),
    );
    // Parents that gained entries first, so a moved node keeps its loaded subtree.
    changed.sort((a, b) => gained(from, to, b) - gained(from, to, a));
    for (const parent of changed) {
      void this.tree().refresh(parent);
    }
  }

  private async reveal(): Promise<void> {
    const id = this.selectedId();
    if (id === null || id === ROOT_ID) {
      return;
    }
    const path: string[] = [];
    for (let current = this.parentOf(id); current !== null; current = this.parentOf(current)) {
      path.unshift(current);
    }
    if (this.entryOf(id)?.kind === 'folder') {
      path.push(id);
    }
    for (const folder of path) {
      await this.tree().expand(folder);
    }
  }

  /** A `styleguide.sample.navigation.*` text; inside a `computed` it tracks the language file. */
  protected t(key: string, params?: HashMap): string {
    this.translation();
    return this.transloco.translate(`styleguide.sample.navigation.${key}`, params);
  }
}

function detach(order: Map<string | null, string[]>, id: string): void {
  for (const [parent, ids] of order) {
    if (ids.includes(id)) {
      order.set(
        parent,
        ids.filter((other) => other !== id),
      );
    }
  }
}

function gained(from: SampleNavOrder, to: SampleNavOrder, parent: string | null): number {
  return (to.get(parent)?.length ?? 0) - (from.get(parent)?.length ?? 0);
}
