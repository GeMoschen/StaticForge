import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import {
  SfDataTableBulkAction,
  SfDataTableColumn,
  SfDataTableSelection,
} from '../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { SAMPLE_LANGS, SampleEntry, childrenOf } from './sample-data';
import { STATUS_ICONS, STATUS_TONES, SampleState } from './sample-state';

/**
 * The folder view (M35.18): page header with the folder's actions, and a table of its children with status per
 * language, who changed what when, multi-select and bulk actions. Nothing is changed: Delete confirms and offers Undo.
 */
@Component({
  selector: 'sf-sample-folder-view',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-folder-view.component.html',
  styleUrl: './sample-folder-view.component.scss',
})
export class SampleFolderViewComponent {
  protected readonly state = inject(SampleState);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly table = viewChild.required<SfDataTableComponent<SampleEntry>>(SfDataTableComponent);

  protected readonly langs = SAMPLE_LANGS;
  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  private readonly now = Date.now();

  protected readonly title = computed(() => this.state.folder()?.name ?? this.state.t('rail.pages'));
  protected readonly rows = computed(() => childrenOf(this.state.folderId()));
  protected readonly rowKey = (row: SampleEntry) => row.id;
  protected readonly rowLabel = (row: SampleEntry) => row.name;

  protected readonly columns = computed<SfDataTableColumn<SampleEntry>[]>(() => {
    const header = (id: string) => this.state.t(`folder.columns.${id}`);
    const columns: SfDataTableColumn<SampleEntry>[] = [
      { id: 'name', header: header('name'), value: (r) => r.name, sortable: true, hideable: false, width: 250 },
      { id: 'template', header: header('template'), value: (r) => r.template ?? '', sortable: true, width: 120 },
      { id: 'status', header: header('status'), value: (r) => r.status.de, width: 128 },
      { id: 'modified', header: header('modified'), value: (r) => r.modifiedMinutes, sortable: true, width: 150 },
      { id: 'released', header: header('released'), value: (r) => r.releasedMinutes ?? Number.MAX_SAFE_INTEGER, sortable: true, width: 120 },
    ];
    if (this.state.devMode()) {
      columns.push({ id: 'url', header: header('url'), value: (r) => r.url, width: 200 });
    }
    return columns;
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<SampleEntry>[]>(() => [
    { id: 'move', label: this.state.t('folder.bulk.move'), icon: 'drive_file_move', action: () => this.state.notice() },
    { id: 'release', label: this.state.t('folder.bulk.release'), icon: 'publish', action: () => this.state.notice() },
    { id: 'duplicate', label: this.state.t('folder.bulk.duplicate'), icon: 'content_copy', action: () => this.state.notice() },
    { id: 'delete', label: this.state.t('folder.bulk.delete'), icon: 'delete', variant: 'danger', action: (s) => void this.delete(s) },
  ]);

  protected readonly moreActions = computed<SfMenuItem[]>(() => [
    ...(this.state.folderId() === null
      ? []
      : [
          {
            id: 'favorite',
            label: this.state.t(this.state.isFavorite(this.state.folderId()!) ? 'favorites.remove' : 'favorites.add'),
            icon: 'star',
          },
        ]),
    { id: 'settings', label: this.state.t('folder.settings'), icon: 'settings' },
    { id: 'rename', label: this.state.t('folder.rename'), icon: 'edit', shortcut: 'F2' },
    { id: 'move', label: this.state.t('folder.move'), icon: 'drive_file_move' },
    { id: 'copyLink', label: this.state.t('folder.copyLink'), icon: 'link' },
    { id: 'delete', label: this.state.t('folder.delete'), icon: 'delete', danger: true, separatorBefore: true },
  ]);

  constructor() {
    // The scripted `view=folder` state: select the fixed rows once the table is there.
    afterNextRender(() => {
      const keys = this.state.preselect();
      if (keys.length === 0) {
        return;
      }
      this.table().selectKeys(keys);
      this.state.preselect.set([]);
    });
  }

  protected open(row: SampleEntry): void {
    if (row.kind === 'folder') {
      this.state.openFolder(row.id);
    } else {
      this.state.openPage(row.id);
    }
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }

  protected newItem(kind: 'page' | 'folder'): void {
    this.state.notice(kind === 'page' ? 'folder.newPageNotice' : 'folder.newFolderNotice');
  }

  protected async releaseFolder(): Promise<void> {
    const name = this.title();
    const confirmed = await this.confirms.confirm({
      title: this.state.t('folder.releaseTitle', { name }),
      message: this.state.t('folder.releaseMessage', { count: this.rows().length }),
      confirmLabel: this.state.t('folder.releaseConfirm'),
    });
    if (confirmed) {
      this.toasts.show(this.state.t('folder.releaseDone', { name }), 'success');
    }
  }

  protected secondary(item: SfMenuItem): void {
    if (item.id === 'favorite') {
      this.state.toggleFavorite(this.state.folderId()!);
    } else if (item.id === 'delete') {
      void this.deleteEntries([this.title()]);
    } else {
      this.state.notice();
    }
  }

  private delete(selection: SfDataTableSelection<SampleEntry>): Promise<void> {
    return this.deleteEntries(selection.rows.map((row) => row.name), () => this.table().clearSelection());
  }

  private async deleteEntries(names: readonly string[], done?: () => void): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.state.t('folder.deleteTitle', { count: names.length, name: names[0] }),
      message: this.state.t('folder.deleteMessage'),
      confirmLabel: this.state.t('folder.deleteConfirm', { count: names.length }),
      tone: 'danger',
      details: names,
    });
    if (!confirmed) {
      return;
    }
    done?.();
    this.toasts.undo(this.state.t('folder.deleted', { count: names.length, name: names[0] }), () =>
      this.toasts.show(this.state.t('folder.restored'), 'info'),
    );
  }
}
