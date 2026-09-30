import { computed } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Observable } from 'rxjs';
import type { EditorDefinition } from '../form.model';
import {
  FieldState,
  RuleEvaluationRequest,
  RuleEvaluationView,
  RuleEvaluator,
  RuleFinding,
  RULE_EVALUATION_DEBOUNCE_MS,
} from './rule-evaluator';
import { FillTracker, applyFieldStates } from './rule-form.util';

/** The form a {@link RuleBinding} evaluates, and how to ask the server about it. */
export interface RuleTarget {
  form: FormGroup;
  editors: readonly EditorDefinition[];
  /** The language edited, `null` without languages. */
  locale: string | null;
  /** The content object to evaluate: the form's value, every language included. */
  content: () => Record<string, unknown>;
  /** The request for `content` (`null` to skip, e.g. while the definition isn't known). */
  request: (content: Record<string, unknown>) => RuleEvaluationRequest | null;
}

/**
 * Live editor rules on one content form (M33.8): evaluates on load and, debounced, on every change; applies the fills
 * ({@link FillTracker}) and the read-only states to the form; exposes the findings and field states for the form to
 * show. Rebind when the form is rebuilt (another asset, another language).
 */
export class RuleBinding {
  private readonly evaluator: RuleEvaluator;
  private target: RuleTarget | null = null;
  private fills = new FillTracker();
  private disabled = new Set<string>();

  /** The latest findings of the `edit` scope (every level; the form decides what to show). */
  readonly findings = computed<RuleFinding[]>(() => this.evaluator.result()?.findings ?? []);
  readonly fieldStates = computed<FieldState[]>(() => this.evaluator.result()?.fieldStates ?? []);
  /** Whether an answer has arrived for the bound form. */
  readonly evaluated = computed(() => this.evaluator.result() !== null);

  constructor(
    send: (request: RuleEvaluationRequest) => Observable<RuleEvaluationView>,
    debounceMs: number = RULE_EVALUATION_DEBOUNCE_MS,
  ) {
    this.evaluator = new RuleEvaluator(send, debounceMs, (view) => this.apply(view));
  }

  /** Binds a (new) form and evaluates it right away. */
  bind(target: RuleTarget): void {
    this.evaluator.reset();
    this.target = target;
    this.fills = new FillTracker();
    this.disabled = new Set();
    this.evaluator.now(() => this.build());
  }

  /** Stops evaluating (a read-only form, time travel). */
  unbind(): void {
    this.evaluator.reset();
    this.target = null;
  }

  /** The form changed: evaluate again once it is quiet. */
  changed(): void {
    if (this.target) {
      this.evaluator.request(() => this.build());
    }
  }

  dispose(): void {
    this.evaluator.dispose();
    this.target = null;
  }

  private build(): RuleEvaluationRequest | null {
    const target = this.target;
    if (!target) {
      return null;
    }
    return target.request(this.fills.prepare(target.content(), target.form, target.editors));
  }

  private apply(view: RuleEvaluationView): void {
    const target = this.target;
    if (!target) {
      return;
    }
    this.fills.apply(view.fills ?? [], target.form, target.editors, target.locale);
    this.disabled = applyFieldStates(view.fieldStates ?? [], target.form, target.editors, this.disabled, target.locale);
  }
}

/**
 * What a form shows after a save attempt: the live findings, and the findings of a save the rule gate rejected that
 * the live ones don't already hold (save-scope rules don't run live).
 */
export function mergeFindings<T extends LooseFinding>(live: readonly T[], rejected: readonly LooseFinding[]): T[] {
  const key = (f: LooseFinding) => `${f.path ?? ''}|${f.code ?? ''}|${f.rule ?? ''}|${f.locale ?? ''}|${f.message ?? ''}`;
  const seen = new Set(live.map(key));
  return [...live, ...(rejected.filter((f) => !seen.has(key(f))) as T[])];
}

/** A finding as the forms read it, whatever its wire type says of its enums. */
export interface LooseFinding {
  path?: string;
  code?: string;
  rule?: string;
  locale?: string;
  message?: string;
  severity?: string;
}
