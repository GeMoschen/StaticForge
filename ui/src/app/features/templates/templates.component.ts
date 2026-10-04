import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter, map, tap } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ApiClient } from '../../core/api/api.client';
import { FAVORITES_NODE, FavoriteTreeService, isFavoriteNode } from '../../core/assets/favorite-tree.service';
import { FavoritesService } from '../../core/assets/favorites.service';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import { DialogService } from '../../shared/components/dialog/dialog.service';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfRenameAssetDialogComponent } from '../../shared/components/sf-rename-asset-dialog.component';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import {
  type SfTreeAction,
  SfTreeComponent,
  type SfTreeCreateRequest,
  type SfTreeDeleteRequest,
  type SfTreeMoveRequest,
  type SfTreeNameContext,
} from '../../shared/components/sf-tree.component';
import type { SfTreeLoader, SfTreeNode } from '../../shared/components/tree/tree-model';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { findFolderByUid } from './templates.util';
import { RecordSidePanelComponent, type RecordSidePanelTab } from '../content/record-side-panel.component';
import { FavoritesViewComponent } from '../favorites/favorites-view.component';
import {
  NewTemplateDialogComponent,
  type NewTemplateData,
  type NewTemplateKind,
  type NewTemplateResult,
} from './new-template-dialog.component';
import { TemplatesEditing } from './templates-editing';
import { TemplatesFolderViewComponent, favoriteTypeOf } from './templates-folder-view.component';
import { TemplatesItemActions } from './templates-item-actions.service';
import { TemplatesLoader } from './templates-loader';
import { TemplatesMoveDialogComponent } from './templates-move-dialog.component';
import { TemplatesSaveCoordinator } from './templates-save.coordinator';
import { TemplatesStoreRefresh } from './templates-store-refresh.service';
import {
  EMPTY_TEMPLATES_INDEX,
  type TemplateEntry,
  TEMPLATE_ICONS,
  assetKindOf,
  buildTemplatesIndex,
  childEntries,
  childNodes,
  folderChain,
  folderTrail,
  idPath,
  searchPaths,
  templateUuidFromUrl,
} from './templates-tree.util';
import { TemplatesStore } from './templates.store';
import { DATASETS_ROOT_UID } from './types';

type UsageDto = components['schemas']['UsageDto'];

const TREE_WIDTH = 280;
const TREE_WIDTH_NARROW = 240;
const WIDE_QUERY = '(min-width: 1280px)';

/** The kinds a *New* menu lists, in order. */
const NEW_KINDS: readonly NewTemplateKind[] = ['page', 'section', 'dataset'];

/**
 * The Templates area (M35.21): the tree on the left (`sf-tree`: folders, page templates, section templates and datasets,
 * with a filter and a pinned *Favorites* node), and in the main pane the open template or dataset (the child route
 * `/templates/:uuid`, with the unsaved-changes guard), the open folder's table (`?folder=`), or the Favorites list.
 *
 * <p>The tree menu is the one of gate decision 157: a template has *Duplicate*, *Rename…*, *Move to…*, *Used by*,
 * *Add to favorites* and *Delete*; a folder has *New ▸ (Page template, Section template, Dataset, Folder)*, *Rename…*,
 * *Move to…*, *Add to favorites* and *Delete*. The kind of a new item is always chosen explicitly (the New template
 * dialog). Every create, rename, move and delete control is disabled in time travel and for non-developers; each change
 * offers one Undo (M35.13), and the tree and the folder table read the store again when anything changed
 * (`TemplatesStoreRefresh`). `?asset=<uuid>` and `?kind=DATASET` (search, recents, the Content store's empty state) still
 * work: they redirect to the route / folder they mean.
 *
 * <p>The state of the open template lives in `TemplatesStore` and the parts in the `sf-template-*` components next to it.
 */
