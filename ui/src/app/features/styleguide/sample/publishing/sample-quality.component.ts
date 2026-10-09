import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfCheckboxComponent } from '../../../../shared/components/forms/sf-checkbox.component';
import { SfNumberInputComponent } from '../../../../shared/components/forms/sf-number-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SfTooltipDirective } from '../../../../shared/directives/sf-tooltip.directive';
import { injectSampleQuery } from '../changes/sample-area.util';
import {
  LAST_FINISHED_RUN,
  QUALITY_CATEGORIES,
  QUALITY_LEVELS,
  QUALITY_RULES,
  QualityLevel,
  QualityParam,
  QualityRule,
  findingCounts,
} from './publishing-data';
import { PublishingState } from './publishing-state';
import { LEVEL_ICONS } from './publishing-status';

/** A rule setting's value: a number (null while the field is empty) or a switch. */
type ParamValue = number | boolean | null;
type Params = Readonly<Record<string, ParamValue>>;
type Levels = Readonly<Record<string, QualityLevel>>;

const paramKey = (rule: QualityRule, param: QualityParam) => `${rule.code}.${param.id}`;

/** The saved settings of the sample: every default, except a description limit somebody tightened. */
function savedParams(): Params {
  const params = Object.fromEntries(QUALITY_RULES.flatMap((r) => r.params.map((p) => [paramKey(r, p), p.default] as const)));
  return { ...params, 'SF-CHK-0204.maxLength': 155 };
}

/**
 * Publishing › Quality: a summary first (rules on and off, how many hold pages back, the last run's results), then
 * the rules grouped by category with the Off / Warning / Error segmented control. The long explanations are a
 * one-line hint with the full text in a tooltip.
 *
 * Rules are **saved**, not applied at once (M35.24 round 17): a save bar (status, Discard, Save) and, after saving, the
 * note that the next incremental build runs as a full one. Some rules have settings (a number with its range and
 * default, or a switch); an invalid number marks its field and blocks Save. The default level is marked, a rule that
 * differs from its defaults offers **Reset to default**, a rule capped at Warning disables Error (and says so for a
 * stored Error), and a rule that checks only some channels says the others are not checked. Editors and viewers see
 * the rules read-only.
 *
 * Each group can be folded (`qcollapsed=links,seo` opens it folded) and has its own Off / Warning / Error control that
 * sets all its rules at once (capped rules take Warning for Error; the control shows no choice while the rules differ).
 *
 * Query parameters: `role=viewer` (read-only; `role=editor` comes from the area), `qinvalid=1` (an out-of-range
 * setting), `qcapped=1` (a capped rule stored as Error), `qsaved=1` (the note after a save).
 */
