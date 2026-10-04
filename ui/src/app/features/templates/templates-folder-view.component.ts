import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService, type UndoStep } from '../../core/ui/undo.service';
import type { SfDataTableBulkAction, SfDataTableColumn, SfDataTableFilter } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import type { NewTemplateKind } from './new-template-dialog.component';
import { TemplatesItemActions } from './templates-item-actions.service';
import { TemplatesMoveDialogComponent } from './templates-move-dialog.component';
import { TemplatesStoreRefresh } from './templates-store-refresh.service';
import {
  type TemplateEntry,
  type TemplateEntryKind,
  type TemplatesIndex,
  TEMPLATE_ICONS,
  childEntries,
  folderChain,
  folderTrail,
} from './templates-tree.util';

type FolderView = components['schemas']['FolderView'];

/** The kind filter of the table; its id is also the URL parameter (`?kind=page`). */
const KIND_FILTER = 'kinds';
const KINDS: readonly TemplateEntryKind[] = ['page', 'section', 'dataset', 'folder'];

/** The favorite type of an entry (the Favorites list and the palette group by it). */
export function favoriteTypeOf(entry: Pick<TemplateEntry, 'kind'>): string {
  switch (entry.kind) {
    case 'folder':
      return 'FOLDER';
    case 'section':
      return 'SECTION_TEMPLATE';
    case 'dataset':
      return 'DATASET';
    default:
      return 'PAGE_TEMPLATE';
  }
}

/**
 * A Templates folder's contents (M35.21, gate decision 153): a page header with the folder's name and *New* (a menu that
 * names the kind), ⋮ with *Rename…*, *Move…* and *Delete* (the top level has none), and a table of what lies directly
 * inside — sub-folders first, then the templates and datasets: **Name** (icon of the kind, UID in developer mode, a ☆
 * that shows on hover or focus), **Kind**, **Channels** (a chip per channel), **Used by** (the count, a button that opens
 * the Used by drawer) and **Modified**. A *Kind* filter ("Kind: Page template"), multi-select with bulk *Move…* and
 * *Delete* (the confirmation names what uses the items; one Undo). What opening a row, creating or renaming something
 * means is the area's business (outputs); the data comes from there too.
 */
