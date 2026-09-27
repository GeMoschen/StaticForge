import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';
import { COMPACTED_TIME_TRAVEL_NOTICE } from './compaction.util';
import { TimeTravelStore } from './time-travel.store';

type RevisionView = components['schemas']['RevisionView'];

/**
 * The bar above a project while it shows a past revision. It adds the compacted-history notice (M29.5.2) when the
 * travelled-to revision is itself compacted (`RevisionView.compacted` from the loaded revision list) or when a read at
 * it came back compacted (`TimeTravelStore.readCompacted`: `X-SF-Compacted` / `AssetDetailView.compacted`) — the
 * revision flag alone misses a revision whose own changes were kept but whose assets show a later same-day state.
 */
@Component({
  selector: 'sf-time-travel-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (timeTravel.isTimeTravel()) {
      <div class="shell__timemachine">
        <span class="shell__timemachine-text">
          <span class="shell__timemachine-label">Viewing revision {{ timeTravel.activeRevision() }}</span>
          @if (compacted()) {
            <span class="shell__timemachine-compacted">{{ compactedNotice }}</span>
          }
        </span>
        <button class="shell__timemachine-back" type="button" (click)="back.emit()">Back to now</button>
      </div>
    }
  `,
  styleUrl: './time-travel-banner.component.scss',
})
export class TimeTravelBannerComponent {
  protected readonly timeTravel = inject(TimeTravelStore);

  /** The project's loaded revisions (the spine's list). */
  readonly revisions = input<RevisionView[]>([]);
  readonly back = output<void>();

  protected readonly compactedNotice = COMPACTED_TIME_TRAVEL_NOTICE;

  protected readonly compacted = computed(() => {
    const revision = this.timeTravel.activeRevision();
    if (revision === null) {
      return false;
    }
    return (
      this.timeTravel.readCompacted() ||
      this.revisions().some((r) => r.revisionId === revision && r.compacted === true)
    );
  });
}
