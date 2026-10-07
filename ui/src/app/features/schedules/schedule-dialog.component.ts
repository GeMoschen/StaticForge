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
import { SfComboboxComponent, type SfComboboxOption } from '../../shared/components/forms/sf-combobox.component';
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
import { type ReleaseChoice, itemKey, itemsOf } from '../release/release-choice.util';
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
  type ScheduleKind,
  type ScheduleType,
  SCHEDULE_KINDS,
  isRecurring,
  isReleaseState,
  latenessFromIso,
  scheduleKind,
  scheduleRequest,
} from './schedule.util';
import { formatInstant, utcToZoned, viewerZone, zoneAbbreviation, zoneIds, zonedToUtc } from './zoned-time.util';

type ScheduleView = components['schemas']['ScheduleView'];

const PREVIEW_DEBOUNCE_MS = 400;

/** The Repeat select's value: a one-off, a preset, or a cron expression typed by hand. */
type RepeatChoice = 'once' | CronPresetKind | 'custom';

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
 * switch changes it. A generation repeats through its Repeat select (once, a preset, a cron of its own); a repeat other
 * than "once" is the backend's recurring type. Times are taken in a chosen time zone (the viewer's by default) and sent as UTC instants; a recurring schedule
 * keeps the cron and its zone (`zoneId`), and its next runs come from the server so cron semantics (DST included) live
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
    SfComboboxComponent,
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
  /** The types offered (a recurring generation counts as Generation); the first is preselected. */
  readonly types = input<ScheduleType[]>(['RELEASE', 'UNPUBLISH', 'GENERATION']);
  /** Release: the (asset, locale) pairs the caller offers, ticked ones scheduled. */
  readonly choices = input<ReleaseChoice[]>([]);
  /** Unpublish: the pairs offered when the type is switched to Unpublish (released ones differ from releasable ones). */
  readonly unpublishChoices = input<ReleaseChoice[]>([]);
  /**
   * Release/unpublish: the offered items are many and none is ticked yet (the Schedules page), so they are picked from
   * a searchable list instead of a checkbox per item.
   */
  readonly pickItems = input(false);
  /** Editing an existing schedule; `null` creates one. */
  readonly schedule = input<ScheduleView | null>(null);

  readonly saved = output<ScheduleView>();
  readonly closed = output<void>();

  /** The kinds the switch offers, in the order of {@link SCHEDULE_KINDS}. */
  protected readonly kindOptions = computed<SfSegmentedOption<ScheduleKind>[]>(() => {
    const offered = new Set(this.types().map((type) => scheduleKind(type)));
    return SCHEDULE_KINDS.filter((kind) => offered.has(kind)).map((kind) => ({
      value: kind,
      label: this.transloco.translate(`release.schedule.kinds.${kind}`),
    }));
  });
  protected readonly repeatOptions: SfSelectOption<RepeatChoice>[] = [
    { value: 'once', label: this.transloco.translate('release.schedule.presets.once') },
    ...CRON_PRESET_OPTIONS.map<SfSelectOption<RepeatChoice>>((option) => ({
      value: option.kind,
      label: this.transloco.translate(`release.schedule.presets.${option.kind}`),
    })),
    { value: 'custom', label: this.transloco.translate('release.schedule.presets.custom') },
  ];
  protected readonly weekdayOptions = WEEKDAYS.map<SfSelectOption<number>>((day) => ({
    value: day.value,
    label: this.transloco.translate(`release.schedule.weekdays.${day.value}`),
  }));
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
  protected readonly repeat = signal<RepeatChoice>('once');
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
  /** "Advanced options" opens with an edited schedule that departs from the defaults. */
  protected readonly advancedOpen = signal(false);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly previewTimes = signal<string[] | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly previewLoading = signal(false);

  protected readonly editing = computed(() => this.schedule() !== null);
  /** What the switch shows: a recurring generation is a Generation. */
  protected readonly kind = computed(() => scheduleKind(this.type()) ?? 'RELEASE');
  protected readonly recurring = computed(() => isRecurring(this.type()));
  protected readonly releaseState = computed(() => isReleaseState(this.type()));
  /** Always explicit: "Schedule release", "Schedule unpublish", … (or "Edit … schedule" for an existing one). */
  protected readonly title = computed(() =>
    this.editing()
      ? this.transloco.translate('release.schedule.titleEdit', {
          kind: this.transloco.translate(`release.schedule.kinds.${this.kind()}`).toLowerCase(),
        })
      : this.transloco.translate(`release.schedule.title.${this.kind()}`),
  );
  /** Date and time as one local value for the date-time input. */
  protected readonly whenLocal = computed(() => (this.date() && this.time() ? `${this.date()}T${this.time()}` : null));
  /** The item list's own words: "Nothing to release." / "Nothing to unpublish." */
  protected readonly nothingKey = computed(() => (this.type() === 'RELEASE' ? 'release.schedule.nothingRelease' : 'release.schedule.nothingUnpublish'));
  /** The zone's abbreviation at the chosen time ("CET"), shown under the zone field. */
  protected readonly zoneAbbreviation = computed(() => zoneAbbreviation(this.zone(), new Date(this.runAt() ?? Date.now())));
  /** Every zone the platform knows, plus the one in use (a stored zone the platform no longer lists). */
  protected readonly zoneOptions = computed<SfComboboxOption<string>[]>(() =>
    zoneIds(this.zone(), viewerZone()).map((zone) => ({ value: zone, label: zone })),
  );
  protected readonly items = computed(() => itemsOf(this.selection()));
  /** How the offered items read: one plain name, a count, or — several languages of one asset — a checkbox each. */
  protected readonly itemsView = computed<'one' | 'count' | 'list'>(() => {
    const selection = this.selection();
    if (selection.length <= 1) {
      return 'one';
    }
    return this.assetCount() > 1 ? 'count' : 'list';
  });
  protected readonly assetCount = computed(() => new Set(this.selection().map((choice) => choice.assetUuid)).size);
  /** "Munich (EN)" for the lone item (the choice's own label when it names no asset). */
  protected readonly singleLabel = computed(() => {
    const choice = this.selection()[0];
    if (!choice) {
      return '';
    }
    return choice.assetName ? `${choice.assetName}${choice.locale ? ` (${localeTag(choice.locale)})` : ''}` : choice.label;
  });
  /** The picker's options (one per offered choice) and the keys of the ticked ones. */
  protected readonly pickOptions = computed<SfComboboxOption<string>[]>(() =>
    this.selection().map((choice) => ({ value: itemKey(choice.assetUuid, choice.locale), label: choice.label })),
  );
  protected readonly pickedKeys = computed(() =>
    this.selection().filter((choice) => choice.checked).map((choice) => itemKey(choice.assetUuid, choice.locale)),
  );
  protected readonly cron = computed(() =>
    this.repeat() === 'custom' || this.repeat() === 'once'
      ? this.advancedCron().trim()
      : presetCron({ kind: this.repeat() as CronPresetKind, time: this.presetTime(), weekday: this.presetWeekday() }),
  );
  protected readonly runAt = computed(() => zonedToUtc(this.date(), this.time(), this.zone()));
  protected readonly inPast = computed(() => {
    const runAt = this.runAt();
    return runAt !== null && Date.parse(runAt) <= Date.now();
  });
  /** The next run times in the chosen zone: the server's for a cron, the picked time for a one-off. */
  protected readonly previewText = computed(() => {
    const times = this.recurring() ? (this.previewTimes() ?? []) : [this.runAt()].filter((iso): iso is string => iso !== null && !this.inPast());
    return times.map((iso) => formatInstant(iso, this.zone()));
  });
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

  /** The zone combobox's value; an emptied box keeps the zone it had (a schedule always has one). */
  protected setZone(value: string | string[] | null): void {
    if (typeof value === 'string') {
      this.zone.set(value);
    }
  }

  /** The kind switch: a generation is one-off or recurring by its Repeat select. */
  protected setKind(kind: ScheduleKind | null): void {
    if (!kind) {
      return;
    }
    const type = this.typeOf(kind, this.repeat());
    this.type.set(type);
    this.selection.set(this.choicesOf(type).map((choice) => ({ ...choice })));
    this.error.set(null);
  }

  protected setRepeat(repeat: RepeatChoice | null): void {
    this.repeat.set(repeat ?? 'once');
    this.type.set(this.typeOf(this.kind(), this.repeat()));
  }

  private typeOf(kind: ScheduleKind, repeat: RepeatChoice): ScheduleType {
    return kind === 'GENERATION' && repeat !== 'once' ? 'RECURRING_GENERATION' : kind;
  }

  private choicesOf(type: ScheduleType): ReleaseChoice[] {
    return type === 'UNPUBLISH' && this.unpublishChoices().length > 0 ? this.unpublishChoices() : this.choices();
  }

  protected toggleItem(index: number, checked: boolean): void {
    this.selection.update((list) => list.map((choice, i) => (i === index ? { ...choice, checked } : choice)));
  }

  /** The picker's value: tick exactly the choices whose keys it holds. */
  protected setPicked(value: string | string[] | null): void {
    const keys = new Set(Array.isArray(value) ? value : value ? [value] : []);
    this.selection.update((list) => list.map((choice) => ({ ...choice, checked: keys.has(itemKey(choice.assetUuid, choice.locale)) })));
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
        const kind = this.transloco.translate(`release.schedule.kinds.${scheduleKind(view.type)}`);
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
    const preset = parsePresetCron(schedule?.cron);
    // A recurring schedule opens as a Generation with its Repeat set; a new one offered as recurring starts daily.
    this.repeat.set(!isRecurring(type) ? 'once' : schedule?.cron && !preset ? 'custom' : (preset?.kind ?? 'daily'));
    this.selection.set(this.choicesOf(type).map((choice) => ({ ...choice })));
    this.date.set(start.date);
    this.time.set(start.time);
    // A recurring schedule keeps the zone its cron was written in (epic decision 24).
    this.zone.set(schedule && isRecurring(schedule.type) && schedule.zoneId ? schedule.zoneId : zone);
    this.presetTime.set(preset?.time ?? '09:00');
    this.presetWeekday.set(preset?.weekday ?? 1);
    this.advancedCron.set(schedule?.cron ?? '0 9 * * 1-5');
    this.pinPolicy.set(schedule?.pinPolicy === 'LATEST' ? 'LATEST' : 'PINNED');
    const then = (schedule?.thenGenerate ?? null) as ThenGenerate | null;
    const params = (schedule?.params ?? {}) as GenerationParams;
    const build = isReleaseState(schedule?.type) ? then : params;
    // A new release or unpublish generates right after by default (as the sample does), when the viewer may build.
    this.thenGenerate.set(schedule ? then !== null : this.permissions.canIncrementalBuild());
    this.mode.set(params.mode === 'INCREMENTAL' ? 'INCREMENTAL' : 'FULL');
    this.targetId.set(build?.targetId ?? null);
    this.channels.set(build?.channels ?? []);
    this.missedPolicy.set(schedule?.missedPolicy === 'SKIP_IF_LATER_THAN' ? 'SKIP_IF_LATER_THAN' : 'RUN_LATE');
    const lateness = latenessFromIso(schedule?.maxLateness);
    this.latenessValue.set(lateness.value);
    this.latenessUnit.set(lateness.unit);
    this.comment.set(params.comment ?? '');
    this.advancedOpen.set(
      schedule !== null && (this.pinPolicy() === 'LATEST' || this.missedPolicy() === 'SKIP_IF_LATER_THAN' || (!isReleaseState(schedule.type) && this.comment() !== '')),
    );
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
