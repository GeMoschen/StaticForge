import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import type { SfDataTableBulkAction, SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfSelectComponent, type SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import type { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfAssetFavoriteComponent } from '../../shared/components/sf-asset-favorite.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { type NavEntry, type NavIndex, type NavUrls, entryFolderPath, entryUrl, navChildren, navTrail } from './navigation-tree.util';
import { NavigationService, etagFor } from './navigation.service';

/** A row of a menu folder's table. */
export interface NavRow {
  readonly entry: NavEntry;
  readonly targetName: string | null;
  readonly url: string | null;
  readonly isEntryPage: boolean;
}

/** The entry page as the select holds it: `<kind>:<uuid>` (a child item or a child folder), `''` for none. */
const NONE = '';

/**
 * A menu folder (M35.22, decision 24): a page header with the folder's name and where it leads ("Opens /company/"), its
 * actions (*New menu item*, ⋮ with *Rename*, *Move…* and *Delete…*), its **entry page** (the item opened when the folder
 * itself is clicked in the menu) and a table of what lies directly inside, in menu order — label (with a ☆ that shows on
 * hover or focus and stays while it is a favorite, and an *Entry page* badge), target page, public URL. Selecting rows
 * offers *Move…* and *Delete*. What opening, creating, moving and deleting mean is the Navigation area's business; the
 * data comes from there too.
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
    SfFieldComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfSelectComponent,
    TranslocoPipe,
  ],
  templateUrl: './nav-folder-view.component.html',
  styleUrl: './nav-folder-view.component.scss',
})
export class NavFolderViewComponent {
  private readonly api = inject(ApiClient);
  private readonly nav = inject(NavigationService);
  private readonly undo = inject(UndoService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly canEdit = inject(ProjectPermissionsStore).canEditContent;
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
  readonly deleteEntries = output<readonly NavEntry[]>();
  readonly retry = output<void>();
  /** The folder's entry page changed: the menu reads again. */
  readonly changed = output<void>();

  /** The folder's stored entry page (`<kind>:<uuid>`), read from the folder; `undefined` until it is. */
  private readonly storedEntry = signal<string | undefined>(undefined);
  protected readonly savingEntry = signal(false);

  protected readonly entryValue = computed(() => this.storedEntry() ?? NONE);
  private readonly entryUuid = computed(() => {
    const value = this.entryValue();
    return value === NONE ? null : value.slice(value.indexOf(':') + 1);
  });

  protected readonly rows = computed<NavRow[]>(() => {
    const entryUuid = this.entryUuid();
    return navChildren(this.index(), this.folder().uuid).map((entry) => ({
      entry,
      targetName: entry.targetName,
      url: entryUrl(entry, this.urls()),
      isEntryPage: entry.uuid === entryUuid,
    }));
  });
  protected readonly entryOptions = computed<SfSelectOption<string>[]>(() =>
    navChildren(this.index(), this.folder().uuid).map((entry) => ({
      value: `${entry.kind === 'item' ? 'PAGE_REFERENCE' : 'FOLDER'}:${entry.uuid}`,
      label: entry.label,
    })),
  );
  /** Where the folder leads: its entry page's public URL. */
  protected readonly folderUrl = computed(() => entryUrl(this.folder(), this.urls()));
  protected readonly subtitle = computed(() => {
    const url = this.folderUrl();
    return url ? this.transloco.translate('navigation.folderUrl', { url }) : null;
  });

  protected readonly rowKey = (row: NavRow): string => row.entry.uuid;
  protected readonly rowLabel = (row: NavRow): string => row.entry.label;
  protected readonly columns = computed<SfDataTableColumn<NavRow>[]>(() => {
    const t = (id: string) => this.transloco.translate(`navigation.columns.${id}`);
    return [
      { id: 'label', header: t('label'), value: (row) => row.entry.label, hideable: false, width: 240 },
      { id: 'target', header: t('target'), value: (row) => row.targetName ?? '', width: 200 },
      { id: 'url', header: t('url'), value: (row) => row.url ?? '', width: 240 },
    ];
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<NavRow>[]>(() => {
    if (!this.canEdit()) {
      return [];
    }
    const t = (id: string) => this.transloco.translate(`navigation.bulk.${id}`);
    return [
      { id: 'move', label: t('move'), icon: 'drive_file_move', action: (selection) => this.moveEntries.emit(selection.rows.map((row) => row.entry)) },
      { id: 'delete', label: t('delete'), icon: 'delete', variant: 'danger', action: (selection) => this.deleteEntries.emit(selection.rows.map((row) => row.entry)) },
    ];
  });

  protected readonly moreActions = computed<SfMenuItem[]>(() => {
    const t = (id: string) => this.transloco.translate(`navigation.menu.${id}`);
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
      return { label: folder.label, trail: navTrail(this.index(), folder.uuid, this.projectKey()), asset: { uuid: folder.uuid } };
    });

    inject(ShortcutService).use([
      {
        id: 'navigationFolder.rename',
        keys: 'F2',
        scope: 'screen',
        group: 'screen',
        description: 'navigation.menu.rename',
        enabled: () => this.canEdit(),
        handler: () => this.rename.emit(this.folder().uuid),
      },
    ]);

    // The entry page is a field of the folder itself: read it when another folder opens or this one changed.
    effect(() => {
      const uuid = this.folder().uuid;
      this.folder().revision;
      untracked(() => void this.readEntry(uuid));
    });
  }

  protected pathOf(entry: NavEntry): string {
    return entryFolderPath(this.index(), entry);
  }

  protected onMenu(item: SfMenuItem): void {
    switch (item.id) {
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

  // ── Entry page ─────────────────────────────────────────────────────────────

  protected async setEntry(value: string | null | undefined): Promise<void> {
    const next = value ?? NONE;
    const before = this.entryValue();
    if (next === before || this.savingEntry() || !this.canEdit()) {
      return;
    }
    const key = this.projectKey();
    const uuid = this.folder().uuid;
    const write = (target: string, revision: number | null) => {
      const [kind, assetUuid] = target === NONE ? [null, null] : [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
      return firstValueFrom(
        this.nav.updateFolder(
          key,
          uuid,
          { startNode: kind ? { kind: kind as 'PAGE_REFERENCE' | 'FOLDER', assetUuid: assetUuid! } : null },
          revision == null ? undefined : etagFor(revision),
        ),
      );
    };
    this.savingEntry.set(true);
    try {
      const updated = await write(next, this.folder().revision);
      this.storedEntry.set(next);
      const name = this.entryOptions().find((option) => option.value === next)?.label ?? '';
      const message = this.transloco.translate(next === NONE ? 'navigation.toast.entryCleared' : 'navigation.toast.entrySet', { name });
      // Undo writes the previous entry page back, against the revision this write produced.
      this.undo.offer(message, () =>
        write(before, updated.revision ?? null).then(() => {
          this.storedEntry.set(before);
          this.changed.emit();
        }),
      );
      this.changed.emit();
    } catch {
      this.toasts.show(this.transloco.translate('navigation.toast.entryFailed'), 'error');
      await this.readEntry(uuid);
    } finally {
      this.savingEntry.set(false);
    }
  }

  private async readEntry(uuid: string): Promise<void> {
    try {
      const detail = await firstValueFrom(this.api.assetDetail(this.projectKey(), uuid));
      if (this.folder().uuid !== uuid) {
        return;
      }
      const start = (detail.payload as { startNode?: { kind?: string; assetUuid?: string } | null } | undefined)?.startNode;
      this.storedEntry.set(start?.kind && start.assetUuid ? `${start.kind}:${start.assetUuid}` : NONE);
    } catch {
      this.storedEntry.set(undefined);
    }
  }
}
