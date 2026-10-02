import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ShortcutService } from '../../core/ui/shortcut.service';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { GenerationOptionsComponent } from '../generation/generation-options.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { type ReleaseChoice, itemsOf } from '../release/release-choice.util';
import { ReleasePlanComponent, type ReleasePlanState } from '../release/release-plan.component';
import { localeTag, statusLabel } from '../release/release-status.util';
import {
  CRON_PRESET_OPTIONS,
  type CronPresetKind,
  WEEKDAYS,
  parsePresetCron,
  presetCron,
} from './cron-presets.util';
import {
  type LatenessUnit,
  type ScheduleForm,
  type ScheduleType,
  SCHEDULE_TYPES,
  isRecurring,
  isReleaseState,
  latenessFromIso,
  scheduleRequest,
  typeLabel,
} from './schedule.util';
import { formatInstant, utcToZoned, viewerZone, zoneLabel, zonedToUtc } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];

const PREVIEW_DEBOUNCE_MS = 400;

interface ThenGenerate {
  targetId?: number | null;
  channels?: string[];
}

interface GenerationParams extends ThenGenerate {
  mode?: 'FULL' | 'INCREMENTAL';
  comment?: string;
}

/**
 * The schedule dialog (M27.6.5), opened from an editor's release bar, the Changes view and the Schedules page:
 * scheduled release/unpublish of the given items, one-off and recurring generation. Times are taken and shown in
 * the viewer's zone and sent as UTC instants; a recurring schedule keeps the cron and the creator's zone, and its
 * next runs come from the server so cron semantics (DST included) live in one place.
 */