@Component({
  selector: 'sf-templates',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FavoritesViewComponent,
    RecordSidePanelComponent,
    RouterOutlet,
    SfMenuComponent,
    SfRenameAssetDialogComponent,
    SfSplitterComponent,
    SfTreeComponent,
    TemplatesFolderViewComponent,
    TemplatesMoveDialogComponent,
    TranslocoPipe,
  ],
  providers: [TemplatesStore, TemplatesEditing, TemplatesLoader, TemplatesSaveCoordinator, TemplatesStoreRefresh],
  templateUrl: './templates.component.html',
  styleUrl: './templates.component.scss',
})
export class TemplatesComponent {
  readonly projectKey = input.required<string>();
  /** `?kind=DATASET` opens the store on the datasets folder (the Content store's empty state links here). */
  readonly kindParam = input<string | undefined>(undefined, { alias: 'kind' });
  /** `?asset=<uuid>` opens that template or dataset (search deep links, M23.4.1): the area moves to `/templates/<uuid>`. */
  readonly asset = input<string | undefined>();
  /** `?folder=<uuid>` is the open folder (kept in the URL, so recents and deep links find it). */
  readonly folder = input<string | undefined>();
  /** `?favorites=1` shows the Favorites list. */
  readonly favoritesParam = input<string | undefined>(undefined, { alias: 'favorites' });

  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly api = inject(ApiClient);
  private readonly dialogs = inject(DialogService);
  private readonly actions = inject(TemplatesItemActions);
  private readonly refresh = inject(TemplatesStoreRefresh);
  private readonly toasts = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly transloco = inject(TranslocoService);
  private readonly projectContext = inject(ProjectContextStore);
  private readonly favorites = inject(FavoritesService);
  private readonly favoriteTree = inject(FavoriteTreeService);
  private readonly developerMode = inject(DeveloperModeService);
  private readonly permissions = inject(ProjectPermissionsStore);
  protected readonly store = inject(TemplatesStore);
  protected readonly save = inject(TemplatesSaveCoordinator);
  private readonly loader = inject(TemplatesLoader);

  /** Creating, renaming, moving and deleting: developers, outside time travel and archived projects. */
  protected readonly canEdit = this.permissions.canEditTemplates;

  private readonly tree = viewChild<SfTreeComponent<TemplateEntry>>(SfTreeComponent);

  protected readonly treeWidth =
    typeof matchMedia !== 'function' || matchMedia(WIDE_QUERY).matches ? TREE_WIDTH : TREE_WIDTH_NARROW;
  /** Drag and drop, Del, F2 and the inline folder; the menu is the host's (`hostMenu`): no cut, copy or paste. */
  protected readonly treeActions: readonly SfTreeAction[] = ['rename', 'delete', 'move', 'create'];

  // ── Data ───────────────────────────────────────────────────────────────────

  protected readonly folderTree = this.store.templateFolderTree;
  protected readonly loaded = this.store.loaded;
  protected readonly failed = this.store.listFailed;
  protected readonly index = computed(() => (this.loaded() ? buildTemplatesIndex(this.folderTree(), this.store.templates()) : EMPTY_TEMPLATES_INDEX));

  private readonly language = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  // ── What is open ───────────────────────────────────────────────────────────

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** The open template or dataset: the route's uuid. */
  protected readonly templateUuid = computed(() => templateUuidFromUrl(this.url()));
  protected readonly mode = computed<'child' | 'favorites' | 'folder'>(() =>
    this.templateUuid() ? 'child' : this.favoritesParam() ? 'favorites' : 'folder',
  );
  /** The open folder: `?folder=`, or the datasets folder for `?kind=DATASET`; `null` is the top level. */
  protected readonly folderUuid = computed<string | null>(() => {
    if (this.mode() !== 'folder') {
      return null;
    }
    const uuid = this.folder();
    if (uuid) {
      return this.index().entries.get(uuid)?.kind === 'folder' ? uuid : null;
    }
    if (this.kindParam()?.toUpperCase() === 'DATASET') {
      return findFolderByUid(this.folderTree(), DATASETS_ROOT_UID)?.uuid ?? null;
    }
    return null;
  });

