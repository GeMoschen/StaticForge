import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfDrawerComponent } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfFilterPopoverComponent, type SfFilterGroup } from '../../../../shared/components/filter/sf-filter-popover.component';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent, SfMenuItem } from '../../../../shared/components/menu/sf-menu.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfDateTimePipe } from '../../../../shared/pipes/sf-date-time.pipe';
import {
  SCHEDULES,
  SCHEDULE_KINDS,
  SCHEDULE_KIND_ICONS,
  SCHEDULE_STATUS_ICONS,
  SCHEDULE_STATUS_TONES,
  SampleSchedule,
  ScheduleKind,
  ScheduleStatus,
} from './changes-data';
import { SampleScheduleDialogComponent } from './sample-schedule-dialog.component';
import { injectSampleNotice, injectSampleQuery, injectSampleText, minutesAgo, oneOf } from './sample-area.util';

/**
 * The sample's Schedules area (M35.9 decision 26, M35.23): `sf-page-header` with **New schedule** (a menu: release,
 * unpublish, generation) and an `sf-data-table` of the schedules — kind, what, when (with its time zone), repeat,
 * owner, status and a ⋮ menu per row (Edit, Run now, History, Cancel → confirm). A row (or History) opens its history
 * in an `sf-drawer` with a full title.
 *
 * Query parameters: `schedule=1|release|unpublish|generation` opens the schedule dialog with that kind (`1` =
 * release); written back while it is open, removed when the area closes.
 */
