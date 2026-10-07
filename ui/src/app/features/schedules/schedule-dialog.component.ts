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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../shared/components/dialog/sf-dialog.component';
import { SfCheckboxComponent } from '../../shared/components/forms/sf-checkbox.component';
import { SfDateInputComponent } from '../../shared/components/forms/sf-date-input.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../shared/components/forms/sf-number-input.component';
import { SfRadioGroupComponent, type SfRadioOption } from '../../shared/components/forms/sf-radio-group.component';
import { SfSegmentedComponent, type SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, type SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfTextareaComponent } from '../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { GenerationOptionsComponent } from '../generation/generation-options.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { type ReleaseChoice, itemsOf } from '../release/release-choice.util';
import { ReleasePlanComponent, type ReleasePlanState } from '../release/release-plan.component';
import { localeTag } from '../release/release-status.util';
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
 * The schedule dialog (M27.6.5, restyled in M35.23), opened from an editor's release actions, the Changes view and the
 * Schedules page: scheduled release/unpublish of the given items, one-off and recurring generation. The title always
 * says what is scheduled ("Schedule release", "Schedule unpublish", …) and, when several kinds are allowed, a segmented
 * switch changes it. Times are taken and shown in the viewer's zone and sent as UTC instants; a recurring schedule
 * keeps the cron and the creator's zone, and its next runs come from the server so cron semantics (DST included) live
 * in one place.
 */