@Component({
  selector: 'sf-sample-quality',
  standalone: true,
  imports: [
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfCheckboxComponent,
    SfFieldComponent,
    SfIconComponent,
    SfNumberInputComponent,
    SfSegmentedComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-quality.component.html',
  styleUrl: './sample-quality.component.scss',
})
export class SampleQualityComponent {
  protected readonly state = inject(PublishingState);
  protected readonly t = this.state.t;
  private readonly query = injectSampleQuery();
  protected readonly last = LAST_FINISHED_RUN;
  protected readonly lastCounts = findingCounts(LAST_FINISHED_RUN);

  /** Developers change the rules; editors (the area's role) and viewers (`role=viewer`) only read them. */
  protected readonly readOnly = signal(this.state.role() === 'editor' || this.query.get('role') === 'viewer');

  private readonly capped = this.query.get('qcapped') === '1';
  private readonly savedLevels = signal<Levels>({
    ...Object.fromEntries(QUALITY_RULES.map((r) => [r.code, r.level])),
    ...(this.capped ? { 'SF-CHK-0103': 'error' as const } : {}),
  });
  private readonly savedValues = signal<Params>(savedParams());

  /** Level per rule code, as edited. */
  protected readonly levels = signal<Levels>(this.savedLevels());
  /** Setting per `code.id`, as edited. */
  protected readonly params = signal<Params>(
    this.query.get('qinvalid') === '1' ? { ...this.savedValues(), 'SF-CHK-0204.maxLength': 500 } : this.savedValues(),
  );
  /** Whether the rules were just saved (the next build is a full one). */
  protected readonly justSaved = signal(this.query.get('qsaved') === '1');

  protected readonly dirty = computed(
    () =>
      QUALITY_RULES.some((r) => this.levels()[r.code] !== this.savedLevels()[r.code]) ||
      Object.keys(this.params()).some((k) => this.params()[k] !== this.savedValues()[k]),
  );
  /** The settings (by `code.id`) whose value is empty or outside its range. */
  protected readonly invalid = computed(() => {
    const bad = new Set<string>();
    for (const rule of QUALITY_RULES) {
      for (const param of rule.params) {
        if (param.kind === 'number' && !this.numberValid(param, this.params()[paramKey(rule, param)])) {
          bad.add(paramKey(rule, param));
        }
      }
    }
    return bad;
  });

  protected readonly summary = computed(() => {
    const applied = QUALITY_RULES.map((r) => this.applied(r));
    return {
      on: applied.filter((l) => l !== 'off').length,
      off: applied.filter((l) => l === 'off').length,
      errors: applied.filter((l) => l === 'error').length,
    };
  });

  /** Categories folded away (`qcollapsed=links,seo`). */
  protected readonly collapsed = signal<ReadonlySet<string>>(
    new Set((this.query.get('qcollapsed') ?? '').split(',').filter((c) => c)),
  );

  /** The Off / Warning / Error control of a whole group (no default marker: it sets, it does not describe). */
  protected readonly groupOptions: SfSegmentedOption<QualityLevel>[] = QUALITY_LEVELS.map((level) => ({
    value: level,
    label: this.t(`quality.levels.${level}`),
    icon: LEVEL_ICONS[level],
  }));

  protected readonly groups = computed(() =>
    QUALITY_CATEGORIES.map((category) => {
      const rules = QUALITY_RULES.filter((r) => r.category === category);
      return { category, rules, on: rules.filter((r) => this.levels()[r.code] !== 'off').length };
    }),
  );

  /** What the build applies: a rule capped at Warning never applies Error, whatever is stored. */
  protected applied(rule: QualityRule): QualityLevel {
    const level = this.levels()[rule.code];
    return rule.max === 'warning' && level === 'error' ? 'warning' : level;
  }

  protected isCollapsed(category: string): boolean {
    return this.collapsed().has(category);
  }

  protected toggleGroup(category: string): void {
    this.collapsed.update((all) => {
      const next = new Set(all);
      if (!next.delete(category)) {
        next.add(category);
      }
      return next;
    });
  }

  /** What a group-wide level means for a rule: a rule capped at Warning takes Warning when the group says Error. */
  private levelFor(rule: QualityRule, level: QualityLevel): QualityLevel {
    return rule.max === 'warning' && level === 'error' ? 'warning' : level;
  }

  /** The level every rule of the group has (capped rules count as Warning for Error), or null when they differ. */
  protected groupLevel(group: { rules: readonly QualityRule[] }): QualityLevel | null {
    return QUALITY_LEVELS.find((level) => group.rules.every((r) => this.levels()[r.code] === this.levelFor(r, level))) ?? null;
  }

  protected setGroupLevel(group: { rules: readonly QualityRule[] }, level: QualityLevel | null): void {
    if (level) {
      this.edit(() => this.levels.update((all) => ({ ...all, ...Object.fromEntries(group.rules.map((r) => [r.code, this.levelFor(r, level)])) })));
    }
  }

  protected options(rule: QualityRule): SfSegmentedOption<QualityLevel>[] {
    return QUALITY_LEVELS.map((level) => ({
      value: level,
      label: this.t(`quality.levels.${level}`) + (level === rule.defaultLevel ? ` ${this.t('quality.defaultMarker')}` : ''),
      icon: LEVEL_ICONS[level],
      disabled: rule.max === 'warning' && level === 'error',
    }));
  }

  /** Whether the level or a setting differs from the rule's defaults. */
  protected differs(rule: QualityRule): boolean {
    return this.levels()[rule.code] !== rule.defaultLevel || rule.params.some((p) => this.params()[paramKey(rule, p)] !== p.default);
  }

  protected value(rule: QualityRule, param: QualityParam): ParamValue {
    return this.params()[paramKey(rule, param)];
  }

  protected isInvalid(rule: QualityRule, param: QualityParam): boolean {
    return this.invalid().has(paramKey(rule, param));
  }

  protected setLevel(code: string, level: QualityLevel | null): void {
    if (level) {
      this.edit(() => this.levels.update((all) => ({ ...all, [code]: level })));
    }
  }

  protected setParam(rule: QualityRule, param: QualityParam, value: ParamValue): void {
    this.edit(() => this.params.update((all) => ({ ...all, [paramKey(rule, param)]: value })));
  }

  protected reset(rule: QualityRule): void {
    this.edit(() => {
      this.levels.update((all) => ({ ...all, [rule.code]: rule.defaultLevel }));
      this.params.update((all) => ({ ...all, ...Object.fromEntries(rule.params.map((p) => [paramKey(rule, p), p.default])) }));
    });
  }

  protected save(): void {
    if (this.invalid().size > 0) {
      return;
    }
    this.savedLevels.set(this.levels());
    this.savedValues.set(this.params());
    this.justSaved.set(true);
    this.state.notice('quality.savedToast');
  }

  protected discard(): void {
    this.levels.set(this.savedLevels());
    this.params.set(this.savedValues());
  }

  private edit(change: () => void): void {
    this.justSaved.set(false);
    change();
  }

  private numberValid(param: QualityParam, value: ParamValue | undefined): boolean {
    return typeof value === 'number' && value >= (param.min ?? -Infinity) && value <= (param.max ?? Infinity);
  }
}
