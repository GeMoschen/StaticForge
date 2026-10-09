import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { problemOf } from '../../../core/api/problem.util';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../../core/project/project-permissions.store';
import { ToastService } from '../../../core/ui/toast.service';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCheckboxComponent } from '../../../shared/components/forms/sf-checkbox.component';
import { SfNumberInputComponent } from '../../../shared/components/forms/sf-number-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../../shared/components/sf-spinner.component';
import { SfTooltipDirective } from '../../../shared/directives/sf-tooltip.directive';
import { type QualityLastRunView, type QualityRuleItem, type QualityRuleParam, QualityRulesService } from './quality-rules.service';
import {
  type ParamValue,
  type QualityCategory,
  type QualityDraft,
  type QualitySeverity,
  type RuleDraft,
  type RuleGroup,
  SEVERITIES,
  SEVERITY_ICONS,
  defaultDraftOf,
  draftOf,
  effectiveSeverity,
  errorsByRule,
  groupRules,
  groupSeverity,
  invalidParams,
  isCapped,
  maxSeverityOf,
  minAboveMax,
  paramLabel,
  requestOf,
  sameDraft,
  severityOf,
} from './quality.util';

const FIX_KEYS: Readonly<Record<string, string>> = { CONTENT: 'content', TEMPLATE: 'template', CONTENT_OR_TEMPLATE: 'both' };

/**
 * Publishing › Quality (M35.24, gate decisions 27-30, 186-212): a summary first (rules on and off, how many hold pages
 * back, the last run's results), then the rules grouped by category with the Off / Warning / Error segmented control.
 * The long explanations are a one-line hint with the full text in a tooltip.
 *
 * Rules are **saved**, not applied at once: a save bar (status, Discard, Save) and, after saving, the note that the next
 * incremental build runs as a full one. Some rules have settings (a number with its range and default, or a switch); an
 * invalid number marks its field and blocks Save. The default level is marked, a rule that differs from its defaults
 * offers **Reset to default**, a rule capped at Warning disables Error (and says so for a stored Error). Each group can
 * be folded and has its own Off / Warning / Error control that sets all its rules at once. The shown state is the
 * server's until a developer changes it (lessons: no state written only by change handlers). Developers change the
 * rules, everyone else reads them.
 */
