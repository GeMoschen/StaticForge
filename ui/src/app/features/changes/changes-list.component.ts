import { ChangeDetectionStrategy, Component, computed, effect, inject, output, untracked, viewChild } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfDataTableBulkAction, SfDataTableColumn, SfDataTableSelection } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfCopyableComponent } from '../../shared/components/display/sf-copyable.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent, type SfStatusTone } from '../../shared/components/display/sf-status.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../shared/directives/sf-tooltip.directive';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { scheduledFor, statusIcon } from '../release/release-status.util';
import { formatInstant } from '../schedules/zoned-time.util';
import { CHANGE_TYPES, typeIcon } from './changes-query.util';
import { type ChangeRowView, ChangesStore } from './changes.store';

const TONES: Readonly<Record<string, SfStatusTone | undefined>> = {
  NEW: 'info',
  CHANGED: 'warning',
  UNPUBLISHED: 'neutral',
  DELETION_PENDING: 'danger',
};

/**
 * The table of unreleased (asset, language) rows (M35.23, gate decision 26): an `sf-data-table` in server mode — the
 * page the URL names, one row per language, the default language first — with selection and the bulk Release /
 * Schedule / Discard buttons, and its own pager. A row opens its diff (`currentKey` highlights it).
 *
 * <p>The selection lives in {@link ChangesStore}: the table is re-created when the diff pane opens or closes, and
 * follows the store's keys again. Row keyboard (↑/↓, Space, Enter, Shift+↑/↓, Ctrl+A) is the table's.
 */
@Component({
  selector: 'sf-changes-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfAvatarComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTooltipDirective,
  ],
  templateUrl: './changes-list.component.html',
  styleUrl: './changes-list.component.scss',
})
export class ChangesListComponent {
  protected readonly store = inject(ChangesStore);
  protected readonly members = inject(ProjectMembersStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  protected readonly dev = inject(DeveloperModeService).enabled;
  private readonly transloco = inject(TranslocoService);

  /** The selected rows to release, schedule or discard (the page opens the dialogs). */
  readonly release = output<readonly ChangeRowView[]>();
  readonly schedule = output<readonly ChangeRowView[]>();
  readonly discard = output<readonly ChangeRowView[]>();

  private readonly table = viewChild(SfDataTableComponent<ChangeRowView>);

  protected readonly typeIcon = typeIcon;
  protected readonly toneOf = (status: string | null | undefined): SfStatusTone => TONES[status ?? ''] ?? 'neutral';
  protected readonly statusIcon = statusIcon;
  protected readonly name = (row: ChangeRowView) => row.displayName || row.uid || this.t('page.untitled');

  protected readonly columns = computed<SfDataTableColumn<ChangeRowView>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    const columns: SfDataTableColumn<ChangeRowView>[] = [
      { id: 'name', header: header('name'), value: (r) => this.name(r), hideable: false, width: 280 },
    ];
    if (this.store.locales.isLocalized()) {
      columns.push({ id: 'lang', header: header('lang'), value: (r) => r.locale, width: 130 });
    }
    columns.push(
      { id: 'status', header: header('status'), value: (r) => r.status, width: 160 },
      { id: 'changed', header: header('changed'), value: (r) => r.changedAt, width: 230 },
      { id: 'released', header: header('released'), value: (r) => r.releasedAt, width: 130 },
    );
    if (this.dev()) {
      columns.push({ id: 'folder', header: header('folder'), value: (r) => this.folderText(r), width: 220 });
    }
    return columns;
  });

  protected readonly bulkActions = computed<SfDataTableBulkAction<ChangeRowView>[]>(() => {
    const actions: SfDataTableBulkAction<ChangeRowView>[] = [
      { id: 'release', label: this.t('bulk.release'), icon: 'publish', variant: 'primary', action: (s) => this.release.emit(s.rows) },
    ];
    if (this.permissions.canScheduleRelease()) {
      actions.push({ id: 'schedule', label: this.t('bulk.schedule'), icon: 'schedule', action: (s) => this.schedule.emit(s.rows) });
    }
    const nothingToDiscard = this.store.discardable().length === 0;
    actions.push({
      id: 'discard',
      label: this.t('bulk.discard'),
      icon: 'undo',
      variant: 'danger-ghost',
      disabled: nothingToDiscard,
      disabledReason: nothingToDiscard ? this.t('page.discardNothing') : null,
      action: (s) => this.discard.emit(s.rows),
    });
    return actions;
  });

  protected readonly rowKey = (row: ChangeRowView) => this.store.keyOf(row);
  protected readonly rowLabel = (row: ChangeRowView) => (row.locale ? `${this.name(row)} (${row.locale.toUpperCase()})` : this.name(row));

  constructor() {
    // The table follows the store's selection: a restore after the table was re-created, and the clear after a re-read.
    effect(() => {
      const table = this.table();
      const keys = this.store.selectedKeys();
      if (table) {
        untracked(() => table.selectKeys(keys));
      }
    });
  }

  protected onSelection(selection: SfDataTableSelection<ChangeRowView>): void {
    this.store.setSelection(selection.keys, selection.rows);
  }

  protected statusText(status: string | null | undefined): string {
    return this.transloco.translate(`enum.releaseStatus.${status}`);
  }

  protected langName(locale: string): string {
    return this.store.localeLabels()[locale] || locale;
  }

  protected isDefault(locale: string | null | undefined): boolean {
    return !!locale && locale === this.store.locales.defaultLocale();
  }

  protected knownType(type: string | null | undefined): boolean {
    return CHANGE_TYPES.some((t) => t.value === type);
  }

  protected typeName(type: string | null | undefined): string {
    return this.knownType(type) ? this.transloco.translate(`enum.assetType.${type}`) : (type ?? '');
  }

  /** The clock beside the status: what is scheduled for this language, "Release scheduled for 14 Oct, 09:00". */
  protected scheduledText(row: ChangeRowView): string {
    return scheduledFor(row.scheduled, row.locale)
      .map((ref) =>
        this.t('page.scheduledFor', {
          kind: this.transloco.translate(`release.schedule.kinds.${ref.type}`),
          time: formatInstant(ref.nextRunAt ?? ref.runAt),
        }),
      )
      .join('; ');
  }

  protected folderText(row: ChangeRowView): string {
    // Stored paths start with the store root (`/pages_root/about/`): show the part below it.
    const segments = (row.folderPath ?? '').split('/').filter((s) => s.length > 0);
    return segments.length > 1 ? `/${segments.slice(1).join('/')}/` : '/';
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`changes.${key}`, params);
  }
}