  protected readonly treeSelection = computed<string[]>(() => {
    const open = this.templateUuid();
    if (open) {
      return [open];
    }
    if (this.mode() === 'favorites') {
      return [FAVORITES_NODE];
    }
    const folder = this.folderUuid();
    return folder ? [folder] : [];
  });

  // ── Tree wiring ────────────────────────────────────────────────────────────

  protected readonly loaderFn = computed<SfTreeLoader<TemplateEntry>>(() => {
    const index = this.index();
    const dev = this.developerMode.enabled();
    const favorites = this.favorites.list();
    const key = this.projectKey();
    const label = (this.language(), this.transloco.translate('templates.tree.favorites'));
    return (parent) => {
      if (parent === null) {
        const nodes = childNodes(index, null, { dev });
        return favorites.length > 0 ? [this.favoriteTree.rootNode<TemplateEntry>(label), ...nodes] : nodes;
      }
      if (parent.id === FAVORITES_NODE) {
        return this.favoriteTree.nodes<TemplateEntry>(favorites);
      }
      if (isFavoriteNode(parent.id)) {
        return this.favoriteTree.children<TemplateEntry>(key, parent);
      }
      return childNodes(index, parent.id, { dev });
    };
  });

  protected readonly search = (query: string): readonly (readonly string[])[] => searchPaths(this.index(), query);

  /** The *Favorites* branch is a view; the fixed kind folders are never renamed, moved or deleted; only a folder takes a new folder. */
  protected readonly allowAction = (action: SfTreeAction, nodes: readonly SfTreeNode<TemplateEntry>[]): boolean => {
    if (!this.canEdit() || nodes.some((node) => isFavoriteNode(node.id))) {
      return false;
    }
    if (action === 'create') {
      return nodes.every((node) => node.data?.kind === 'folder');
    }
    return nodes.every((node) => !node.data?.protectedFolder);
  };

  /** Only into a folder of the same kind: page templates, section templates and datasets each keep to their own folders. */
  protected readonly canDrop = (dragged: readonly SfTreeNode<TemplateEntry>[], target: SfTreeNode<TemplateEntry> | null): boolean =>
    target !== null &&
    !isFavoriteNode(target.id) &&
    target.data?.kind === 'folder' &&
    dragged.every((node) => !!node.data && !node.data.protectedFolder && node.data.assetKind === target.data!.assetKind);

  /** A name is free among the siblings of its kind. */
  protected readonly validateName = (name: string, context: SfTreeNameContext<TemplateEntry>): string | null => {
    const taken = childEntries(this.index(), context.parent?.id ?? null).some(
      (sibling) => sibling.kind === 'folder' && sibling.name.toLowerCase() === name.toLowerCase(),
    );
    return taken ? this.transloco.translate('templates.tree.nameTaken') : null;
  };

  protected readonly confirmDelete = (nodes: readonly SfTreeNode<TemplateEntry>[]): Promise<boolean> =>
    this.actions.confirmDelete(
      this.projectKey(),
      nodes.flatMap((node) => (node.data ? [node.data] : [])),
      this.index(),
      this.injector,
    );

