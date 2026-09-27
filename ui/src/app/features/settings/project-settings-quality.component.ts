import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { problemOf } from '../../core/api/problem.util';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { type QualityRuleItem, type QualityRuleParam, QualityRulesService } from './quality-rules.service';
import {
  type QualityDraft,
  type QualitySeverity,
  SEVERITIES,
  defaultDraftOf,
  draftOf,
  effectiveSeverity,
  errorsByRule,
  fixHintLabel,
  groupRules,
  isCapped,
  maxSeverityOf,
  paramError,
  paramLabel,
  requestOf,
  ruleErrors,
  sameDraft,
  severityOf,
} from './quality-rules.util';

/**
 * Project settings tab "Quality" (M30.6.1, epic decisions 4–6): every build-time quality rule, grouped into links,
 * SEO and accessibility, with its severity (*Off · Warning · Error*) and parameters. Every member reads it;
 * developers change it — the templates own the markup the rules check — with one Save for the whole form, enabled
 * only when something changed and everything is valid. The shown state is the server's until the developer changes
 * it (lessons: no state written only by change handlers); a rule capped at *Warning* (`maxSeverity`) shows its
 * *Error* option disabled, and a stored *Error* on such a rule as the *Warning* it is applied as.
 */
@Component({
  selector: 'sf-project-settings-quality',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent, SfSpinnerComponent],
  templateUrl: './project-settings-quality.component.html',
  styleUrl: './project-settings-quality.component.scss',
})
export class ProjectSettingsQualityComponent {
  readonly projectKey = input.required<string>();

  private readonly api = inject(QualityRulesService);
  private readonly toasts = inject(ToastService);
  protected readonly access = inject(ProjectAccessStore);
  protected readonly permissions = inject(ProjectPermissionsStore);

  protected readonly severities = SEVERITIES;
  protected readonly fixHintLabel = fixHintLabel;
  protected readonly paramLabel = paramLabel;
  protected readonly isCapped = isCapped;
  protected readonly maxSeverityOf = maxSeverityOf;

  /** The rules as the server last sent them; `null` until loaded. */
  private readonly rules = signal<QualityRuleItem[] | null>(null);
  /** The developer's edits by rule code; a rule without an entry is as the server says. */
  private readonly edits = signal<QualityDraft>({});
  /** The server's rejection of the last save, by rule, and the messages naming no rule. */
  private readonly serverErrors = signal<{ byCode: Record<string, string[]>; other: string[] }>({
    byCode: {},
    other: [],
  });

  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** Set after a save that changed the rules, until the next edit: the next incremental build is a full build. */
  protected readonly savedChange = signal(false);

  protected readonly loaded = computed(() => this.rules() !== null);
  protected readonly groups = computed(() => groupRules(this.rules() ?? []));
  protected readonly channelsNote = computed(() => this.rules()?.find((rule) => rule.channels)?.channels ?? '');
  protected readonly editable = this.permissions.canEditQualityRules;

  /** Every rule's draft: the developer's edit, else the server's configuration. */
  protected readonly draft = computed<QualityDraft>(() => {
    const edits = this.edits();
    const draft: QualityDraft = {};
    for (const rule of this.rules() ?? []) {
      const code = rule.code ?? '';
      draft[code] = edits[code] ?? draftOf(rule);
    }
    return draft;
  });

  /** The form's own validation errors by rule code (bounds, whole numbers, minimum ≤ maximum). */
  protected readonly clientErrors = computed<Record<string, string[]>>(() => {
    const draft = this.draft();
    const errors: Record<string, string[]> = {};
    for (const rule of this.rules() ?? []) {
      const problems = ruleErrors(rule, draft[rule.code ?? '']);
      if (problems.length > 0) {
        errors[rule.code ?? ''] = problems;
      }
    }
    return errors;
  });