@Component({
  selector: 'sf-schedule-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GenerationOptionsComponent,
    ReleasePlanComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfDateInputComponent,
    SfDialogComponent,
    SfDialogFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfRadioGroupComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSpinnerComponent,
    SfSwitchComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  templateUrl: './schedule-dialog.component.html',
  styleUrl: './schedule-dialog.component.scss',
})
export class ScheduleDialogComponent implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
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

  /** The kinds the switch offers, in the order of {@link SCHEDULE_TYPES}. */
  protected readonly kindOptions = computed<SfSegmentedOption<ScheduleType>[]>(() =>
    SCHEDULE_TYPES.filter((t) => this.types().includes(t.value)).map((t) => ({
      value: t.value,
      label: this.transloco.translate(`release.schedule.kinds.${t.value}`),
    })),
  );
  protected readonly presetOptions = CRON_PRESET_OPTIONS.map<SfSelectOption<CronPresetKind>>((option) => ({
    value: option.kind,
    label: this.transloco.translate(`release.schedule.presets.${option.kind}`),
  }));
  protected readonly weekdayOptions = WEEKDAYS.map<SfSelectOption<number>>((day) => ({
    value: day.value,
    label: this.transloco.translate(`release.schedule.weekdays.${day.value}`),
  }));
  protected readonly cronModeOptions: SfSegmentedOption<'preset' | 'advanced'>[] = [
    { value: 'preset', label: this.transloco.translate('release.schedule.cronPreset') },
    { value: 'advanced', label: this.transloco.translate('release.schedule.cronAdvanced') },
  ];
  protected readonly pinOptions: SfRadioOption<'PINNED' | 'LATEST'>[] = [
    { value: 'PINNED', label: this.transloco.translate('release.schedule.pinned') },
    { value: 'LATEST', label: this.transloco.translate('release.schedule.latest') },
  ];
  protected readonly missedOptions: SfRadioOption<'RUN_LATE' | 'SKIP_IF_LATER_THAN'>[] = [
    { value: 'RUN_LATE', label: this.transloco.translate('release.schedule.runLate') },
    { value: 'SKIP_IF_LATER_THAN', label: this.transloco.translate('release.schedule.skipLate') },
  ];
  protected readonly latenessUnitOptions: SfSelectOption<LatenessUnit>[] = [
    { value: 'minutes', label: this.transloco.translate('release.schedule.minutes') },
    { value: 'hours', label: this.transloco.translate('release.schedule.hours') },
  ];

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
  /** Always explicit: "Schedule release", "Schedule unpublish", … (or "Edit … schedule" for an existing one). */
  protected readonly title = computed(() =>
    this.editing()
      ? this.transloco.translate('release.schedule.titleEdit', {
          kind: this.transloco.translate(`release.schedule.kinds.${this.type()}`).toLowerCase(),
        })
      : this.transloco.translate(`release.schedule.title.${this.type()}`),
  );
  /** Date and time as one local value for the date-time input. */
  protected readonly whenLocal = computed(() => (this.date() && this.time() ? `${this.date()}T${this.time()}` : null));
  /** The item list's own words: "Nothing to release." / "Nothing to unpublish." */
  protected readonly nothingKey = computed(() => (this.type() === 'RELEASE' ? 'release.schedule.nothingRelease' : 'release.schedule.nothingUnpublish'));
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

  /** Why the button is disabled, or `null` when the schedule may be saved. */
  protected readonly blockedReason = computed<string | null>(() => {
    const t = (key: string) => this.transloco.translate(`release.schedule.reason.${key}`);
    if (this.recurring()) {
      if (!this.cron()) {
        return t('cron');
      }
      if (this.previewError() !== null) {
        return t('cronInvalid');
      }
    } else if (this.runAt() === null) {
      return t('when');
    } else if (this.inPast()) {
      return t('past');
    }
    if (this.missedPolicy() === 'SKIP_IF_LATER_THAN' && !(this.latenessValue() >= 1)) {
      return t('lateness');
    }
    if (this.releaseState() && !this.editing()) {
      if (this.items().length === 0) {
        return t('items');
      }
      if (this.showPlan()) {
        const state = this.planState();
        // A pinned version with blocking findings is refused at once (SF-DOM-0150); "latest" is checked at run time.
        if (!state?.ready) {
          return t('checking');
        }
        if (state.blocked && this.pinPolicy() === 'PINNED') {
          return t('blocked');
        }
      }
    }
    return null;
  });
  protected readonly canSubmit = computed(() => !this.submitting() && this.blockedReason() === null);

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

  protected close(): void {
    if (!this.submitting()) {
      this.closed.emit();
    }
  }

  /** The date-time input's value: both parts, or neither while it is empty or unreadable. */
  protected setWhen(value: string | null): void {
    const [date = '', time = ''] = (value ?? '').split('T');
    this.date.set(date);
    this.time.set(time);
  }

  protected setType(type: ScheduleType | null): void {
    if (!type) {
      return;
    }
    this.type.set(type);
    this.selection.set(this.choicesOf(type).map((choice) => ({ ...choice })));
    this.error.set(null);
  }

  private choicesOf(type: ScheduleType): ReleaseChoice[] {
    return type === 'UNPUBLISH' && this.unpublishChoices().length > 0 ? this.unpublishChoices() : this.choices();
  }

  protected toggleItem(index: number, checked: boolean): void {
    this.selection.update((list) => list.map((choice, i) => (i === index ? { ...choice, checked } : choice)));
  }

  protected setLateness(value: number | null): void {
    this.latenessValue.set(value ?? 0);
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
        const kind = this.transloco.translate(`release.schedule.kinds.${view.type}`);
        this.toast.show(
          this.transloco.translate(`release.schedule.toast.${existing ? 'rescheduled' : 'scheduled'}${when ? 'At' : ''}`, {
            kind,
            when: formatInstant(when),
          }),
          'success',
        );
        this.saved.emit(view);
        this.closed.emit();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const problem = problemOf(err, this.transloco.translate('release.schedule.failed'));
        this.error.set(
          problem.status === 409 && problem.code === 'SF-API-0409' ? this.transloco.translate('release.schedule.conflict') : problem.detail,
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
          this.previewError.set(problemOf(err, this.transloco.translate('release.schedule.cronFailed')).detail);
        },
      });
    }, PREVIEW_DEBOUNCE_MS);
  }

  protected readonly localeTag = localeTag;
}