@Component({
  selector: 'sf-schedule-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfSpinnerComponent, GenerationOptionsComponent, ReleasePlanComponent],
  templateUrl: './schedule-dialog.component.html',
  styleUrl: './schedule-dialog.component.scss',
})
export class ScheduleDialogComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly events = inject(ReleaseEventsStore);
  /** "Then generate" needs a build permission, another target `FULL_BUILD` (M28, epic decision 9). */
  protected readonly permissions = inject(ProjectPermissionsStore);

  readonly projectKey = input.required<string>();
  /** The types offered; the first is preselected. */
  readonly types = input<ScheduleType[]>(['RELEASE', 'UNPUBLISH', 'GENERATION', 'RECURRING_GENERATION']);
  /** Release: the (asset, locale) pairs the caller offers, ticked ones scheduled. */
  readonly choices = input<ReleaseChoice[]>([]);
  /** Unpublish: the pairs offered when the type is switched to Unpublish (released ones differ from releasable ones). */
  readonly unpublishChoices = input<ReleaseChoice[]>([]);
  /** Editing an existing schedule; `null` creates one. */
  readonly schedule = input<ScheduleView | null>(null);

  readonly saved = output<ScheduleView>();
  readonly closed = output<void>();

  protected readonly typeOptions = computed(() => SCHEDULE_TYPES.filter((t) => this.types().includes(t.value)));
  protected readonly presetOptions = CRON_PRESET_OPTIONS;
  protected readonly weekdays = WEEKDAYS;

  protected readonly type = signal<ScheduleType>('RELEASE');
  protected readonly selection = signal<ReleaseChoice[]>([]);
  protected readonly date = signal('');
  protected readonly time = signal('');
  protected readonly zone = signal(viewerZone());
  protected readonly cronMode = signal<'preset' | 'advanced'>('preset');
  protected readonly presetKind = signal<CronPresetKind>('daily');
  protected readonly presetTime = signal('09:00');
  protected readonly presetWeekday = signal(1);
  protected readonly advancedCron = signal('0 9 * * 1-5');
  protected readonly pinPolicy = signal<'PINNED' | 'LATEST'>('PINNED');
  protected readonly thenGenerate = signal(false);
  protected readonly mode = signal<'FULL' | 'INCREMENTAL'>('FULL');
  protected readonly targetId = signal<number | null>(null);
  protected readonly channels = signal<string[]>([]);
  protected readonly missedPolicy = signal<'RUN_LATE' | 'SKIP_IF_LATER_THAN'>('RUN_LATE');
  protected readonly latenessValue = signal(15);
  protected readonly latenessUnit = signal<LatenessUnit>('minutes');
  protected readonly comment = signal('');
  protected readonly planState = signal<ReleasePlanState | null>(null);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly previewTimes = signal<string[] | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly previewLoading = signal(false);

  protected readonly editing = computed(() => this.schedule() !== null);
  protected readonly recurring = computed(() => isRecurring(this.type()));
  protected readonly releaseState = computed(() => isReleaseState(this.type()));
  protected readonly title = computed(() =>
    this.editing() ? `Edit ${typeLabel(this.type()).toLowerCase()} schedule` : `Schedule ${this.typeOptions().length === 1 ? typeLabel(this.type()).toLowerCase() : ''}`.trim(),
  );
  protected readonly zoneText = computed(() => zoneLabel(this.zone(), new Date(this.runAt() ?? Date.now())));
  protected readonly items = computed(() => itemsOf(this.selection()));
  protected readonly cron = computed(() =>
    this.cronMode() === 'preset'
      ? presetCron({ kind: this.presetKind(), time: this.presetTime(), weekday: this.presetWeekday() })
      : this.advancedCron().trim(),
  );
  protected readonly runAt = computed(() => zonedToUtc(this.date(), this.time(), this.zone()));
  protected readonly inPast = computed(() => {
    const runAt = this.runAt();
    return runAt !== null && Date.parse(runAt) <= Date.now();
  });
  protected readonly previewText = computed(() => (this.previewTimes() ?? []).map((iso) => formatInstant(iso, viewerZone())));
  /** The release plan is shown (and blocks) when creating a release; an edit keeps the stored, resolved items. */
  protected readonly showPlan = computed(() => this.type() === 'RELEASE' && !this.editing());

  protected readonly canSubmit = computed(() => {
    if (this.submitting()) {
      return false;
    }
    if (this.recurring()) {
      if (!this.cron() || this.previewError() !== null) {
        return false;
      }
    } else if (this.runAt() === null || this.inPast()) {
      return false;
    }
    if (this.missedPolicy() === 'SKIP_IF_LATER_THAN' && !(this.latenessValue() >= 1)) {
      return false;
    }
    if (this.releaseState() && !this.editing()) {
      if (this.items().length === 0) {
        return false;
      }
      if (this.showPlan()) {
        const state = this.planState();
        // A pinned version with blocking findings is refused at once (SF-DOM-0150); "latest" is checked at run time.
        if (!state?.ready || (state.blocked && this.pinPolicy() === 'PINNED')) {
          return false;
        }
      }
    }
    return true;
  });

  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewRequest: Subscription | null = null;

  constructor() {
    effect(
      () => {
        const schedule = this.schedule();
        const types = this.types();
        this.choices();
        this.unpublishChoices();
        untracked(() => this.reset(schedule, types));
      },
      { allowSignalWrites: true },
    );
    effect(() => {
      const recurring = this.recurring();
      const cron = this.cron();
      const zone = this.zone();
      const key = this.projectKey();
      untracked(() => this.schedulePreview(key, recurring, cron, zone));
    });
  }

  ngOnDestroy(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
    }
    this.previewRequest?.unsubscribe();
  }

  /** Escape goes through the shortcut registry, which orders it among the open layers (M35.14). */
  private readonly escapeShortcut = inject(ShortcutService).useEscape(() => this.onEscape());

  protected onEscape(): void {
    this.close();
  }

  protected close(): void {
    if (!this.submitting()) {
      this.closed.emit();
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setType(type: ScheduleType): void {
    this.type.set(type);
    this.selection.set(this.choicesOf(type).map((choice) => ({ ...choice })));
    this.error.set(null);
  }

  private choicesOf(type: ScheduleType): ReleaseChoice[] {
    return type === 'UNPUBLISH' && this.unpublishChoices().length > 0 ? this.unpublishChoices() : this.choices();
  }

  protected toggleItem(index: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selection.update((list) => list.map((choice, i) => (i === index ? { ...choice, checked } : choice)));
  }

  protected setLateness(event: Event): void {
    this.latenessValue.set(Number(this.value(event)));
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const form: ScheduleForm = {
      type: this.type(),
      date: this.date(),
      time: this.time(),
      cron: this.cron(),
      zone: this.zone(),
      items: this.items(),
      includeDependencies: this.showPlan() ? (this.planState()?.includeDependencies ?? []) : [],
      pinPolicy: this.pinPolicy(),
      // Without a build permission there is no "then generate"; without FULL_BUILD it goes to the default target.
      thenGenerate: this.thenGenerate() && (!this.releaseState() || this.permissions.canIncrementalBuild()),
      mode: this.mode(),
      targetId: this.releaseState() && !this.permissions.canFullBuild() ? null : this.targetId(),
      channels: this.channels(),
      missedPolicy: this.missedPolicy(),
      maxLatenessValue: this.latenessValue(),
      maxLatenessUnit: this.latenessUnit(),
      comment: this.comment(),
    };
    const existing = this.schedule();
    // An edited release/unpublish keeps its stored (resolved, pinned) items: params are left out.
    const body = scheduleRequest(form, !(existing && this.releaseState()));
    const request =
      existing?.id != null
        ? this.api.updateSchedule(this.projectKey(), existing.id, existing.version ?? 0, body)
        : this.api.createSchedule(this.projectKey(), body);
    this.submitting.set(true);
    this.error.set(null);
    request.subscribe({
      next: (view) => {
        this.submitting.set(false);
        this.events.changed();
        const when = view.nextRunAt ?? view.runAt;
        this.toast.show(
          `${typeLabel(view.type)} ${existing ? 'rescheduled' : 'scheduled'}${when ? ` for ${formatInstant(when)}` : ''}.`,
          'success',
        );
        this.saved.emit(view);
        this.closed.emit();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, 'Could not save the schedule — try again.');
        this.error.set(
          problem.status === 409 && problem.code === 'SF-API-0409'
            ? 'Someone changed this schedule in the meantime — close the dialog and open it again.'
            : problem.detail,
        );
      },
    });
  }

  private reset(schedule: ScheduleView | null, types: ScheduleType[]): void {
    const zone = viewerZone();
    const nextHour = new Date(Math.ceil((Date.now() + 60_000) / 3_600_000) * 3_600_000).toISOString();
    const start = utcToZoned(schedule?.runAt ?? schedule?.nextRunAt ?? nextHour, zone);
    const type = (schedule?.type as ScheduleType | undefined) ?? types[0] ?? 'RELEASE';
    this.type.set(type);
    this.selection.set(this.choicesOf(type).map((choice) => ({ ...choice })));
    this.date.set(start.date);
    this.time.set(start.time);
    // A recurring schedule keeps the zone its cron was written in (epic decision 24).
    this.zone.set(schedule && isRecurring(schedule.type) && schedule.zoneId ? schedule.zoneId : zone);
    const preset = parsePresetCron(schedule?.cron);
    this.cronMode.set(schedule?.cron && !preset ? 'advanced' : 'preset');
    this.presetKind.set(preset?.kind ?? 'daily');
    this.presetTime.set(preset?.time ?? '09:00');
    this.presetWeekday.set(preset?.weekday ?? 1);
    this.advancedCron.set(schedule?.cron ?? '0 9 * * 1-5');
    this.pinPolicy.set(schedule?.pinPolicy === 'LATEST' ? 'LATEST' : 'PINNED');
    const then = (schedule?.thenGenerate ?? null) as ThenGenerate | null;
    const params = (schedule?.params ?? {}) as GenerationParams;
    const build = isReleaseState(schedule?.type) ? then : params;
    this.thenGenerate.set(then !== null);
    this.mode.set(params.mode === 'INCREMENTAL' ? 'INCREMENTAL' : 'FULL');
    this.targetId.set(build?.targetId ?? null);
    this.channels.set(build?.channels ?? []);
    this.missedPolicy.set(schedule?.missedPolicy === 'SKIP_IF_LATER_THAN' ? 'SKIP_IF_LATER_THAN' : 'RUN_LATE');
    const lateness = latenessFromIso(schedule?.maxLateness);
    this.latenessValue.set(lateness.value);
    this.latenessUnit.set(lateness.unit);
    this.comment.set(params.comment ?? '');
    this.error.set(null);
  }

  private schedulePreview(projectKey: string, recurring: boolean, cron: string, zone: string): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.previewRequest?.unsubscribe();
    if (!recurring || !cron) {
      this.previewTimes.set(null);
      this.previewError.set(null);
      this.previewLoading.set(false);
      return;
    }
    this.previewLoading.set(true);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.previewRequest = this.api.schedulePreviewTimes(projectKey, { cron, zoneId: zone, count: 5 }).subscribe({
        next: (view) => {
          this.previewLoading.set(false);
          this.previewError.set(null);
          this.previewTimes.set(view.times ?? []);
        },
        error: (err: unknown) => {
          this.previewLoading.set(false);
          this.previewTimes.set(null);
          this.previewError.set(problemOf(err, 'Invalid cron expression.').detail);
        },
      });
    }, PREVIEW_DEBOUNCE_MS);
  }

  protected readonly localeTag = localeTag;
  protected readonly statusLabel = statusLabel;
}
