import { signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import type { components } from '../../../core/api/generated/schema.d.ts';

type S = components['schemas'];

export type RuleEvaluationRequest = S['RuleEvaluationRequest'];
export type RuleEvaluationView = S['RuleEvaluationView'];
export type RuleFill = S['RuleFill'];
export type FieldState = S['FieldState'];
export type RuleFinding = S['ContentIssue'];

/** How long the evaluator waits after the last change before asking the server (M33.8). */
export const RULE_EVALUATION_DEBOUNCE_MS = 400;

/**
 * Live editor rules for one form (M33.8): asks `POST /rules/evaluate` with the unsaved value, debounced, and keeps only
 * the answer to the latest request — an answer that arrives after a newer request was sent is dropped, so a slow
 * response can't overwrite a fresher one. A failed request (rate limit, network) leaves the last result in place.
 *
 * <p>One per form (page content, a record, a property set); not a singleton. Call {@link dispose} when the form goes.
 */
export class RuleEvaluator {
  /** The latest answer, or `null` before the first one. */
  readonly result = signal<RuleEvaluationView | null>(null);

  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Subscription | null = null;

  constructor(
    private readonly send: (request: RuleEvaluationRequest) => Observable<RuleEvaluationView>,
    private readonly debounceMs: number = RULE_EVALUATION_DEBOUNCE_MS,
    private readonly onResult: ((view: RuleEvaluationView) => void) | null = null,
  ) {}

  /** Evaluates `build()` once the value has been quiet for the debounce; a newer call replaces a pending one. */
  request(build: () => RuleEvaluationRequest | null): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.now(build);
    }, this.debounceMs);
  }

  /** Evaluates `build()` right away (on load); any pending debounced request is dropped. */
  now(build: () => RuleEvaluationRequest | null): void {
    this.cancelTimer();
    const request = build();
    if (!request) {
      return;
    }
    const id = ++this.sequence;
    this.inFlight = this.send(request).subscribe({
      next: (view) => {
        if (id === this.sequence) {
          this.result.set(view);
          this.onResult?.(view);
        }
      },
      error: () => {
        // The last good answer stays; the next change asks again.
      },
    });
  }

  /** Forgets the result, e.g. when the form is rebuilt for another asset. */
  reset(): void {
    this.cancelTimer();
    this.sequence++;
    this.result.set(null);
  }

  dispose(): void {
    this.cancelTimer();
    this.sequence++;
    this.inFlight?.unsubscribe();
    this.inFlight = null;
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