  /**
   * The context menu (gate decision 157), all of it the host's apart from *Delete*: a template has *Duplicate*,
   * *Rename…*, *Move to…*, *Used by* and *Add to favorites*; a folder *New ▸* (the kind named in every entry), *Rename…*,
   * *Move to…* and *Add to favorites*.
   */
  protected readonly menuItems = (nodes: readonly SfTreeNode<TemplateEntry>[]): ContextMenuItem[] => {
    const node = nodes.length === 1 ? nodes[0] : null;
    const entry = node?.data;
    if (!node || !entry || isFavoriteNode(node.id)) {
      return [];
    }
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const items: ContextMenuItem[] = [];
    const edit = this.canEdit();
    if (edit && entry.kind === 'folder') {
      items.push({
        label: t('templates.menu.new'),
        icon: 'add',
        children: [
          ...NEW_KINDS.map((kind) => ({
            label: t(`templates.new.${kind}`),
            icon: TEMPLATE_ICONS[kind],
            action: () => void this.openNewTemplate(entry.uuid, kind),
          })),
          { label: t('templates.new.folder'), icon: TEMPLATE_ICONS.folder, separator: false, action: () => void this.tree()?.startCreate(entry.uuid, 'folder') },
        ],
      });
    }
    if (edit && entry.kind !== 'folder') {
      items.push({ label: t('templates.menu.duplicate'), icon: 'content_copy', action: () => void this.duplicate(entry) });
    }
    if (edit && !entry.protectedFolder) {
      items.push(
        { label: t('templates.menu.rename'), icon: 'edit', shortcut: 'F2', action: () => this.openRename(entry) },
        { label: t('templates.menu.move'), icon: 'drive_file_move', action: () => this.openMove([entry]) },
      );
    }
    if (entry.kind !== 'folder') {
      items.push({ label: t('templates.menu.usedBy'), icon: 'link', action: () => this.store.usedByUuid.set(entry.uuid) });
    }
    const on = this.favorites.isFavorite(node.id);
    items.push({
      label: t(on ? 'shared.favorite.remove' : 'shared.favorite.add', { name: node.label }),
      icon: 'star',
      action: () => this.toggleFavorite(entry),
    });
    return items;
  };

  /** The head's *New* menu: each entry names the kind; the open folder (or the folder of the open template) is where it goes. */
  protected readonly newItems = computed<SfMenuItem[]>(() => {
    this.language();
    const t = (id: string) => this.transloco.translate(`templates.new.${id}`);
    const where = this.openFolderUuid();
    return [
      ...NEW_KINDS.map((kind) => ({ id: kind, label: t(kind), icon: TEMPLATE_ICONS[kind], action: () => void this.openNewTemplate(where, kind) })),
      {
        id: 'folder',
        label: t('folder'),
        icon: TEMPLATE_ICONS.folder,
        separatorBefore: true,
        disabledReason: where === null ? this.transloco.translate('templates.folder.folderNeedsParent') : undefined,
        action: () => void this.tree()?.startCreate(where, 'folder'),
      },
    ];
  });

  // ── Dialogs ────────────────────────────────────────────────────────────────

  protected readonly renaming = signal<TemplateEntry | null>(null);
  protected readonly renameBusy = signal(false);
  protected readonly moving = signal<readonly TemplateEntry[] | null>(null);
  /** The Used by drawer: its tab (`null` = closed), title and rows. */
  protected readonly usedByTab = signal<RecordSidePanelTab | null>(null);
  protected readonly usedByTitle = signal('');
  protected readonly usedByRows = signal<UsageDto[]>([]);

  constructor() {
    this.store.bind(this.projectKey);
    // The open template is an editor for the frame (M35.13): Ctrl+S, the leave guard and the tab-close prompt.
    const unregister = inject(ActiveEditorService).register(this.save.asEditorState());
    inject(DestroyRef).onDestroy(unregister);
    // The open template or dataset: the breadcrumb ends with it, and the History drawer shows its versions (M35.12).
    useFrameItem(() => {
      const uuid = this.store.selectedUuid();
      const open = uuid ? this.store.templates().find((t) => t.uuid === uuid) : null;
      const label = open?.displayName || open?.uid;
      if (!label || !uuid) {
        return null;
      }
      const folder = this.index().parentOf.get(uuid);
      const chain = folder ? folderChain(this.folderTree(), folder) : [];
      return { label, trail: folderTrail(chain, this.projectKey(), this.index().rootUuid), asset: { uuid } };
    });

    effect(() => {
      const key = this.projectKey();
      if (!key) {
        return;
      }
      this.projectContext.loadFor(key).subscribe();
    });

    // The lists again whenever something changed: a create, move, delete or undo, a rename, a duplicate.
    effect(
      () => {
        const key = this.projectKey();
        const tick = this.refresh.tick();
        if (!key) {
          return;
        }
        untracked(() => (tick === 0 ? this.loader.reloadList(key) : this.loader.onTreeChanged()));
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          return;
        }
        this.loader.reloadChannels(key);
      },
      { allowSignalWrites: true },
    );

