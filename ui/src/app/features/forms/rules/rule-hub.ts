import { signal } from '@angular/core';
import type { RuleEvaluationView } from './rule-evaluator';

/**
 * The latest editor-rules answer of one evaluated asset, shared with every form inside it (M33): a page's body
 * sections and the catalog cards anywhere in it read their fills and field states from here by their path prefix
 * (`bodies.main[0].content`, `content.teasers.cards[1].content`), and register how to blank the fields that still
 * hold their last live fill before the next request (so the server computes them again).
 */
export class RuleHub {
  /** The latest answer; `null` before the first one or while nothing is evaluated. */
  readonly view = signal<RuleEvaluationView | null>(null);

  private readonly preparers = new Set<(root: Record<string, unknown>) => void>();

  /** Registers a form's request preparation; returns the unregistration. */
  register(prepare: (root: Record<string, unknown>) => void): () => void {
    this.preparers.add(prepare);
    return () => this.preparers.delete(prepare);
  }

  /** Lets every registered form blank its last live fills in `root` (`{content, bodies}` of the request). */
  prepare(root: Record<string, unknown>): void {
    for (const prepare of this.preparers) {
      prepare(root);
    }
  }
}
