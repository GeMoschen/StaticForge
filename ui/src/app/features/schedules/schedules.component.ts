import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ActivatedRoute, Router } from '@angular/router';
import { type Observable, type Subscription, catchError, forkJoin, map, of } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { createShortcut } from '../../core/ui/documented-shortcuts';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfStatusComponent, type SfStatusTone } from '../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../shared/components/display/sf-tag.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { type SfMenuItem, toContextItems } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { GenerationService } from '../generation/generation.service';
import { type ReleaseChoice } from '../release/release-choice.util';
import { ReleaseEventsStore } from '../release/release-events.store';
import { type ReleaseStatus } from '../release/release-status.util';
import { SearchService } from '../search/search.service';
import { ScheduleDialogComponent } from './schedule-dialog.component';
import { ScheduleHistoryComponent } from './schedule-history.component';
import {
  SCHEDULE_STATUSES,
  SCHEDULE_KINDS,
  type ScheduleType,
  canCancelSchedule,
  canEditSchedule,
  canRepin,
  canRunNow,
  canTakeOver,
  scheduleKind,
  scheduleRepeatText,
  scheduleStatusKey,
  scheduleWhatText,
  typesOfKind,
  showsDrift,
} from './schedule.util';
import { formatInstantWithZone, viewerZone, zoneLabel } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];
type RowAction = 'cancel' | 'take-over' | 'run-now' | 'repin';
type FilterKey = 'type' | 'status' | 'owner';
type NewKind = 'release' | 'unpublish' | 'generation';

const PAGE_SIZE = 50;
/** The most changes / published assets the New schedule picker offers (the API's page caps are 200 and 100). */
const RELEASE_CANDIDATES = 200;
const UNPUBLISH_CANDIDATES = 100;

const KIND_ICONS: Readonly<Record<string, string>> = {
  RELEASE: 'publish',
  UNPUBLISH: 'cloud_off',
  GENERATION: 'build',
};
const NEW_KIND_TYPES: Readonly<Record<NewKind, ScheduleType>> = {
  release: 'RELEASE',
  unpublish: 'UNPUBLISH',
  generation: 'GENERATION',
};
const STATUS_TONES: Readonly<Record<string, SfStatusTone>> = {
  PENDING: 'info',
  RUNNING: 'accent',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  PAUSED: 'warning',
  SKIPPED: 'neutral',
  CANCELLED: 'neutral',
};
const STATUS_ICONS: Readonly<Record<string, string>> = {
  PENDING: 'schedule',
  RUNNING: 'sync',
  SUCCEEDED: 'check_circle',
  FAILED: 'error',
  PAUSED: 'pause_circle',
  SKIPPED: 'skip_next',
  CANCELLED: 'block',
};

interface DialogState {
  schedule: ScheduleView | null;
  types: ScheduleType[];
  choices: ReleaseChoice[];
  unpublishChoices: ReleaseChoice[];
}

/**
 * The Schedules screen (M27.6.5, rebuilt on `sf-data-table` in M35.23, gate decision 26): every scheduled release,
 * unpublish and generation of the project, next due first, as a server-mode table — kind, what (by name), next run,
 * owner, status — with a ⋮ menu per row (History, Re-pin, Edit, Run now, Take over, Cancel → confirm; the same menu on
 * a right click) and the header action *New schedule* (release, unpublish or generation). Type, status and owner filter
 * the list; they, the page and the open history (`?id=`) live in the query string, so a view can be linked. A row (or
 * *History*) opens the schedule's history in an `sf-drawer`.
 */