    // What is open follows the URL: the route's uuid is the one source of the open template (the guard on the route asks first).
    effect(() => this.store.selectedUuid.set(this.templateUuid()), { allowSignalWrites: true });

    // The detail of the open template, once the list says which kind it is.
    effect(
      () => {
        const key = this.projectKey();
        const uuid = this.store.selectedUuid();
        if (!key || !uuid || this.store.datasetSelected()) {
          this.store.detail.set(null);
          return;
        }
        if (!this.store.loaded()) {
          return;
        }
        this.loader.reloadDetail(key, uuid);
      },
      { allowSignalWrites: true },
    );

    // `?asset=<uuid>` (search, recents, favorites of an older link) moves to the template's own route.
    effect(() => {
      const uuid = this.asset();
      if (uuid) {
        untracked(() => void this.router.navigate(['/p', this.projectKey(), 'templates', uuid], { replaceUrl: true }));
      }
    });

    // Keep the open item visible in the tree (expanding its ancestors).
    effect(() => {
      this.templateUuid();
      this.folderUuid();
      this.mode();
      if (this.loaded()) {
        untracked(() => afterNextRender(() => void this.revealOpen(), { injector: this.injector }));
      }
    });

    // Used by asked from the tree, the table or the header.
    effect(
      () => {
        const uuid = this.store.usedByUuid();
        if (uuid) {
          untracked(() => {
            this.store.usedByUuid.set(null);
            void this.showUsedBy(uuid);
          });
        }
      },
      { allowSignalWrites: true },
    );
  }

  /** `n` creates a template (M35.14): the New template dialog asks for the kind. */
  private readonly newTemplateShortcut = inject(ShortcutService).use([
    createShortcut({
      handler: () => {
        if (!this.canEdit()) {
          return false;
        }
        void this.openNewTemplate(this.openFolderUuid(), null);
        return true;
      },
      palette: { label: 'frame.shortcuts.items.createTemplate' },
    }),
  ]);

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Something changed: the tree and the folder table read the store again. */
  protected changed(): void {
    this.refresh.notify();
  }

  /** The folder an action without a target aims at: the folder of the open template, else the open folder (`null` = top level). */
  private openFolderUuid(): string | null {
    const open = this.templateUuid();
    if (open) {
      return this.index().parentOf.get(open) ?? null;
    }
    return this.folderUuid();
  }

  private async revealOpen(): Promise<void> {
    const tree = this.tree();
    const open = this.templateUuid();
    const id = open ?? (this.mode() === 'folder' ? this.folderUuid() : null);
    if (!tree || !id) {
      return;
    }
    const path = idPath(this.index(), id);
    for (const ancestor of open ? path.slice(0, -1) : path) {
      await tree.expand(ancestor);
    }
  }

  // ── Opening ────────────────────────────────────────────────────────────────

  protected onOpen(node: SfTreeNode<TemplateEntry>): void {
    const key = this.projectKey();
    if (node.id === FAVORITES_NODE) {
      void this.router.navigate(['/p', key, 'templates'], { queryParams: { favorites: 1 } });
      return;
    }
    if (isFavoriteNode(node.id)) {
      const route = this.favoriteTree.routeOf(key, node);
      if (route) {
        void this.router.navigate([...route.commands], { queryParams: route.queryParams });
      }
      return;
    }
    this.openEntry(node.data);
  }

  protected openEntry(entry: TemplateEntry | undefined): void {
    if (!entry) {
      return;
    }
    if (entry.kind === 'folder') {
      this.openFolder(entry.uuid);
    } else {
      this.openTemplate(entry.uuid);
    }
  }

  protected openTemplate(uuid: string): void {
    void this.router.navigate(['/p', this.projectKey(), 'templates', uuid]);
  }

  protected openFolder(uuid: string | null): void {
    void this.router.navigate(['/p', this.projectKey(), 'templates'], { queryParams: uuid ? { folder: uuid } : {} });
  }

  // ── Favorites ──────────────────────────────────────────────────────────────

  private toggleFavorite(entry: TemplateEntry): void {
    const on = this.favorites.toggle({ type: favoriteTypeOf(entry), uuid: entry.uuid, displayName: entry.name, folderPath: entry.path });
    this.toasts.show(this.transloco.translate(on ? 'shared.favorite.added' : 'shared.favorite.removed', { name: entry.name }), 'info');
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /** The fixed top-level folder of a kind (Page templates, Section templates, Datasets). */
  private kindRoot(kind: NewTemplateKind): TemplateEntry | null {
    const index = this.index();
    const assetKind = assetKindOf(kind);
    return (
      (index.childrenOf.get(null) ?? []).map((uuid) => index.entries.get(uuid)).find((entry) => entry?.kind === 'folder' && entry.assetKind === assetKind) ?? null
    );
  }

  /**
   * Where a new item of `kind` goes: the folder it was started from when that folder holds that kind, else the fixed folder
   * of the kind (page templates, section templates and datasets each keep to their own folders; nothing lives in the top level).
   */
  private createTarget(kind: NewTemplateKind, folderUuid: string | null): TemplateEntry | null {
    const folder = folderUuid ? this.index().entries.get(folderUuid) : undefined;
    return folder?.kind === 'folder' && folder.assetKind === assetKindOf(kind) ? folder : this.kindRoot(kind);
  }

  /**
   * Opens the New template dialog. `kind` is what a *New ▸ kind* entry picked, or `null` from the header's button and the
   * `n` key, which leave the choice to the dialog; it is never taken from the selection. `folderUuid` is where it was started.
   */
  protected async openNewTemplate(folderUuid: string | null, kind: NewTemplateKind | null): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    const names = Object.fromEntries(NEW_KINDS.map((k) => [k, this.createTarget(k, folderUuid)?.name ?? ''])) as Record<NewTemplateKind, string>;
    const started = folderUuid ? this.index().entries.get(folderUuid) : undefined;
    const data: NewTemplateData = { folders: names, started: started?.name ?? null, kind };
    const result = await this.dialogs.open<NewTemplateResult, NewTemplateData>(NewTemplateDialogComponent, data, { injector: this.injector }).result;
    if (result) {
      await this.createTemplate(result, folderUuid);
    }
  }

  /** Creates what the dialog asked for and opens it. */
  async createTemplate(result: NewTemplateResult, folderUuid: string | null): Promise<void> {
    const key = this.projectKey();
    if (!key || !this.canEdit()) {
      return;
    }
    const target = this.createTarget(result.kind, folderUuid);
    try {
      const created = await this.actions.create(key, { ...result, parentFolderUuid: target?.uuid });
      this.toasts.show(this.transloco.translate('templates.toast.created', { name: result.name }), 'success');
      if (!created.uidApplied) {
        this.toasts.show(this.transloco.translate('templates.toast.uidNotApplied', { uid: result.uid }), 'warning');
      }
      if (created.uuid) {
        // Known at once, so opening it reads the right endpoint (a section template is not a page template) before the list is read again.
        this.store.templates.update((list) => [
          ...list,
          { uuid: created.uuid, uid: created.uid, assetType: assetKindOf(result.kind), displayName: result.name, folderPath: target?.path, channels: [], usedByCount: 0 },
        ]);
      }
      this.changed();
      if (created.uuid) {
        this.openTemplate(created.uuid);
      }
    } catch (err: unknown) {
      const detail = err instanceof HttpErrorResponse ? (err.error as { detail?: string } | null)?.detail : undefined;
      this.toasts.show(detail ?? this.transloco.translate(`templates.toast.createFailed.${result.kind}`), 'error');
    }
  }

  /** The folder view's *New ▸ Folder*: created in place in the tree, inside the open folder. */
  protected newFolderHere(): void {
    const folder = this.folderUuid();
    if (folder && this.canEdit()) {
      void this.tree()?.startCreate(folder, 'folder');
    }
  }

  /** A folder created in place in the tree. */
  protected onCreate(request: SfTreeCreateRequest<TemplateEntry>): void {
    if (request.kind !== 'folder' || !request.parent || !this.canEdit()) {
      return;
    }
    this.api
      .createFolder(this.projectKey(), { displayName: request.name, parentFolderUuid: request.parent.id, scope: 'TEMPLATES' })
      .subscribe({
        next: (created) => {
          this.toasts.show(this.transloco.translate('templates.toast.folderCreated', { name: request.name }), 'success');
          this.changed();
          void this.tree()?.expand(request.parent!.id);
          if (created.uuid) {
            this.openFolder(created.uuid);
          }
        },
        error: () => this.toasts.show(this.transloco.translate('templates.toast.folderCreateFailed'), 'error'),
      });
  }

  private async duplicate(entry: TemplateEntry): Promise<void> {
    if (this.canEdit()) {
      await this.actions.duplicate(this.projectKey(), entry, this.index().parentOf.get(entry.uuid) ?? undefined, () => this.changed());
    }
  }

  // ── Rename ─────────────────────────────────────────────────────────────────

  protected openRename(entry: TemplateEntry | SfTreeNode<TemplateEntry>): void {
    const target = 'kind' in entry ? entry : entry.data;
    if (target && !target.protectedFolder && this.canEdit()) {
      this.renaming.set(target);
    }
  }

  protected onRenameRequest(node: SfTreeNode<TemplateEntry>): void {
    this.openRename(node);
  }

  protected renameDisplayName(name: string): void {
    const entry = this.renaming();
    if (!entry) {
      return;
    }
    const key = this.projectKey();
    this.renameBusy.set(true);
    this.actions.rename(key, entry, name, entry.revision ?? undefined).subscribe({
      next: (renamed) => {
        this.renameBusy.set(false);
        this.renaming.set(null);
        // Undo renames back; the etag is the revision the rename produced.
        this.undo.offer(this.transloco.translate('templates.toast.renamed', { from: entry.name, to: name }), () =>
          this.actions.rename(key, entry, entry.name, renamed.revision).pipe(tap(() => this.afterRename(entry))),
        );
        this.afterRename(entry);
      },
      error: (err: unknown) => {
        this.renameBusy.set(false);
        this.toasts.show(
          this.transloco.translate(err instanceof HttpErrorResponse && err.status === 409 ? 'templates.toast.renameConflict' : 'templates.toast.renameFailed', { name: entry.name }),
          'error',
        );
      },
    });
  }

  /** The tree and the table read the store again; an open template shows its new name. */
  protected afterRename(entry: TemplateEntry): void {
    this.changed();
    if (entry.uuid === this.store.selectedUuid() && entry.kind !== 'dataset') {
      this.loader.reloadDetail(this.projectKey(), entry.uuid, false, () => this.save.dirty());
    }
  }

  protected onUidChanged(): void {
    this.changed();
    this.loader.onUidChanged();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  protected onDelete(request: SfTreeDeleteRequest<TemplateEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    void (async () => {
      const change = await this.actions.delete(this.projectKey(), entries);
      if (change.done.length > 0) {
        this.leaveDeleted(change.done.map((entry) => entry.uuid));
      }
      this.changed();
      if (change.failed) {
        // What was deleted before the failure stays deleted and stays undoable.
        this.toasts.show(this.transloco.translate('templates.toast.deleteFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
        if (change.done.length > 0) {
          this.undo.offerGroup(this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].name }), this.withRefresh(change.steps));
        }
        return;
      }
      request.completed(() => void this.actions.runUndo(this.withRefresh(change.steps)));
    })();
  }

  /** What is open was deleted: the area goes back to the folder it was in. */
  private leaveDeleted(uuids: readonly string[]): void {
    const index = this.index();
    const open = this.templateUuid() ?? this.folderUuid();
    if (open && uuids.some((uuid) => uuid === open || idPath(index, open).includes(uuid))) {
      this.openFolder(null);
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  /** Drag and drop in the tree: only into a folder of the same kind (`canDrop`). */
  protected onMove(request: SfTreeMoveRequest<TemplateEntry>): void {
    const entries = request.nodes.flatMap((node) => (node.data ? [node.data] : []));
    const target = request.target?.id ?? null;
    if (!target) {
      return;
    }
    void this.transfer(entries, target, (steps) => request.completed(steps ? () => void this.actions.runUndo(steps) : undefined));
  }

  /** The menu's *Move to…*: a picker for the destination. */
  protected openMove(entries: readonly TemplateEntry[]): void {
    if (!this.canEdit()) {
      return;
    }
    if (entries.some((entry) => entry.protectedFolder)) {
      this.toasts.show(this.transloco.translate('templates.move.protected'), 'error');
      return;
    }
    this.moving.set(entries);
  }

  protected onMoveChosen(target: string): void {
    const entries = this.moving();
    this.moving.set(null);
    if (!entries) {
      return;
    }
    void this.transfer(entries, target, (steps) => {
      const message = this.transloco.translate('shared.tree.moved', { count: entries.length, name: entries[0]?.name ?? '' });
      if (steps) {
        this.undo.offerGroup(message, steps);
      } else {
        this.toasts.show(message, 'success');
      }
    });
  }

  /** Moves into the folder `target`. Undo moves back. Stops at the first failure; what was done up to there stays and is announced. */
  private async transfer(entries: readonly TemplateEntry[], target: string, completed: (undo?: UndoStep[]) => void): Promise<void> {
    const index = this.index();
    const change = await this.actions.move(this.projectKey(), entries, target, (entry) => index.parentOf.get(entry.uuid) ?? null);
    this.changed();
    if (change.failed) {
      this.toasts.show(this.transloco.translate('templates.toast.moveFailed', { name: entries[change.done.length]?.name ?? '' }), 'error');
      if (change.done.length === 0) {
        return;
      }
    }
    completed(change.done.length > 0 ? this.withRefresh(change.steps) : undefined);
  }

  /** After an Undo the tree and the table read the store again: the first step is the one that runs last. */
  private withRefresh(steps: readonly UndoStep[]): UndoStep[] {
    return [async () => this.changed(), ...steps];
  }

  // ── Used by ────────────────────────────────────────────────────────────────

  /** The Used by drawer (gate decision 154): the pages, templates and record sets that use the template or dataset. */
  protected async showUsedBy(uuid: string): Promise<void> {
    const key = this.projectKey();
    const entry = this.index().entries.get(uuid);
    const row = this.store.templates().find((t) => t.uuid === uuid);
    const name = entry?.name ?? row?.displayName ?? row?.uid ?? '';
    try {
      const usages = await new Promise<UsageDto[]>((resolve, reject) => this.actions.usages(key, uuid).subscribe({ next: resolve, error: reject }));
      this.usedByRows.set(usages ?? []);
      this.usedByTitle.set(this.transloco.translate('templates.usedBy.title', { name }));
      this.usedByTab.set('usages');
    } catch {
      this.toasts.show(this.transloco.translate('templates.usedBy.failed', { name }), 'error');
    }
  }

  protected onFolderViewUsedBy(entry: TemplateEntry): void {
    void this.showUsedBy(entry.uuid);
  }

  /** Retry of the folder table: the store is read again. */
  protected retry(): void {
    this.changed();
  }
}