@Component({
  selector: 'sf-sample-schedules-area',
  standalone: true,
  imports: [
    SampleScheduleDialogComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfDateTimePipe,
    SfButtonComponent,
    SfDrawerComponent,
    SfFilterPopoverComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfStatusComponent,
    SfTagComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-schedules-area.component.html',
  styleUrl: './sample-schedules-area.component.scss',
})
export class SampleSchedulesAreaComponent {
  protected readonly t = injectSampleText('styleguide.sample.changes.schedules');
  private readonly query = injectSampleQuery();
  private readonly notice = injectSampleNotice();
  private readonly confirms = inject(ConfirmService);
  private readonly now = Date.now();

  protected readonly kindIcons = SCHEDULE_KIND_ICONS;
  protected readonly statusTones = SCHEDULE_STATUS_TONES;
  protected readonly statusIcons = SCHEDULE_STATUS_ICONS;

  protected readonly schedules = signal<readonly SampleSchedule[]>(SCHEDULES);
  protected readonly dialog = signal<{ readonly kind: ScheduleKind; readonly subject: string | null } | null>(null);
  protected readonly historyOf = signal<SampleSchedule | null>(null);

  private readonly statuses = Object.keys(SCHEDULE_STATUS_TONES) as ScheduleStatus[];
  /** One value per filter, like the real list. */
  protected readonly picked = signal<{ type?: string; status?: string; owner?: string }>({});
  protected readonly pickedGroups = computed(() => ({
    type: this.picked().type ? [this.picked().type!] : [],
    status: this.picked().status ? [this.picked().status!] : [],
  }));
  protected readonly filterGroups = computed<SfFilterGroup[]>(() => [
    { id: 'type', label: this.t('filters.type'), options: SCHEDULE_KINDS.map((k) => ({ value: k, label: this.t(`kinds.${k}`) })) },
    { id: 'status', label: this.t('filters.status'), options: this.statuses.map((s) => ({ value: s, label: this.t(`statuses.${s}`) })) },
  ]);
  private readonly owners = [...new Map(SCHEDULES.map((s) => [s.owner.name, s.owner.name])).values()];
  protected readonly ownerItems = computed<SfMenuItem[]>(() => [
    { id: '', label: this.t('filters.anyOwner'), icon: this.picked().owner ? undefined : 'check', action: () => this.setFilter('owner', null) },
    ...this.owners.map((name, i) => ({
      id: name,
      label: name,
      icon: this.picked().owner === name ? 'check' : undefined,
      separatorBefore: i === 0,
      action: () => this.setFilter('owner', name),
    })),
  ]);
  protected readonly ownerText = computed(() =>
    this.picked().owner ? this.t('filters.picked', { filter: this.t('filters.owner'), value: this.picked().owner }) : this.t('filters.owner'),
  );
  protected readonly chips = computed(() =>
    (['type', 'status', 'owner'] as const).flatMap((key) => {
      const value = this.picked()[key];
      if (!value) {
        return [];
      }
      const shown = key === 'owner' ? value : this.t(`${key === 'type' ? 'kinds' : 'statuses'}.${value}`);
      return [{ key, label: this.t('filters.picked', { filter: this.t(`filters.${key}`), value: shown }) }];
    }),
  );
  protected readonly visible = computed(() => {
    const { type, status, owner } = this.picked();
    return this.schedules().filter((s) => (!type || s.kind === type) && (!status || s.status === status) && (!owner || s.owner.name === owner));
  });

  protected readonly newItems = computed<SfMenuItem[]>(() =>
    SCHEDULE_KINDS.map((kind) => ({
      id: kind,
      label: this.t(`new.${kind}`),
      icon: SCHEDULE_KIND_ICONS[kind],
      description: this.t(`new.${kind}Hint`),
      action: () => this.dialog.set({ kind, subject: null }),
    })),
  );

  protected readonly columns = computed<SfDataTableColumn<SampleSchedule>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      { id: 'kind', header: header('kind'), value: (r) => r.kind, width: 140 },
      { id: 'what', header: header('what'), value: (r) => r.what, hideable: false, width: 280 },
      { id: 'when', header: header('when'), value: (r) => r.inMinutes, width: 250 },
      { id: 'repeat', header: header('repeat'), value: (r) => r.repeat ?? '', width: 150 },
      { id: 'owner', header: header('owner'), value: (r) => r.owner.name, width: 170 },
      { id: 'status', header: header('status'), value: (r) => r.status, width: 130 },
      { id: 'actions', header: header('actions'), hideable: false, searchable: false, width: 64, align: 'end' },
    ];
  });

  protected readonly rowKey = (row: SampleSchedule) => row.id;
  protected readonly rowLabel = (row: SampleSchedule) => row.what;

  constructor() {
    const open = this.query.get('schedule');
    const kind = open === '1' ? 'release' : oneOf(open, SCHEDULE_KINDS);
    if (kind) {
      this.dialog.set({ kind, subject: null });
    }
    effect(() => this.query.set({ schedule: this.dialog()?.kind ?? null }));
    inject(DestroyRef).onDestroy(() => this.query.set({ schedule: null }));
  }

  protected rowActions(row: SampleSchedule): SfMenuItem[] {
    const pending = row.status === 'pending';
    const cancellable = pending || row.status === 'paused';
    return [
      { id: 'edit', label: this.t('actions.edit'), icon: 'edit', disabled: !pending, action: () => this.edit(row) },
      { id: 'run', label: this.t('actions.runNow'), icon: 'play_arrow', disabled: !pending, action: () => this.notice(this.t('ranNow', { what: row.what })) },
      { id: 'history', label: this.t('actions.history'), icon: 'history', action: () => this.historyOf.set(row) },
      {
        id: 'cancel',
        label: this.t('actions.cancel'),
        icon: 'block',
        danger: true,
        separatorBefore: true,
        disabled: !cancellable,
        action: () => void this.cancel(row),
      },
    ];
  }

  protected setFilter(key: 'type' | 'status' | 'owner', value: string | null): void {
    this.picked.update((p) => ({ ...p, [key]: value ?? undefined }));
  }

  protected toggleFilter(group: string, value: string): void {
    const key = group as 'type' | 'status';
    this.setFilter(key, this.picked()[key] === value ? null : value);
  }

  protected clearFilters(): void {
    this.picked.set({});
  }

  protected at(row: SampleSchedule): number {
    return this.now + row.inMinutes * 60_000;
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.now);
  }

  private edit(row: SampleSchedule): void {
    this.dialog.set({ kind: row.kind, subject: row.kind === 'generation' ? null : row.what });
  }

  private async cancel(row: SampleSchedule): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('cancelTitle', { what: row.what }),
      message: this.t(`cancelMessage.${row.kind}`),
      confirmLabel: this.t('cancelConfirm'),
      cancelLabel: this.t('keep'),
      tone: 'danger',
    });
    if (confirmed) {
      this.schedules.update((list) => list.map((s) => (s.id === row.id ? { ...s, status: 'cancelled' as const } : s)));
      this.notice(this.t('cancelled', { what: row.what }));
    }
  }
}
