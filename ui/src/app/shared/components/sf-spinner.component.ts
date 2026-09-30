import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Small inline loading indicator. Replaces bare "Loading…" text and the
 * misuse of sf-empty-state as a pseudo-loading placeholder.
 */
@Component({
  selector: 'sf-spinner',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sf-spinner" role="status">
      <span class="sf-spinner__ring" aria-hidden="true"></span>
      <span class="sf-spinner__label">{{ label() ?? ('common.loading' | transloco) }}</span>
    </div>
  `,
  styles: [
    `
      .sf-spinner {
        display: inline-flex;
        align-items: center;
        gap: var(--sf-2);
        padding: var(--sf-4);
        color: var(--sf-slate);
        font-family: var(--sf-font-ui);
        font-size: var(--sf-text-sm);
      }

      .sf-spinner__ring {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        border-radius: 50%;
        border: 2px solid var(--sf-line);
        border-top-color: var(--sf-signal);
        animation: sf-spin 700ms linear infinite;
      }
    `,
  ],
})
export class SfSpinnerComponent {
  /** The visible and announced text; the shared "Loading…" when omitted. */
  readonly label = input<string | null>(null);
}
