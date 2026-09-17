import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { chainLines, otherCausesLabel, reasonBadge, type ReasonView } from './insight.util';

/**
 * One rebuild reason (M22.3.1): the root badge and the chain from the planned asset back to the change, as an ordered
 * list read top to bottom ("page:about — uses template", "page_template:article — links to", "media:hero"). Used by the
 * generation dialog, a run's rebuilt pages and the asset impact panel, so a reason reads the same everywhere.
 */
@Component({
  selector: 'sf-rebuild-reason',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="reason">
      <span class="reason__badge" [attr.data-kind]="reason()?.rootKind">{{ badge() }}</span>
      @if (lines().length > 0) {
        <ol class="reason__chain" aria-label="Why this is rebuilt, from the output to the change">
          @for (line of lines(); track $index; let last = $last) {
            <li class="reason__step">
              <span class="reason__asset">{{ line.asset }}</span>
              @if (line.edge) {
                <span class="reason__edge">{{ line.edge }}</span>
              }
              @if (line.sourcePath) {
                <code class="reason__path">{{ line.sourcePath }}</code>
              }
              @if (last && !impact()) {
                @if (reason()?.rootRevision; as revision) {
                  <a class="reason__revision" [routerLink]="['/p', projectKey(), 'settings', 'revisions', revision]">
                    {{ reason()?.rootKind === 'ASSET_DELETED' ? 'deleted' : 'changed' }} in r{{ revision }}
                  </a>
                }
              }
            </li>
          }
        </ol>
      }
      @if (others()) {
        <span class="reason__others">{{ others() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .reason {
        display: flex;
        flex-direction: column;
        gap: var(--sf-1);
        font-size: var(--sf-text-sm);
        color: var(--sf-ink);
      }
      .reason__badge {
        align-self: flex-start;
        padding: 0 var(--sf-2);
        border-radius: var(--sf-radius-sm);
        border: 1px solid var(--sf-line);
        font-size: var(--sf-text-xs);
        font-weight: 600;
      }
      .reason__badge[data-kind='ASSET_CHANGED'],
      .reason__badge[data-kind='ASSET_DELETED'] {
        color: var(--sf-signal);
      }
      .reason__badge[data-kind='INCREMENTAL_FALLBACK_FULL'],
      .reason__badge[data-kind='NOT_IN_BASE_BUILD'] {
        color: var(--sf-amber);
      }
      .reason__chain {
        margin: 0;
        padding-left: var(--sf-5, 1.25rem);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .reason__step {
        overflow-wrap: anywhere;
      }
      .reason__asset {
        font-family: var(--sf-font-mono);
      }
      .reason__edge {
        margin-left: var(--sf-1);
        color: var(--sf-slate);
      }
      .reason__edge::before {
        content: '— ';
      }
      .reason__path {
        margin-left: var(--sf-1);
        font-size: var(--sf-text-xs);
        color: var(--sf-slate);
      }
      .reason__revision {
        margin-left: var(--sf-2);
        font-size: var(--sf-text-xs);
      }
      .reason__others {
        font-size: var(--sf-text-xs);
        color: var(--sf-slate);
      }
    `,
  ],
})
export class SfRebuildReasonComponent {
  readonly reason = input<ReasonView | undefined>(undefined);
  readonly projectKey = input<string>('');
  /** Impact mode: the root is the asset the panel belongs to ("this asset"), and has no revision. */
  readonly impact = input(false);

  protected readonly badge = computed(() => (this.impact() ? 'Would rebuild' : reasonBadge(this.reason())));
  protected readonly lines = computed(() => chainLines(this.reason(), this.impact()));
  protected readonly others = computed(() => (this.impact() ? '' : otherCausesLabel(this.reason())));
}
