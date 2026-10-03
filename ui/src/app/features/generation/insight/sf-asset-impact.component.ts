import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
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
  imports: [SfPlanEntriesTableComponent, TranslocoPipe],
  template: `
    <section class="impact" [attr.aria-labelledby]="headingId">
      <h3 class="impact__heading" [id]="headingId">
        <button type="button" class="impact__toggle" [attr.aria-expanded]="open()" (click)="toggle()">
          <span aria-hidden="true">{{ open() ? '▾' : '▸' }}</span>
          {{ heading() ?? ('shared.assetImpact.heading' | transloco) }}
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
          [emptyText]="'shared.assetImpact.empty' | transloco"
        />
      }
    </section>
  `,
  styleUrl: './sf-asset-impact.component.scss',
})
export class SfAssetImpactComponent {
  readonly projectKey = input.required<string>();
  readonly assetUuid = input.required<string>();
  /** Changing it reloads the impact (pass the asset's revision after a save). */
  readonly refreshKey = input<unknown>(null);
  /** The panel's heading; the default ("Impact") unless the host words it for its audience (the page editor: "Pages affected by this change"). */
  readonly heading = input<string | null>(null);

  private readonly api = inject(GenerationService);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly transloco = inject(TranslocoService);
  private static nextId = 0;

  protected readonly headingId = `sf-asset-impact-${SfAssetImpactComponent.nextId++}`;
  protected readonly open = signal(false);
  protected readonly impact = signal<AssetImpactView | null>(null);
  protected readonly headline = computed(() => impactHeadline(this.impact()));
  protected readonly edges = computed(() => firstEdgeRows(this.impact()?.byFirstEdge, 'the asset itself'));
  protected readonly asOf = computed(() => {
    const revision = this.timeTravel.activeRevision();
    return this.transloco.translate(revision === null ? 'shared.assetImpact.asOfNow' : 'shared.assetImpact.notRevision', { revision });
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
