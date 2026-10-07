import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { I18nFormatService } from '../../../../core/i18n/i18n-format.service';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfComboboxComponent, SfComboboxOption } from '../../../../shared/components/forms/sf-combobox.component';
import { SfDateInputComponent } from '../../../../shared/components/forms/sf-date-input.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../../shared/components/forms/sf-number-input.component';
import { SfRadioGroupComponent, SfRadioOption } from '../../../../shared/components/forms/sf-radio-group.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import {
  BUILD_TARGETS,
  CRON_PRESETS,
  CronPresetId,
  SCHEDULABLE_ITEMS,
  SCHEDULE_KINDS,
  SCHEDULE_KIND_ICONS,
  ScheduleKind,
  TIME_ZONES,
  nextRuns,
} from './changes-data';
import { injectSampleDevMode, injectSampleNotice, injectSampleText } from './sample-area.util';

type BuildMode = 'incremental' | 'full';
type PinPolicy = 'pinned' | 'latest';
type MissedPolicy = 'runLate' | 'skip';
/** The repeat select's value: a preset or `once`. */
type RepeatChoice = CronPresetId | 'once';

const CRON_OF: Readonly<Record<CronPresetId, string>> = {
  hourly: '0 * * * *',
  daily: '0 3 * * *',
  weekdays: '0 3 * * 1-5',
  weekly: '0 3 * * 1',
  custom: '30 2 * * 1,4',
};

/** Tomorrow at 06:00 local, as `yyyy-MM-ddTHH:mm`. */
function defaultWhen(): string {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T06:00`;
}

/**
 * The schedule dialog of the sample (M35.9 decision 26, M35.23): the title always says what is scheduled ("Schedule
 * release" / "Schedule unpublish" / "Schedule generation") and a segmented switch changes it. Release and unpublish
 * name their items (fixed when opened from an item, else a picker) and may generate right after; a generation picks
 * target and mode and may repeat (cron presets; the expression in developer mode or for a custom one). Date and time
 * (`sf-date-input` datetime), a time zone combobox and a preview of the next run times. The rarely changed rest sits in a
 * collapsed "Advanced options" disclosure at the bottom (round 16, decision 182): which version a release takes, what
 * happens when the time is missed, and a comment. Nothing is saved.
 */
@Component({
  selector: 'sf-sample-schedule-dialog',
  standalone: true,
  imports: [
    SfButtonComponent,
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
    SfSwitchComponent,
    SfTextareaComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-schedule-dialog.component.html',
  styleUrl: './sample-schedule-dialog.component.scss',
})
export class SampleScheduleDialogComponent implements OnInit {
  /** The kind it opens with. */
  readonly initialKind = input<ScheduleKind>('release', { alias: 'kind' });
  /** The fixed subject (an item, "2 items"); `null` = pick items in the dialog. */
  readonly subject = input<string | null>(null);

  readonly closed = output<void>();

  protected readonly t = injectSampleText('styleguide.sample.changes.schedule');
  protected readonly dev = injectSampleDevMode();
  private readonly notice = injectSampleNotice();
  private readonly format = inject(I18nFormatService);

  protected readonly kind = signal<ScheduleKind>('release');
  protected readonly items = signal<string[]>([]);
  protected readonly target = signal<string>(BUILD_TARGETS[0].id);
  protected readonly mode = signal<BuildMode>('incremental');
  protected readonly when = signal<string | null>(defaultWhen());
  protected readonly zone = signal<string | null>('Europe/Berlin');
  protected readonly repeat = signal<RepeatChoice>('once');
  protected readonly cron = signal(CRON_OF.custom);
  protected readonly thenGenerate = signal(true);
  protected readonly pin = signal<PinPolicy>('pinned');
  protected readonly missed = signal<MissedPolicy>('runLate');
  protected readonly lateness = signal(15);
  protected readonly comment = signal('');

  protected readonly title = computed(() => this.t(`title.${this.kind()}`));
  protected readonly isGeneration = computed(() => this.kind() === 'generation');

  protected readonly kindOptions = computed<SfSegmentedOption<ScheduleKind>[]>(() =>
    SCHEDULE_KINDS.map((kind) => ({ value: kind, label: this.t(`kinds.${kind}`), icon: SCHEDULE_KIND_ICONS[kind] })),
  );
  protected readonly itemOptions: SfComboboxOption<string>[] = SCHEDULABLE_ITEMS.map((name) => ({ value: name, label: name }));
  protected readonly targetOptions: SfSelectOption<string>[] = BUILD_TARGETS.map((t) => ({ value: t.id, label: t.name }));
  protected readonly modeOptions = computed<SfSegmentedOption<BuildMode>[]>(() => [
    { value: 'incremental', label: this.t('modes.incremental') },
    { value: 'full', label: this.t('modes.full') },
  ]);
  protected readonly pinOptions = computed<SfRadioOption<PinPolicy>[]>(() => [
    { value: 'pinned', label: this.t('advanced.pinned') },
    { value: 'latest', label: this.t('advanced.latest') },
  ]);
  protected readonly missedOptions = computed<SfRadioOption<MissedPolicy>[]>(() => [
    { value: 'runLate', label: this.t('advanced.runLate') },
    { value: 'skip', label: this.t('advanced.skip') },
  ]);
  protected readonly zoneOptions: SfComboboxOption<string>[] = TIME_ZONES.map((zone) => ({ value: zone, label: zone }));
  protected readonly repeatOptions = computed<SfSelectOption<RepeatChoice>[]>(() => [
    { value: 'once', label: this.t('repeatOptions.once') },
    ...CRON_PRESETS.map((id) => ({ value: id, label: this.t(`repeatOptions.${id}`) })),
  ]);
  /** The cron expression is shown for a custom repeat, and read-only in developer mode for a preset. */
  protected readonly showCron = computed(() => this.repeat() === 'custom' || (this.dev() && this.repeat() !== 'once'));
  protected readonly cronValue = computed(() => {
    const repeat = this.repeat();
    return repeat === 'custom' || repeat === 'once' ? this.cron() : CRON_OF[repeat];
  });

  /** The next run times, formatted (the time zone is said once beside them). */
  protected readonly preview = computed<string[]>(() => {
    const when = this.when();
    if (!when) {
      return [];
    }
    const repeat = this.isGeneration() ? this.repeat() : 'once';
    return nextRuns(new Date(when), repeat === 'once' ? null : repeat).map((date) => this.format.dateTime(date));
  });

  protected readonly blocked = computed<string | null>(() => {
    if (!this.when()) {
      return this.t('reasonWhen');
    }
    if (!this.isGeneration() && !this.subject() && this.items().length === 0) {
      return this.t('reasonItems');
    }
    if (this.missed() === 'skip' && !(this.lateness() >= 1)) {
      return this.t('advanced.reasonLateness');
    }
    return null;
  });

  ngOnInit(): void {
    this.kind.set(this.initialKind());
  }

  protected setKind(kind: ScheduleKind | null): void {
    if (kind) {
      this.kind.set(kind);
    }
  }

  protected setLateness(value: number | null): void {
    this.lateness.set(value ?? 0);
  }

  protected setItems(value: string | string[] | null): void {
    this.items.set(Array.isArray(value) ? value : value ? [value] : []);
  }

  protected schedule(): void {
    if (this.blocked()) {
      return;
    }
    this.notice(this.t('scheduled', { title: this.title() }));
    this.closed.emit();
  }
}
