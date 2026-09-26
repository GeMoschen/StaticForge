import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectMembersStore } from '../../core/project/project-members.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { GenerationService } from '../generation/generation.service';
import { ScheduleDialogComponent } from './schedule-dialog.component';
import { ScheduleHistoryComponent } from './schedule-history.component';
import {
  SCHEDULE_STATUSES,
  SCHEDULE_TYPES,
  type ScheduleType,
  canCancelSchedule,
  canEditSchedule,
  canRepin,
  canRunNow,
  showsDrift,
  canTakeOver,
  outcomeLabel,
  scheduleStatusLabel,
  scheduleWhat,
  typeLabel,
} from './schedule.util';
import { formatInstantWithZone, viewerZone, zoneLabel } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];

const PAGE_SIZE = 50;

/**
 * The Schedules page (M27.6.5): every scheduled release, unpublish and generation of the project, next due first,
 * filtered by type, status and owner (in the URL, so a filtered list can be linked), with the row actions the viewer
 * may take and each schedule's execution history. `?id=` opens one schedule's history (the release bar links here).
 */
@Component({
  selector: 'sf-schedules',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSpinnerComponent,
    ScheduleDialogComponent,
    ScheduleHistoryComponent,
  ],
  templateUrl: './schedules.component.html',
  styleUrl: './schedules.component.scss',
})
export class SchedulesComponent {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthStore);
  private readonly events = inject(ReleaseEventsStore);
  protected readonly members = inject(ProjectMembersStore);
  protected readonly permissions = inject(ProjectPermissionsStore);
  private readonly generation = inject(GenerationService);
  protected readonly access = inject(ProjectAccessStore);

  readonly projectKey = input.required<string>();
  /** Filters and the open history, bound from the query string. */
  readonly type = input<string | undefined>();
  readonly status = input<string | undefined>();
  readonly owner = input<string | undefined>();
  readonly page = input<string | undefined>();
  readonly id = input<string | undefined>();

  protected readonly typeOptions = SCHEDULE_TYPES;
  protected readonly statusOptions = SCHEDULE_STATUSES;
  protected readonly viewerZoneLabel = zoneLabel(viewerZone());

  protected readonly rows = signal<ScheduleView[]>([]);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<number | null>(null);
  /** Where a "then generate" without a target builds — it decides which build permission a release schedule needs. */
  private readonly defaultTargetId = signal<number | null>(null);
  protected readonly dialog = signal<{ schedule: ScheduleView | null; types: ScheduleType[] } | null>(null);

  protected readonly pageIndex = computed(() => Math.max(0, Number(this.page() ?? 0) || 0));
  protected readonly historyId = computed(() => (this.id() ? Number(this.id()) : null));
  protected readonly currentUserId = this.auth.userId;
  protected readonly hasFilters = computed(() => !!(this.type() || this.status() || this.owner()));
  protected readonly activeFilters = computed(() => {
    const chips: { key: 'type' | 'status' | 'owner'; label: string }[] = [];
    if (this.type()) {
      chips.push({ key: 'type', label: `Type: ${typeLabel(this.type())}` });
    }
    if (this.status()) {
      chips.push({ key: 'status', label: `Status: ${SCHEDULE_STATUSES.find((s) => s.value === this.status())?.label ?? this.status()}` });
    }
    if (this.owner()) {
      chips.push({ key: 'owner', label: `Owner: ${this.members.nameOf(Number(this.owner()))}` });
    }
    return chips;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const query = { type: this.type(), status: this.status(), owner: this.owner(), page: this.pageIndex() };
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
  }

  protected what = scheduleWhat;
  protected typeLabel = typeLabel;
  protected statusLabel = scheduleStatusLabel;
  protected outcomeLabel = outcomeLabel;
  protected showsDrift = showsDrift;

  /**
   * The row actions follow the server's rules (M28, epic decision 9): changing a schedule needs what it needs — for a
   * release, `SCHEDULE_RELEASE` and the build permission of its "then generate" — and a developer for someone else's;
   * taking one over needs only what it needs.
   */
  private canChange(schedule: ScheduleView): boolean {
    return this.permissions.canChangeSchedule(schedule, this.defaultTargetId());
  }

  protected canEdit(schedule: ScheduleView): boolean {
    return canEditSchedule(schedule) && this.canChange(schedule);
  }

  protected canCancel(schedule: ScheduleView): boolean {
    return canCancelSchedule(schedule) && this.canChange(schedule);
  }

  protected canRunNow(schedule: ScheduleView): boolean {
    return canRunNow(schedule) && this.canChange(schedule);
  }

  protected canRepin(schedule: ScheduleView): boolean {
    return canRepin(schedule) && this.canChange(schedule);
  }

  protected canTakeOver(schedule: ScheduleView): boolean {
    return canTakeOver(schedule, this.currentUserId()) && this.permissions.satisfiesSchedule(schedule, this.defaultTargetId());
  }

  protected nextRun(schedule: ScheduleView): string {
    const when = schedule.nextRunAt ?? (schedule.status === 'PENDING' ? schedule.runAt : null);
    return when ? formatInstantWithZone(when, schedule.zoneId) : '—';
  }

  protected setFilter(key: 'type' | 'status' | 'owner', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.navigate({ [key]: value || null, page: null });
  }

  protected clearFilter(key: 'type' | 'status' | 'owner'): void {
    this.navigate({ [key]: null, page: null });
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

  protected newSchedule(): void {
    this.dialog.set({ schedule: null, types: ['GENERATION', 'RECURRING_GENERATION'] });
  }

  protected edit(schedule: ScheduleView): void {
    if (schedule.id == null) {
      return;
    }
    // The list rows carry no items or version-exact params: edit what the detail says.
    this.api.schedule(this.projectKey(), schedule.id).subscribe({
      next: (detail) => this.dialog.set({ schedule: detail, types: [detail.type as ScheduleType] }),
      error: (err: unknown) => this.toast.show(problemOf(err, 'Could not open the schedule.').detail, 'error'),
    });
  }

  protected act(schedule: ScheduleView, action: 'cancel' | 'take-over' | 'run-now' | 'repin'): void {
    if (schedule.id == null || this.busyId() !== null) {
      return;
    }
    if (action === 'cancel' && !window.confirm(`Cancel this ${typeLabel(schedule.type).toLowerCase()} schedule?`)) {
      return;
    }
    this.busyId.set(schedule.id);
    this.api.scheduleAction(this.projectKey(), schedule.id, action).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toast.show(
          {
            cancel: 'Schedule cancelled.',
            'take-over': 'You own this schedule now.',
            'run-now': 'Runs within the next minute.',
            repin: 'Pinned to the current drafts.',
          }[action],
          'success',
        );
        this.events.changed();
      },
      error: () => this.busyId.set(null),
    });
  }

  private navigate(params: Record<string, string | number | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge' });
  }

  private load(key: string, query: { type?: string; status?: string; owner?: string; page: number }): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .listSchedules(key, {
        type: query.type ? [query.type] : undefined,
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
          this.error.set(problemOf(err, 'Could not load the schedules — try again in a moment.').detail);
        },
      });
  }
}
