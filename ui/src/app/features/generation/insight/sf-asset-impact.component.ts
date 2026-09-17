import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { TimeTravelStore } from '../../revisions/time-travel.store';
import { GenerationService } from '../generation.service';
import {
  firstEdgeRows,
  impactHeadline,
  type AssetImpactView,
  type EntryPage,
  type PlanEntryQuery,
} from './insight.util';
import { SfPlanEntriesTableComponent } from './sf-plan-entries-table.component';

/**
 * "Impact" panel (M22.3.2): what a change to this asset would rebuild, with each output's chain back to it. Collapsed
 * until opened, and only then asks the server (impact over a whole site isn't free). Always shows the current state,
 * also in time travel, and reloads when {@link refreshKey} changes (after a save, whose reference rows it reads).
 */
@Component({
  selector: 'sf-asset-impact',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfPlanEntriesTableComponent],
  template: `
    <section class="impact" [attr.aria-labelledby]="headingId">
      <h3 class="impact__heading" [id]="headingId">
        <button type="button" class="impact__toggle" [attr.aria-expanded]="open()" (click)="toggle()">
          <span aria-hidden="true">{{ open() ? '▾' : '▸' }}</span>
          Impact
          <span class="impact__asof">{{ asOf() }}</span>
        </button>
      </h3>
      @if (open()) {
        @if (impact(); as data) {
          <p class="impact__headline" aria-live="polite">{{ headline() }}</p>
          @if (edges().length > 0) {
            <ul class="impact__edges">
              @for (edge of edges(); track edge.key) {
                <li>{{ edge.count }} · {{ edge.label }}</li>
              }
            </ul>
          }
        }
        <sf-plan-entries-table
          [fetch]="fetch"
          [projectKey]="projectKey()"
          [impact]="true"
          [reloadKey]="refreshKey()"
          emptyText="Nothing would rebuild."
        />
      }
    </section>
  `,
  styles: [
    `
      .impact {
        display: flex;
        flex-direction: column;
        gap: var(--sf-2);
        min-width: 0;
      }
      .impact__heading {
        margin: 0;
        font-size: var(--sf-text-sm);
      }
      .impact__toggle {
        display: inline-flex;
        align-items: baseline;
        gap: var(--sf-1);
        border: none;
        background: transparent;
        padding: 0;
        color: var(--sf-ink);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .impact__asof {
        font-weight: 400;
        color: var(--sf-slate);
        font-size: var(--sf-text-xs);
      }
      .impact__headline {
        margin: 0;
        font-size: var(--sf-text-sm);
      }
      .impact__edges {
        margin: 0;
        padding-left: var(--sf-4);
        font-size: var(--sf-text-xs);
        color: var(--sf-slate);
      }
    `,
  ],
})
export class SfAssetImpactComponent {
  readonly projectKey = input.required<string>();
  readonly assetUuid = input.required<string>();
  /** Changing it reloads the impact (pass the asset's revision after a save). */
  readonly refreshKey = input<unknown>(null);

  private readonly api = inject(GenerationService);
  private readonly timeTravel = inject(TimeTravelStore);
  private static nextId = 0;

  protected readonly headingId = `sf-asset-impact-${SfAssetImpactComponent.nextId++}`;
  protected readonly open = signal(false);
  protected readonly impact = signal<AssetImpactView | null>(null);
  protected readonly headline = computed(() => impactHeadline(this.impact()));
  protected readonly edges = computed(() => firstEdgeRows(this.impact()?.byFirstEdge, 'the asset itself'));
  protected readonly asOf = computed(() => {
    const revision = this.timeTravel.activeRevision();
    return revision === null ? 'as of now' : `reflects the current state, not revision ${revision}`;
  });

  /** One stable loader: the table reloads when the asset or the refresh key changes, not on every check. */
  private readonly loader = computed(() => {
    const projectKey = this.projectKey();
    const assetUuid = this.assetUuid();
    return (query: PlanEntryQuery): Observable<EntryPage | undefined> =>
      this.api.assetImpact(projectKey, assetUuid, query).pipe(
        tap((impact) => this.impact.set(impact)),
        map((impact) => impact.entries),
      );
  });

  protected get fetch(): (query: PlanEntryQuery) => Observable<EntryPage | undefined> {
    return this.loader();
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}
