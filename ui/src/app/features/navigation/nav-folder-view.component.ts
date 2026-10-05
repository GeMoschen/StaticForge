import { bulkActionsAsMenu } from '../../shared/components/data-table/data-table-menu';
import type { ContextMenuItem } from '../../shared/services/context-menu.service';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import type { SfDataTableBulkAction, SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { type NavEntry, type NavIndex, type NavUrls, entryFolderPath, entryUrl, navChildren, navTrail } from './navigation-tree.util';

/** A row of a menu folder's table. */
export interface NavRow {
  readonly entry: NavEntry;
  readonly targetName: string | null;
  readonly url: string | null;
  readonly isEntryPage: boolean;
}

/** A change of "Visible in menu" the table or the ⋮ menu asks the Navigation area to make. */
export interface NavVisibilityRequest {
  readonly entries: readonly NavEntry[];
  readonly visible: boolean;
}

/**
 * A menu folder (M35.22, decision 24): a page header with the folder's name and where it leads ("Opens /company/"), its
 * actions (*New menu item*, ⋮ with *Entry page…*, *Rename*, *Move…*, *Hide from menu* / *Show in menu* and *Delete…*), its
 * **entry page** line (the child opened when the folder itself is clicked in the menu — its name and the page it leads to,
 * or "None — grouping only" — with a *Change…* button that asks the area to open the entry-page drawer) and a table of what
 * lies directly inside, in menu order — label (with a ☆ that shows on hover or focus and stays while it is a favorite, and
 * an *Entry page* badge), target page, public URL and **Visible in menu** (sortable; hidden rows are muted). Selecting rows
 * offers *Move…*, *Show in menu*, *Hide from menu* and *Delete*. The fixed "All navigation" wrapper is a folder view too:
 * only its entry page and its items can be changed. What opening, creating, moving, hiding and deleting mean is the
 * Navigation area's business; the data comes from there too.
 */
@Component({
  selector: 'sf-nav-folder-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAssetFavoriteComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfStatusComponent,
    TranslocoPipe,
  ],
  templateUrl: './nav-folder-view.component.html',
  styleUrl: './nav-folder-view.component.scss',
})
export class NavFolderViewComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly permissions = inject(ProjectPermissionsStore);
  protected readonly canEdit = this.permissions.canEditContent;
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  readonly projectKey = input.required<string>();
  /** The open folder. */
  readonly folder = input.required<NavEntry>();
  readonly index = input.required<NavIndex>();
  readonly urls = input<NavUrls>(new Map());
  readonly loading = input(false);
  readonly failed = input(false);

  readonly openEntry = output<string>();
  readonly newItem = output<void>();
  readonly rename = output<string>();
  readonly moveEntries = output<readonly NavEntry[]>();
  readonly copyEntries = output<readonly NavEntry[]>();
  readonly deleteEntries = output<readonly NavEntry[]>();
  readonly retry = output<void>();
  /** *Release…* on the selected rows (a folder with everything inside it): the area opens the release dialog. */
  readonly releaseEntries = output<readonly NavEntry[]>();
  /**
   * The context menu of one row, as the area builds it (the same entries as the tree's menu for that entry). Without it
   * (or for a selection of several rows) a right click offers the bulk actions.
   */
  readonly entryMenu = input<((entry: NavEntry) => ContextMenuItem[]) | null>(null);
  /** *Entry page…* (the ⋮ menu) and the line's *Change…*: the area opens the entry-page drawer for this folder. */
  readonly changeEntry = output<NavEntry>();
  /** *Show in menu* / *Hide from menu* on rows, or on the folder itself from its ⋮ menu. */
  readonly setVisible = output<NavVisibilityRequest>();

  /** The wrapper: its name, UID, place and visibility are fixed. */
  protected readonly isRoot = computed(() => this.folder().protectedFolder);

  private readonly entryUuid = computed(() => this.folder().entry?.uuid ?? null);

  protected readonly rows = computed<NavRow[]>(() => {
    const entryUuid = this.entryUuid();
    return navChildren(this.index(), this.folder().uuid).map((entry) => ({
      entry,
      targetName: entry.targetName,
      url: entryUrl(entry, this.urls()),
      isEntryPage: entry.uuid === entryUuid,
    }));
  });
  /** The child that is the entry page, as the line shows it; `null` for none (or one that is no longer in the folder). */
  protected readonly entryChild = computed(() => {
    const uuid = this.entryUuid();
    return uuid ? (navChildren(this.index(), this.folder().uuid).find((entry) => entry.uuid === uuid) ?? null) : null;
  });
  /** The page the entry page leads to (the folder's own resolved page). */
  protected readonly entryTarget = computed(() => this.folder().targetName);
  /** Where the folder leads: its entry page's public URL. */
  protected readonly folderUrl = computed(() => entryUrl(this.folder(), this.urls()));
  protected readonly subtitle = computed(() => {
    const url = this.folderUrl();
    return url ? this.transloco.translate('navigation.folder.folderUrl', { url }) : null;
  });

  protected readonly rowKey = (row: NavRow): string => row.entry.uuid;
  protected readonly rowLabel = (row: NavRow): string => row.entry.label;
  protected readonly columns = computed<SfDataTableColumn<NavRow>[]>(() => {
    const t = (id: string) => this.transloco.translate(`navigation.folder.columns.${id}`);
    return [
      { id: 'label', header: t('label'), value: (row) => row.entry.label, hideable: false, width: 240 },
      { id: 'target', header: t('target'), value: (row) => row.targetName ?? '', width: 200 },
      { id: 'url', header: t('url'), value: (row) => row.url ?? '', width: 240 },
      { id: 'visible', header: t('visible'), value: (row) => (row.entry.visible ? 1 : 0), sortable: true, width: 170 },
    ];
  });

  /**
   * A right click on a row: *Open* and the tree's menu for that entry (one row); on a selection of several rows the bulk
   * actions, acting on that selection.
   */
  protected readonly rowMenu = (rows: NavRow[]): ContextMenuItem[] => {
    if (rows.length !== 1) {
      return bulkActionsAsMenu(this.bulkActions(), rows, this.rowKey);
    }
    const open: ContextMenuItem = {
      label: this.transloco.translate('shared.dataTable.open'),
      icon: 'open_in_new',
      shortcut: 'Enter',
      action: () => this.openEntry.emit(rows[0].entry.uuid),
    };
    const build = this.entryMenu();
    return build ? [open, { label: '', separator: true }, ...build(rows[0].entry)] : [open, ...bulkActionsAsMenu(this.bulkActions(), rows, this.rowKey)];
  };

  /** A right click on empty space acts as one on the open folder: only the *New …* option. */
  protected readonly emptyMenu = (): ContextMenuItem[] =>
    this.canEdit() ? [{ label: this.transloco.translate('navigation.tree.newMenuItem'), icon: 'add_link', action: () => this.newItem.emit() }] : [];

  protected readonly bulkActions = computed<SfDataTableBulkAction<NavRow>[]>(() => {
    const t = (id: string) => this.transloco.translate(`navigation.folder.bulk.${id}`);
    const edit = this.canEdit();
    const actions: SfDataTableBulkAction<NavRow>[] = [];
    if (edit) {
      actions.push({ id: 'move', label: t('move'), icon: 'drive_file_move', action: (selection) => this.moveEntries.emit(selection.rows.map((row) => row.entry)) });
    }
    if (edit) {
      actions.push({ id: 'copy', label: t('copy'), icon: 'content_copy', action: (selection) => this.copyEntries.emit(selection.rows.map((row) => row.entry)) });
    }
    if (this.permissions.canRelease()) {
      actions.push({ id: 'release', label: t('release'), icon: 'publish', action: (selection) => this.releaseEntries.emit(selection.rows.map((row) => row.entry)) });
    }
    if (edit) {
      actions.push(
        { id: 'show', label: t('show'), icon: 'visibility', action: (selection) => this.setVisible.emit({ entries: selection.rows.map((row) => row.entry), visible: true }) },
        { id: 'hide', label: t('hide'), icon: 'visibility_off', action: (selection) => this.setVisible.emit({ entries: selection.rows.map((row) => row.entry), visible: false }) },
        { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: (selection) => this.deleteEntries.emit(selection.rows.map((row) => row.entry)) },
      );
    }
    return actions;
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (id: string) => this.transloco.translate(`navigation.folder.menu.${id}`);
    const disabled = !this.canEdit();
    const entry: SfMenuItem = { id: 'entry', label: t('entryPage'), icon: 'login', disabled };
    if (this.isRoot()) {
      return [entry];
    }
    const visible = this.folder().visible;
    return [
      entry,
      { id: 'rename', label: t('rename'), icon: 'edit', shortcut: 'F2', disabled, separatorBefore: true },
      { id: 'move', label: t('move'), icon: 'drive_file_move', disabled },
      visible
        ? { id: 'hide', label: t('hide'), icon: 'visibility_off', disabled }
        : { id: 'show', label: t('show'), icon: 'visibility', disabled },
      { id: 'delete', label: t('delete'), icon: 'delete', danger: true, separatorBefore: true, disabled },
    ];
  });

  constructor() {
    // The frame's breadcrumb ends with the open folder, with the folders above it as links.
    useFrameItem(() => {
      const folder = this.folder();
      return { label: folder.label, trail: navTrail(this.index(), folder.uuid, this.projectKey()), asset: { uuid: folder.uuid } };
    });

    inject(ShortcutService).use([
      {
        id: 'navigationFolder.rename',
        keys: 'F2',
        scope: 'screen',
        group: 'screen',
        description: 'navigation.folder.menu.rename',
        enabled: () => this.canEdit() && !this.isRoot(),
        handler: () => this.rename.emit(this.folder().uuid),
      },
    ]);
  }

  protected pathOf(entry: NavEntry): string {
    return entryFolderPath(this.index(), entry);
  }

  protected onMenu(item: SfMenuItem): void {
    switch (item.id) {
      case 'entry':
        this.changeEntry.emit(this.folder());
        break;
      case 'hide':
      case 'show':
        this.setVisible.emit({ entries: [this.folder()], visible: item.id === 'show' });
        break;
      case 'rename':
        this.rename.emit(this.folder().uuid);
        break;
      case 'move':
        this.moveEntries.emit([this.folder()]);
        break;
      case 'delete':
        this.deleteEntries.emit([this.folder()]);
        break;
    }
  }
}