@Component({
  selector: 'sf-publishing-quality',
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
    SfSpinnerComponent,
    SfTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quality.component.html',
  styleUrl: './quality.component.scss',
})
export class PublishingQualityComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(QualityRulesService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly dev = inject(DeveloperModeService).enabled;
  protected readonly editable = inject(ProjectPermissionsStore).canEditQualityRules;

  protected readonly paramLabel = paramLabel;

  /** The rules as the server last sent them; `null` until loaded. */
  private readonly rules = signal<QualityRuleItem[] | null>(null);
  /** The developer's edits by rule code; a rule without an entry is as the server says. */
  private readonly edits = signal<QualityDraft>({});
  /** The server's rejection of the last save, by rule, and the messages naming no rule. */
  private readonly serverErrors = signal<{ byCode: Record<string, string[]>; other: string[] }>({ byCode: {}, other: [] });
  /** The last finished run and its findings per rule; `null` while there is none (or it could not be read). */
  protected readonly lastRun = signal<QualityLastRunView | null>(null);
  private readonly collapsed = signal<ReadonlySet<QualityCategory>>(new Set());

  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  /** Set after a save, until the next edit: the next incremental build is a full build. */
  protected readonly justSaved = signal(false);

  protected readonly loaded = computed(() => this.rules() !== null);
  protected readonly groups = computed(() => groupRules(this.rules() ?? []));
  /** Which outputs the rules check (the server sends it with every rule). */
  protected readonly channels = computed(() => this.rules()?.find((rule) => rule.channels)?.channels ?? '');
  protected readonly otherErrors = computed(() => this.serverErrors().other);

  /** Every rule's draft: the developer's edit, else the server's configuration. */
  protected readonly draft = computed<QualityDraft>(() => {
    const edits = this.edits();
    return Object.fromEntries((this.rules() ?? []).map((rule) => [rule.code ?? '', edits[rule.code ?? ''] ?? draftOf(rule)]));
  });

  protected readonly dirty = computed(() => {
    const draft = this.draft();
    return (this.rules() ?? []).some((rule) => !sameDraft(draft[rule.code ?? ''], draftOf(rule)));
  });

  /** The settings (by `code.name`) that are empty or out of range, and the rules whose minimum is above the maximum. */
  private readonly invalid = computed(() => {
    const draft = this.draft();
    const params = new Set<string>();
    const ranges = new Set<string>();
    for (const rule of this.rules() ?? []) {
      const code = rule.code ?? '';
      invalidParams(rule, draft[code]).forEach((name) => params.add(`${code}.${name}`));
      if (minAboveMax(rule, draft[code])) {
        ranges.add(code);
      }
    }
    return { params, ranges };
  });
  protected readonly valid = computed(() => this.invalid().params.size === 0 && this.invalid().ranges.size === 0);

  protected readonly summary = computed(() => {
    const draft = this.draft();
    const applied = (this.rules() ?? []).map((rule) => this.applied(rule, draft));
    return {
      on: applied.filter((level) => level !== 'OFF').length,
      off: applied.filter((level) => level === 'OFF').length,
      errors: applied.filter((level) => level === 'ERROR').length,
    };
  });

  /** The Off / Warning / Error control of a whole group (no default marker: it sets, it does not describe). */
  protected readonly groupOptions = computed<SfSegmentedOption<QualitySeverity>[]>(() =>
    SEVERITIES.map((level) => ({ value: level, label: this.t(`levels.${level.toLowerCase()}`), icon: SEVERITY_ICONS[level] })),
  );

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.load(key));
    });
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`publishing.quality.${key}`, params);
  }

  protected fixKey(rule: QualityRuleItem): string {
    return FIX_KEYS[rule.fixHint ?? ''] ?? 'template';
  }

  /** The findings of `rule` in the last run. */
  protected findings(rule: QualityRuleItem): number {
    return this.lastRun()?.counts?.[rule.code ?? ''] ?? 0;
  }

  protected groupInfo(group: RuleGroup): { on: number; total: number } {
    const draft = this.draft();
    return { on: group.rules.filter((rule) => draft[rule.code ?? '']?.severity !== 'OFF').length, total: group.rules.length };
  }

  protected isCollapsed(category: QualityCategory): boolean {
    return this.collapsed().has(category);
  }

  protected toggleGroup(category: QualityCategory): void {
    this.collapsed.update((all) => {
      const next = new Set(all);
      if (!next.delete(category)) {
        next.add(category);
      }
      return next;
    });
  }

  /** What the build applies: a rule capped at Warning never applies Error, whatever is stored. */
  protected applied(rule: QualityRuleItem, draft: QualityDraft = this.draft()): QualitySeverity {
    return effectiveSeverity(rule, draft[rule.code ?? '']?.severity ?? severityOf(rule.severity));
  }

  /** A stored Error on a rule capped at Warning (set through the API): applied as Warning. */
  protected storedAboveCap(rule: QualityRuleItem): boolean {
    const severity = this.draft()[rule.code ?? '']?.severity;
    return severity !== undefined && isCapped(rule, severity);
  }

  protected isCappedRule(rule: QualityRuleItem): boolean {
    return maxSeverityOf(rule) === 'WARNING';
  }

  protected options(rule: QualityRuleItem): SfSegmentedOption<QualitySeverity>[] {
    const defaultSeverity = severityOf(rule.defaultSeverity);
    return SEVERITIES.map((level) => ({
      value: level,
      label: this.t(`levels.${level.toLowerCase()}`) + (level === defaultSeverity ? ` ${this.t('defaultMarker')}` : ''),
      icon: SEVERITY_ICONS[level],
      disabled: isCapped(rule, level),
    }));
  }

  protected groupLevel(group: RuleGroup): QualitySeverity | null {
    return groupSeverity(group.rules, this.draft());
  }

  protected setGroupLevel(group: RuleGroup, level: QualitySeverity | null): void {
    if (level) {
      this.editMany(group.rules, (rule, draft) => ({ ...draft, severity: effectiveSeverity(rule, level) }));
    }
  }

  protected setLevel(rule: QualityRuleItem, level: QualitySeverity | null): void {
    if (level && !isCapped(rule, level)) {
      this.editMany([rule], (_, draft) => ({ ...draft, severity: level }));
    }
  }

  protected value(rule: QualityRuleItem, param: QualityRuleParam): ParamValue | undefined {
    return this.draft()[rule.code ?? '']?.params[param.name ?? ''];
  }

  protected setParam(rule: QualityRuleItem, param: QualityRuleParam, value: ParamValue): void {
    this.editMany([rule], (_, draft) => ({ ...draft, params: { ...draft.params, [param.name ?? '']: value } }));
  }

  protected isInvalid(rule: QualityRuleItem, param: QualityRuleParam): boolean {
    return this.invalid().params.has(`${rule.code}.${param.name}`);
  }

  protected rangeInvalid(rule: QualityRuleItem): boolean {
    return this.invalid().ranges.has(rule.code ?? '');
  }

  protected serverErrorsOf(rule: QualityRuleItem): string[] {
    return this.serverErrors().byCode[rule.code ?? ''] ?? [];
  }

  /** Whether the level or a setting differs from the rule's defaults. */
  protected differs(rule: QualityRuleItem): boolean {
    return !sameDraft(this.draft()[rule.code ?? ''], defaultDraftOf(rule));
  }

  protected reset(rule: QualityRuleItem): void {
    this.editMany([rule], () => defaultDraftOf(rule));
  }

  protected discard(): void {
    this.edits.set({});
    this.serverErrors.set({ byCode: {}, other: [] });
  }

  protected save(): void {
    const rules = this.rules();
    if (!rules || !this.dirty() || !this.valid() || this.saving() || !this.editable()) {
      return;
    }
    this.saving.set(true);
    this.api.update(this.projectKey(), requestOf(rules, this.draft())).subscribe({
      next: (view) => {
        this.saving.set(false);
        this.rules.set(view.rules ?? []);
        this.edits.set({});
        this.serverErrors.set({ byCode: {}, other: [] });
        this.justSaved.set(true);
        this.toasts.show(this.t('savedToast'), 'success');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, this.t('saveFailed'));
        this.serverErrors.set(
          problem.errors.length > 0
            ? errorsByRule(problem.errors, rules.map((rule) => rule.code ?? ''))
            : { byCode: {}, other: [problem.detail] },
        );
      },
    });
  }

  /** Applies `change` to the draft of each of `rules`; an edit answers the server's refusal of those rules. */
  private editMany(rules: readonly QualityRuleItem[], change: (rule: QualityRuleItem, draft: RuleDraft) => RuleDraft): void {
    if (!this.editable() || this.saving()) {
      return;
    }
    const current = this.draft();
    this.edits.update((edits) => ({
      ...edits,
      ...Object.fromEntries(rules.map((rule) => [rule.code ?? '', change(rule, current[rule.code ?? ''] ?? draftOf(rule))])),
    }));
    this.serverErrors.update(({ byCode, other }) => {
      const rest = { ...byCode };
      rules.forEach((rule) => delete rest[rule.code ?? '']);
      return { byCode: rest, other };
    });
    this.justSaved.set(false);
  }

  private load(projectKey: string): void {
    this.rules.set(null);
    this.edits.set({});
    this.serverErrors.set({ byCode: {}, other: [] });
    this.lastRun.set(null);
    this.loadError.set(false);
    this.justSaved.set(false);
    this.api.get(projectKey).subscribe({
      next: (view) => this.rules.set(view.rules ?? []),
      error: () => this.loadError.set(true),
    });
    // The counts are extra: without them the page is the rules alone.
    this.api.lastRun(projectKey).subscribe({
      next: (view) => this.lastRun.set(view.run ? view : null),
      error: () => this.lastRun.set(null),
    });
  }
}