  protected readonly dirty = computed(() => {
    const draft = this.draft();
    return (this.rules() ?? []).some((rule) => !sameDraft(draft[rule.code ?? ''], draftOf(rule)));
  });
  protected readonly valid = computed(() => Object.keys(this.clientErrors()).length === 0);
  protected readonly otherErrors = computed(() => this.serverErrors().other);

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.load(key));
    });
  }

  /** The severity the segmented control marks: the configured one as the server applies it (capped). */
  protected shownSeverity(rule: QualityRuleItem): QualitySeverity {
    return effectiveSeverity(rule, this.draft()[rule.code ?? '']?.severity ?? severityOf(rule.severity));
  }

  /** A stored severity the rule can't take (an *Error* on a rule capped at *Warning*, set through the API). */
  protected storedAboveCap(rule: QualityRuleItem): boolean {
    const severity = this.draft()[rule.code ?? '']?.severity;
    return severity !== undefined && isCapped(rule, severity);
  }

  protected paramText(rule: QualityRuleItem, param: QualityRuleParam): string {
    const value = this.draft()[rule.code ?? '']?.params[param.name ?? ''];
    return typeof value === 'string' ? value : '';
  }

  protected paramChecked(rule: QualityRuleItem, param: QualityRuleParam): boolean {
    return this.draft()[rule.code ?? '']?.params[param.name ?? ''] === true;
  }

  protected paramInvalid(rule: QualityRuleItem, param: QualityRuleParam): boolean {
    const value = this.draft()[rule.code ?? '']?.params[param.name ?? ''];
    return value !== undefined && paramError(param, value) !== null;
  }

  protected errorsOf(rule: QualityRuleItem): string[] {
    const code = rule.code ?? '';
    return [...(this.clientErrors()[code] ?? []), ...(this.serverErrors().byCode[code] ?? [])];
  }

  protected atDefault(rule: QualityRuleItem): boolean {
    return sameDraft(this.draft()[rule.code ?? ''], defaultDraftOf(rule));
  }

  protected isDefaultSeverity(rule: QualityRuleItem, severity: QualitySeverity): boolean {
    return severityOf(rule.defaultSeverity) === severity;
  }

  protected setSeverity(rule: QualityRuleItem, severity: QualitySeverity): void {
    if (!this.editable() || isCapped(rule, severity)) {
      return;
    }
    this.edit(rule, (draft) => ({ ...draft, severity }));
  }

  protected setIntegerParam(rule: QualityRuleItem, param: QualityRuleParam, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.edit(rule, (draft) => ({ ...draft, params: { ...draft.params, [param.name ?? '']: text } }));
  }

  protected setBooleanParam(rule: QualityRuleItem, param: QualityRuleParam, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.edit(rule, (draft) => ({ ...draft, params: { ...draft.params, [param.name ?? '']: checked } }));
  }

  protected resetRule(rule: QualityRuleItem): void {
    this.edit(rule, () => defaultDraftOf(rule));
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
        this.savedChange.set(true);
        this.toasts.show('Quality rules saved.', 'success');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const problem = problemOf(err, 'Could not save the quality rules — try again.');
        const codes = rules.map((rule) => rule.code ?? '');
        const mapped = errorsByRule(problem.errors, codes);
        this.serverErrors.set(
          problem.errors.length > 0 ? mapped : { byCode: {}, other: [problem.detail] },
        );
      },
    });
  }

  /** Applies `change` to `rule`'s draft (kept as typed: `dirty` compares values, so an edit back is no change). */
  private edit(rule: QualityRuleItem, change: (draft: QualityDraft[string]) => QualityDraft[string]): void {
    if (!this.editable() || this.saving()) {
      return;
    }
    const code = rule.code ?? '';
    const next = change(this.draft()[code] ?? draftOf(rule));
    this.edits.update((edits) => ({ ...edits, [code]: next }));
    this.serverErrors.update(({ byCode, other }) => {
      const rest = { ...byCode };
      delete rest[code];
      return { byCode: rest, other };
    });
    this.savedChange.set(false);
  }

  private load(projectKey: string): void {
    this.rules.set(null);
    this.edits.set({});
    this.serverErrors.set({ byCode: {}, other: [] });
    this.loadError.set(null);
    this.savedChange.set(false);
    this.api.get(projectKey).subscribe({
      next: (view) => this.rules.set(view.rules ?? []),
      error: () => this.loadError.set('Could not load the quality rules — reload the page to try again.'),
    });
  }
}