@Component({
  selector: 'sf-templates-folder-view',
  standalone: true,
  imports: [
    SfAssetFavoriteComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    TemplatesMoveDialogComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './templates-folder-view.component.html',
  styleUrl: './templates-folder-view.component.scss',
})
export class TemplatesFolderViewComponent {
  private readonly actions = inject(TemplatesItemActions);
  private readonly refresh = inject(TemplatesStoreRefresh);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly developerMode = inject(DeveloperModeService);
  protected readonly canEdit = inject(ProjectPermissionsStore).canEditTemplates;
  protected readonly dev = this.developerMode.enabled;

  readonly projectKey = input.required<string>();
  /** The open folder; `null` is the top level (so is a uuid that is not in the tree any more). */
  readonly folderUuid = input<string | null>(null);
  readonly index = input.required<TemplatesIndex>();
  /** The folder tree as the store holds it: the fixed "All Templates" wrapper as its single entry. */
  readonly tree = input.required<readonly FolderView[]>();
  readonly loading = input(false);
  readonly failed = input(false);

  readonly openEntry = output<TemplateEntry>();
  /** The folder shown was deleted: the area goes up to the folder it was in (`null`: the top level). */
  readonly openFolder = output<string | null>();
  /** *New ▸ kind* (or `null` from nothing chosen) in the folder shown. */
  readonly newTemplate = output<NewTemplateKind | null>();
  readonly newFolder = output<void>();
  /** The header's *Rename…*, or the row menu's: the area shows the Rename dialog. */
  readonly rename = output<TemplateEntry>();
  /** The Used by count of a row: the area opens the drawer. */
  readonly usedBy = output<TemplateEntry>();
  readonly retry = output<void>();

  // ── What is shown ──────────────────────────────────────────────────────────

  /** The open folder, `null` at the top level. */
  protected readonly folder = computed<TemplateEntry | null>(() => {
    const uuid = this.folderUuid();
    const entry = uuid ? this.index().entries.get(uuid) : undefined;
    return entry?.kind === 'folder' ? entry : null;
  });
  protected readonly isRoot = computed(() => this.folder() === null);
  protected readonly title = computed(() => this.folder()?.name ?? this.transloco.translate('templates.tree.title'));
  protected readonly rows = computed<TemplateEntry[]>(() => childEntries(this.index(), this.folder()?.uuid ?? null));

  private readonly chain = computed<FolderView[]>(() => {
    const uuid = this.folder()?.uuid;
    return uuid ? folderChain(this.tree(), uuid) : [];
  });
  protected readonly trail = computed(() => folderTrail(this.chain().slice(0, -1), this.projectKey(), this.index().rootUuid));

  protected readonly rowKey = (row: TemplateEntry): string => row.uuid;
  protected readonly rowLabel = (row: TemplateEntry): string => row.name;
  protected readonly icon = (row: TemplateEntry): string => TEMPLATE_ICONS[row.kind];
  protected readonly favoriteType = favoriteTypeOf;
  protected kindLabel(kind: TemplateEntryKind): string {
    return this.transloco.translate(`templates.kinds.${kind}`);
  }

  protected readonly moving = signal<readonly TemplateEntry[] | null>(null);

  protected readonly columns = computed<SfDataTableColumn<TemplateEntry>[]>(() => {
    const header = (id: string) => this.transloco.translate(`templates.folder.columns.${id}`);
    return [
      { id: 'name', header: header('name'), value: (row) => row.name, sortable: true, hideable: false, width: 280 },
      { id: 'kind', header: header('kind'), value: (row) => this.kindLabel(row.kind), sortable: true, width: 150 },
      { id: 'channels', header: header('channels'), value: (row) => row.channels.join(), width: 160, searchable: false },
      { id: 'usedBy', header: header('usedBy'), value: (row) => (row.kind === 'folder' ? -1 : (row.usedByCount ?? 0)), sortable: true, align: 'end', width: 120, searchable: false },
      { id: 'modified', header: header('modified'), value: (row) => row.changedAt ?? '', sortable: true, width: 170 },
    ];
  });

  /** "Kind: Page template": the table's own filter chips. */
  protected readonly filters = computed<SfDataTableFilter<TemplateEntry>[]>(() => [
    {
      id: KIND_FILTER,
      label: this.transloco.translate('templates.folder.kindFilter'),
      options: KINDS.map((kind) => ({ value: kind, label: this.kindLabel(kind) })),
      match: (row, values) => values.includes(row.kind),
    },
  ]);

  /** A selection that has the fixed top-level folders in it cannot be moved or deleted. */
  protected readonly bulkActions = computed<SfDataTableBulkAction<TemplateEntry>[]>(() => {
    if (!this.canEdit()) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`templates.folder.bulk.${id}`);
    return [
      { id: 'move', label: t('move'), icon: 'drive_file_move', action: (selection) => this.askMove(selection.rows) },
      { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: (selection) => void this.delete(selection.rows) },
    ];
  });

  /** The header's *New* menu: each entry names the kind; the folder is where it goes. */
  protected readonly newItems = computed<SfMenuItem[]>(() => {
    const t = (id: string) => this.transloco.translate(`templates.new.${id}`);
    const topLevel = this.isRoot();
    return [
      { id: 'page', label: t('page'), icon: TEMPLATE_ICONS.page, action: () => this.newTemplate.emit('page') },
      { id: 'section', label: t('section'), icon: TEMPLATE_ICONS.section, action: () => this.newTemplate.emit('section') },
      { id: 'dataset', label: t('dataset'), icon: TEMPLATE_ICONS.dataset, action: () => this.newTemplate.emit('dataset') },
      {
        id: 'folder',
        label: t('folder'),
        icon: TEMPLATE_ICONS.folder,
        separatorBefore: true,
        disabledReason: topLevel ? this.transloco.translate('templates.folder.folderNeedsParent') : undefined,
        action: () => this.newFolder.emit(),
      },
    ];
  });

  /** The folder's ⋮ menu; the top level and the fixed kind folders have none (they cannot be renamed, moved or deleted). */
  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const folder = this.folder();
    if (!folder || folder.protectedFolder) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`templates.folder.menu.${id}`);
    const disabled = !this.canEdit();
    return [
      { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', disabled },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled },
    ];
  });

  constructor() {
    // The frame's breadcrumb ends with the open folder, with the folders above it as links.
    useFrameItem(() => {
      const folder = this.folder();
      return folder ? { label: folder.name, trail: this.trail(), asset: { uuid: folder.uuid } } : null;
    });

    inject(ShortcutService).use([
      {
        id: 'templatesFolder.rename',
        keys: 'F2',
        scope: 'screen',
        group: 'screen',
        description: 'templates.folder.menu.rename',
        enabled: () => !!this.folder() && !this.folder()!.protectedFolder && this.canEdit(),
        handler: () => this.renameOpen(),
      },
    ]);
  }

  // ── Table cells ────────────────────────────────────────────────────────────

  protected open(row: TemplateEntry): void {
    this.openEntry.emit(row);
  }

  protected showUsedBy(row: TemplateEntry, event: Event): void {
    event.stopPropagation();
    this.usedBy.emit(row);
  }

  // ── Header actions ─────────────────────────────────────────────────────────

  protected onMenu(item: SfMenuItem): void {
    const folder = this.folder();
    if (!folder) {
      return;
    }
    switch (item.id) {
      case 'rename':
        this.renameOpen();
        break;
      case 'move':
        this.askMove([folder]);
        break;
      case 'delete':
        void this.delete([folder]);
        break;
    }
  }

  private renameOpen(): void {
    const folder = this.folder();
    if (folder && !folder.protectedFolder) {
      this.rename.emit(folder);
    }
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  private askMove(entries: readonly TemplateEntry[]): void {
    if (entries.some((entry) => entry.protectedFolder)) {
      this.toasts.show(this.transloco.translate('templates.move.protected'), 'error');
      return;
    }
    if (new Set(entries.map((entry) => entry.assetKind)).size > 1) {
      this.toasts.show(this.transloco.translate('templates.move.mixedKinds'), 'error');
      return;
    }
    this.moving.set(entries);
  }

  protected onMoveChosen(entries: readonly TemplateEntry[], target: string): void {
    this.moving.set(null);
    void this.move(entries, target);
  }

  private async move(entries: readonly TemplateEntry[], target: string): Promise<void> {
    const index = this.index();
    const change = await this.actions.move(this.projectKey(), entries, target, (entry) => index.parentOf.get(entry.uuid) ?? null);
    if (change.done.length > 0) {
      const message = this.transloco.translate('shared.tree.moved', { count: change.done.length, name: change.done[0].name });
      this.undo.offerGroup(message, this.withRefresh(change.steps));
    }
    if (change.failed) {
      this.toasts.show(this.transloco.translate('templates.folder.bulk.moveFailed'), 'error');
    }
    this.refresh.notify();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  private async delete(entries: readonly TemplateEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    if (entries.some((entry) => entry.protectedFolder)) {
      this.toasts.show(this.transloco.translate('templates.delete.protected'), 'error');
      return;
    }
    if (!(await this.actions.confirmDelete(this.projectKey(), entries, this.index()))) {
      return;
    }
    const open = this.folder()?.uuid;
    const parent = open ? (this.index().parentOf.get(open) ?? null) : null;
    const change = await this.actions.delete(this.projectKey(), entries);
    if (change.done.length > 0) {
      const message = this.transloco.translate('shared.tree.deleted', { count: change.done.length, name: change.done[0].name });
      this.undo.offerGroup(message, this.withRefresh(change.steps));
    }
    if (change.failed) {
      this.toasts.show(this.transloco.translate('templates.folder.bulk.deleteFailed'), 'error');
    }
    this.refresh.notify();
    // The open folder itself was deleted: the view goes up to where it was.
    if (open && change.done.some((entry) => entry.uuid === open)) {
      this.openFolder.emit(parent);
    }
  }

  /** After an Undo the area reads the store again: the first step is the one that runs last. */
  private withRefresh(steps: readonly UndoStep[]): UndoStep[] {
    return [async () => this.refresh.notify(), ...steps];
  }
}