@Component({
  selector: 'sf-schedules',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScheduleDialogComponent,
    ScheduleHistoryComponent,
    SfAvatarComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfStatusComponent,
    SfTagComponent,
  ],
  templateUrl: './schedules.component.html',
  styleUrl: './schedules.component.scss',
})
export class SchedulesComponent {
  private readonly api = inject(ApiClient);
  private readonly search = inject(SearchService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly confirms = inject(ConfirmService);
  private readonly transloco = inject(TranslocoService);
  private readonly auth = inject(AuthStore);
  private readonly events = inject(ReleaseEventsStore);
  private readonly generation = inject(GenerationService);
  protected readonly members = inject(ProjectMembersStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly dev = inject(DeveloperModeService).enabled;

  readonly projectKey = input.required<string>();
  /** Filters and the open history, bound from the query string. */
  readonly type = input<string | undefined>();
  readonly status = input<string | undefined>();
  readonly owner = input<string | undefined>();
  readonly page = input<string | undefined>();
  readonly id = input<string | undefined>();

  protected readonly viewerZoneLabel = zoneLabel(viewerZone());

  protected readonly rows = signal<ScheduleView[]>([]);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<number | null>(null);
  /** While the content a new release or unpublish can pick from is being read. */
  protected readonly preparing = signal(false);
  /** Where a "then generate" without a target builds — it decides which build permission a release schedule needs. */
  private readonly defaultTargetId = signal<number | null>(null);
  protected readonly dialog = signal<DialogState | null>(null);

  protected readonly pageIndex = computed(() => Math.max(0, Number(this.page() ?? 0) || 0));
  protected readonly historyId = computed(() => (this.id() ? Number(this.id()) : null));
  protected readonly currentKey = computed(() => (this.historyId() === null ? null : String(this.historyId())));
  private readonly currentUserId = this.auth.userId;
  protected readonly hasFilters = computed(() => !!(this.type() || this.status() || this.owner()));
  private readonly query = computed(() => ({ type: this.type(), status: this.status(), owner: this.owner(), page: this.pageIndex() }));

  /** The kinds *New schedule* offers this viewer: release and unpublish with the schedule permission, generation as a developer. */
  private readonly newKinds = computed<NewKind[]>(() => [
    ...(this.permissions.canScheduleRelease() ? (['release', 'unpublish'] as const) : []),
    ...(this.permissions.canScheduleGeneration() ? (['generation'] as const) : []),
  ]);
  protected readonly newItems = computed<SfMenuItem[]>(() =>
    this.newKinds().map((kind) => ({
      id: kind,
      label: this.t(`new.${kind}`),
      icon: KIND_ICONS[NEW_KIND_TYPES[kind]],
      description: this.t(`new.${kind}Hint`),
      disabled: this.preparing(),
      action: () => this.newSchedule(kind),
    })),
  );

  protected readonly columns = computed<SfDataTableColumn<ScheduleView>[]>(() => {
    const header = (id: string) => this.t(`columns.${id}`);
    return [
      { id: 'kind', header: header('kind'), value: (r) => this.kindName(r), width: 190 },
      { id: 'what', header: header('what'), value: (r) => this.what(r), hideable: false, width: 300 },
      { id: 'when', header: header('when'), value: (r) => this.nextRun(r), width: 260 },
      { id: 'repeat', header: header('repeat'), value: (r) => this.repeat(r), width: 200 },
      { id: 'owner', header: header('owner'), value: (r) => this.members.nameOf(r.ownerUserId), width: 170 },
      { id: 'status', header: header('status'), value: (r) => this.statusName(r), width: 200 },
      { id: 'actions', header: header('actions'), hideable: false, searchable: false, width: 64, align: 'end' },
    ];
  });

  protected readonly rowKey = (row: ScheduleView) => String(row.id);
  protected readonly rowLabel = (row: ScheduleView) => this.what(row);
  /** A right click on a row: the row's ⋮ menu. */
  protected readonly rowMenu = (rows: ScheduleView[]) => (rows.length === 1 ? toContextItems(this.rowActions(rows[0])) : []);

  /** The three filters: what they offer and what is picked (one value each, as the URL holds it). */
  private readonly filterOptions = computed<Record<FilterKey, readonly { value: string; label: string }[]>>(() => ({
    type: SCHEDULE_KINDS.map((kind) => ({ value: kind, label: this.transloco.translate(`release.schedule.kinds.${kind}`) })),
    status: SCHEDULE_STATUSES.map((s) => ({
      value: s.value,
      label: s.value === 'FAILED' ? this.t('filters.statusFailed') : this.t(`statuses.${s.value}`),
    })),
    owner: this.members.members().map((m) => ({ value: String(m.userId), label: m.displayName || m.username || String(m.userId) })),
  }));
  private readonly picked = computed<Record<FilterKey, string | undefined>>(() => ({
    type: this.type() || undefined,
    status: this.status() || undefined,
    owner: this.owner() || undefined,
  }));

  protected readonly filterMenus = computed(() =>
    (['type', 'status', 'owner'] as const).map((key) => {
      const chosen = this.picked()[key];
      const name = this.t(`filters.${key}`);
      const items: SfMenuItem[] = [
        { id: '', label: this.t(`filters.any.${key}`), icon: chosen === undefined ? 'check' : undefined, action: () => this.setFilter(key, null) },
        ...this.filterOptions()[key].map((option, i) => ({
          id: option.value,
          label: option.label,
          icon: chosen === option.value ? 'check' : undefined,
          separatorBefore: i === 0,
          action: () => this.setFilter(key, option.value),
        })),
      ];
      return { key, name, items, text: chosen === undefined ? name : this.t('filters.picked', { filter: name, value: this.filterLabel(key, chosen) }) };
    }),
  );
  protected readonly chips = computed(() =>
    (['type', 'status', 'owner'] as const).flatMap((key) => {
      const value = this.picked()[key];
      return value === undefined
        ? []
        : [{ key, label: this.t('filters.picked', { filter: this.t(`filters.${key}`), value: this.filterLabel(key, value) }) }];
    }),
  );

  private request: Subscription | null = null;

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const query = this.query();
      this.events.version();
      untracked(() => {
        this.members.load(key);
        this.load(key, query);
      });
    });
    effect(() => {
      const key = this.projectKey();
      untracked(() =>
        this.generation.listTargets(key).subscribe({
          next: (targets) => this.defaultTargetId.set(((targets ?? []).find((t) => t.isDefault) ?? targets?.[0])?.id ?? null),
          error: () => this.defaultTargetId.set(null),
        }),
      );
    });
    // `n` creates a schedule (M35.14): of the first kind this viewer may.
    inject(ShortcutService).use([
      createShortcut({
        handler: () => {
          const kind = this.newKinds()[0];
          if (!kind) {
            return false;
          }
          this.newSchedule(kind);
          return true;
        },
        enabled: () => this.newKinds().length > 0 && this.dialog() === null,
        palette: { label: 'frame.shortcuts.items.createSchedule' },
      }),
    ]);
  }

  /**
   * The row actions follow the server's rules (M28, epic decision 9): changing a schedule needs what it needs — for a
   * release, `SCHEDULE_RELEASE` and the build permission of its "then generate" — and a developer for someone else's;
   * taking one over needs only what it needs. What the viewer may not do is left out, not greyed.
   */
  protected rowActions(row: ScheduleView): SfMenuItem[] {
    const change = this.permissions.canChangeSchedule(row, this.defaultTargetId());
    const busy = this.busyId() !== null;
    const items: SfMenuItem[] = [{ id: 'history', label: this.t('actions.history'), icon: 'history', action: () => this.openHistory(row) }];
    if (canRepin(row) && change) {
      items.push({ id: 'repin', label: this.t('actions.repin'), icon: 'push_pin', disabled: busy, action: () => void this.act(row, 'repin') });
    }
    if (canEditSchedule(row) && change) {
      items.push({ id: 'edit', label: this.t('actions.edit'), icon: 'edit', action: () => this.edit(row) });
    }
    if (canRunNow(row) && change) {
      items.push({ id: 'run', label: this.t('actions.runNow'), icon: 'play_arrow', disabled: busy, action: () => void this.act(row, 'run-now') });
    }
    if (canTakeOver(row, this.currentUserId()) && this.permissions.satisfiesSchedule(row, this.defaultTargetId())) {
      items.push({ id: 'take', label: this.t('actions.takeOver'), icon: 'person_add', disabled: busy, action: () => void this.act(row, 'take-over') });
    }
    if (canCancelSchedule(row) && change) {
      items.push({
        id: 'cancel',
        label: this.t('actions.cancel'),
        icon: 'block',
        danger: true,
        separatorBefore: true,
        disabled: busy,
        action: () => void this.act(row, 'cancel'),
      });
    }
    return items;
  }

  protected kindIcon(row: ScheduleView): string {
    return KIND_ICONS[scheduleKind(row.type) ?? ''] ?? 'schedule';
  }

  protected kindName(row: ScheduleView): string {
    return this.transloco.translate(`release.schedule.kinds.${scheduleKind(row.type)}`);
  }

  protected repeat(row: ScheduleView): string {
    return scheduleRepeatText(row, (key, params) => this.transloco.translate(key, params));
  }

  protected what(row: ScheduleView): string {
    return scheduleWhatText(row, (key, params) => this.transloco.translate(key, params), this.dev());
  }

  protected statusKey(row: ScheduleView): string {
    return scheduleStatusKey(row);
  }

  protected statusName(row: ScheduleView): string {
    return this.t(`statuses.${scheduleStatusKey(row)}`);
  }

  protected tone(row: ScheduleView): SfStatusTone {
    return STATUS_TONES[scheduleStatusKey(row)] ?? 'neutral';
  }

  protected statusIcon(row: ScheduleView): string {
    return STATUS_ICONS[scheduleStatusKey(row)] ?? 'schedule';
  }

  protected lastOutcome(row: ScheduleView): string {
    const outcome = row.lastExecution?.outcome;
    return outcome ? this.t('page.lastOutcome', { outcome: this.t(`outcomes.${outcome}`) }) : '';
  }

  protected showsDrift = showsDrift;

  protected nextRun(schedule: ScheduleView): string {
    const when = schedule.nextRunAt ?? (schedule.status === 'PENDING' ? schedule.runAt : null);
    return when ? formatInstantWithZone(when, schedule.zoneId) : '—';
  }

  protected setFilter(key: FilterKey, value: string | null): void {
    this.navigate({ [key]: value, page: null });
  }

  protected clearFilters(): void {
    this.navigate({ type: null, status: null, owner: null, page: null });
  }

  protected goToPage(page: number): void {
    this.navigate({ page: page > 0 ? page : null });
  }

  protected openHistory(schedule: ScheduleView): void {
    this.navigate({ id: schedule.id ?? null });
  }

  protected closeHistory(): void {
    this.navigate({ id: null });
  }

  protected reload(): void {
    this.load(this.projectKey(), this.query());
  }

  /**
   * *New schedule*: a generation opens its dialog at once; a release or unpublish first reads what can be picked — the
   * unreleased changes, and the content that is online. The dialog's kind switch spans every kind the viewer may create.
   */
  protected newSchedule(kind: NewKind): void {
    if (this.preparing()) {
      return;
    }
    const first = NEW_KIND_TYPES[kind];
    const permitted: ScheduleType[] = [
      ...(this.permissions.canScheduleRelease() ? (['RELEASE', 'UNPUBLISH'] as const) : []),
      ...(this.permissions.canScheduleGeneration() ? (['GENERATION'] as const) : []),
    ];
    const types = [first, ...permitted.filter((t) => t !== first)];
    if (!this.permissions.canScheduleRelease()) {
      this.dialog.set({ schedule: null, types, choices: [], unpublishChoices: [] });
      return;
    }
    this.preparing.set(true);
    this.candidates(this.projectKey()).subscribe({
      next: (candidates) => {
        this.preparing.set(false);
        if (candidates === null) {
          this.toast.show(this.t('new.loadFailed'), 'error');
          return;
        }
        this.dialog.set({ schedule: null, types, choices: candidates.release, unpublishChoices: candidates.unpublish });
      },
    });
  }

  protected edit(schedule: ScheduleView): void {
    if (schedule.id == null) {
      return;
    }
    // The list rows carry no items or version-exact params: edit what the detail says.
    this.api.schedule(this.projectKey(), schedule.id).subscribe({
      next: (detail) => this.dialog.set({ schedule: detail, types: [detail.type as ScheduleType], choices: [], unpublishChoices: [] }),
      error: (err: unknown) => this.toast.show(problemOf(err, this.t('toast.openFailed')).detail, 'error'),
    });
  }

  protected async act(schedule: ScheduleView, action: RowAction): Promise<void> {
    if (schedule.id == null || this.busyId() !== null) {
      return;
    }
    if (action === 'cancel' && !(await this.confirmCancel(schedule))) {
      return;
    }
    this.busyId.set(schedule.id);
    this.api.scheduleAction(this.projectKey(), schedule.id, action).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toast.show(this.t(`toast.${{ cancel: 'cancelled', 'take-over': 'takeOver', 'run-now': 'runNow', repin: 'repin' }[action]}`), 'success');
        this.events.changed();
      },
      error: () => this.busyId.set(null),
    });
  }

  private confirmCancel(schedule: ScheduleView): Promise<boolean> {
    return this.confirms.confirm({
      title: this.t('cancel.title', { kind: this.kindName(schedule).toLowerCase() }),
      message: this.t(`cancel.message.${schedule.type}`),
      confirmLabel: this.t('cancel.confirm'),
      cancelLabel: this.t('cancel.keep'),
      tone: 'danger',
    });
  }

  /**
   * What a new release or unpublish can pick from: the unreleased changes (one choice per asset and language) and the
   * content that has a released version (one choice per asset, every language). `null` when the changes can't be read;
   * the published list is a search, so its failure only leaves Unpublish empty (with a notice).
   */
  private candidates(key: string): Observable<{ release: ReleaseChoice[]; unpublish: ReleaseChoice[] } | null> {
    const untitled = this.t('page.untitled');
    const releasable = this.api
      .listChanges(key, { status: ['NEW', 'CHANGED', 'UNPUBLISHED', 'DELETION_PENDING'], size: RELEASE_CANDIDATES })
      .pipe(
        map((page) => {
          const rows = page.rows ?? [];
          this.noteTruncated(page.totalElements ?? rows.length, rows.length);
          return rows.map<ReleaseChoice>((row) => {
            const name = row.displayName || (this.dev() ? row.uid : '') || untitled;
            const status = this.transloco.translate(`enum.releaseStatus.${row.status}`);
            return {
              assetUuid: row.uuid ?? '',
              locale: row.locale ?? '',
              label: `${name}${row.locale ? ` · ${row.locale.toUpperCase()}` : ''} — ${status}`,
              status: (row.status as ReleaseStatus) ?? null,
              checked: false,
              assetType: row.type,
              assetName: name,
              folderPath: row.folderPath,
            };
          });
        }),
        catchError(() => of(null)),
      );
    const online = this.search
      .search(key, { q: '', releaseStatus: ['PUBLISHED', 'CHANGED', 'DELETION_PENDING'], size: UNPUBLISH_CANDIDATES })
      .pipe(
        map((result) => {
          const hits = result.content ?? [];
          this.noteTruncated(result.page?.totalElements ?? hits.length, hits.length);
          return hits.map<ReleaseChoice>((hit) => {
            const name = hit.displayName || (this.dev() ? hit.uid : '') || untitled;
            return {
              assetUuid: hit.uuid ?? '',
              locale: '',
              label: `${name} (${this.transloco.translate(`enum.assetType.${hit.type}`)})`,
              status: null,
              checked: false,
              assetType: hit.type,
              assetName: name,
              folderPath: hit.folderPath,
            };
          });
        }),
        catchError(() => {
          this.toast.show(this.t('new.unpublishFailed'), 'warning');
          return of([] as ReleaseChoice[]);
        }),
      );
    return forkJoin({ release: releasable, unpublish: online }).pipe(
      map(({ release, unpublish }) => (release === null ? null : { release, unpublish })),
    );
  }

  private noteTruncated(total: number, shown: number): void {
    if (total > shown) {
      this.toast.show(this.t('new.truncated', { count: shown }), 'info');
    }
  }

  private filterLabel(key: FilterKey, value: string): string {
    return this.filterOptions()[key].find((o) => o.value === value)?.label ?? (key === 'owner' ? this.members.nameOf(Number(value)) : value);
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge' });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`schedules.${key}`, params);
  }

  private load(key: string, query: { type?: string; status?: string; owner?: string; page: number }): void {
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.request = this.api
      .listSchedules(key, {
        type: query.type ? typesOfKind(query.type) : undefined,
        status: query.status ? [query.status] : undefined,
        owner: query.owner ? Number(query.owner) : undefined,
        page: query.page,
        size: PAGE_SIZE,
      })
      .subscribe({
        next: (page) => {
          this.loading.set(false);
          this.rows.set(page.rows ?? []);
          this.total.set(page.totalElements ?? 0);
          this.totalPages.set(page.totalPages ?? 0);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(problemOf(err, this.t('page.loadFailed')).detail);
        },
      });
  }
}
