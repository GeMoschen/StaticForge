import { FormGroup } from '@angular/forms';
import type { EditorDefinition } from '../form.model';
import type { RuleEvaluationView } from './rule-evaluator';
import { RuleHub } from './rule-hub';
import { FillTracker, applyFieldStates } from './rule-form.util';

/**
 * Live editor rules on a form nested in an evaluated asset (M33): a page's body section or a catalog card. It takes
 * the fills and field states under its path prefix from the asset's {@link RuleHub} and blanks its own last live
 * fills before each request. The prefix follows the form (a reordered section is `bodies.main[1]` now); a changed
 * prefix starts a fresh fill memory.
 */
export class NestedRules {
  private tracker: FillTracker | null = null;
  private disabled = new Set<string>();
  private unregister: (() => void) | null = null;
  private hub: RuleHub | null = null;

  /**
   * (Re)attaches to `hub` under `prefix`; `form` and `editors` are read when a request is prepared.
   */
  attach(
    hub: RuleHub | null,
    prefix: string,
    form: () => FormGroup,
    editors: () => readonly EditorDefinition[],
  ): void {
    if (this.hub === hub && this.tracker?.prefix === prefix) {
      return;
    }
    this.detach();
    this.hub = hub;
    this.tracker = new FillTracker(prefix);
    this.disabled = new Set();
    if (hub) {
      const tracker = this.tracker;
      this.unregister = hub.register((root) => tracker.blankFilled(root, form(), editors()));
    }
  }

  /**
   * Applies an answer to the form: fills (without an event) and read-only states. Returns whether a fill wrote a
   * value — the host then passes the new value up without counting it as an edit.
   */
  apply(
    view: RuleEvaluationView | null,
    form: FormGroup,
    editors: readonly EditorDefinition[],
    locale: string | null,
  ): boolean {
    if (!view || !this.tracker) {
      return false;
    }
    const prefix = this.tracker.prefix;
    const written = this.tracker.apply(view.fills ?? [], form, editors, locale);
    this.disabled = applyFieldStates(view.fieldStates ?? [], form, editors, this.disabled, locale, prefix);
    return written.length > 0;
  }

  detach(): void {
    this.unregister?.();
    this.unregister = null;
    this.hub = null;
    this.tracker = null;
  }
}
