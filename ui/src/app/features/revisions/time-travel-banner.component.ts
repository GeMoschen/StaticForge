import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { HistoryActions } from '../history/history-actions.service';
import { HistoryRow, formatRevisionTime } from '../history/history-rows';
import { HistoryService } from '../history/history.service';
import { COMPACTED_TIME_TRAVEL_NOTICE } from './compaction.util';
import { TimeTravelStore } from './time-travel.store';

/**
 * The time-travel banner (M35.12, signed off in the style guide): a calm strip under the top bar for as long as the
 * screens show an old state — "Viewing revision 86 · 12 Sep, 14:03 · by Jonas Weber", a *Read-only* badge, **Back to
 * now** and **Restore this state** (a project roll-back: a danger action with a typed confirmation, project admins
 * only). The frame around the screens carries a matching accent. It adds the compacted-history notice (M29.5.2) when
 * the travelled-to revision is itself compacted or a read at it came back compacted (`TimeTravelStore.readCompacted`:
 * the revision flag alone misses a revision whose own changes were kept but whose assets show a later same-day state).
 */
@Component({
  selector: 'sf-time-travel-banner',
  standalone: true,
  imports: [SfBadgeComponent, SfButtonComponent, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (timeTravel.isTimeTravel()) {
      <div class="tt" role="status">
        <sf-icon class="tt__icon" name="history_toggle_off" />
        <p class="tt__text">
          <strong>{{ 'history.banner.viewing' | transloco: { n: timeTravel.activeRevision() } }}</strong>
          @if (row(); as revision) {
            <span class="tt__meta">{{ when() }} · {{ 'history.banner.by' | transloco: { name: revision.byName } }}</span>
          }
        </p>
        <sf-badge tone="info" icon="lock" [label]="'history.banner.readOnly' | transloco" />
        <span class="tt__actions">
          <sf-button variant="secondary" size="sm" icon="arrow_back" (click)="back.emit()">{{
            'history.banner.back' | transloco
          }}</sf-button>
          @if (canRollBack() && row(); as revision) {
            <sf-button variant="secondary" size="sm" icon="restore" (click)="restore(revision)">{{
              'history.banner.restore' | transloco
            }}</sf-button>
          }
        </span>
        @if (compacted()) {
          <span class="tt__compacted">{{ compactedNotice }}</span>
        }
      </div>
    }
  `,
  styleUrl: './time-travel-banner.component.scss',
})
export class TimeTravelBannerComponent {
  protected readonly timeTravel = inject(TimeTravelStore);
  private readonly frame = inject(FrameContextStore);
  private readonly service = inject(HistoryService);
  private readonly actions = inject(HistoryActions);
  private readonly permissions = inject(ProjectPermissionsStore);
  private readonly transloco = inject(TranslocoService);

  readonly back = output<void>();

  protected readonly compactedNotice = COMPACTED_TIME_TRAVEL_NOTICE;
  /** The revision being viewed, once loaded. */
  protected readonly row = signal<HistoryRow | null>(null);
  protected readonly when = computed(() => (this.row() ? formatRevisionTime(this.row()!.at) : ''));
  /**
   * Rolling a project back is for project admins (the server's rule; an archived project lowers everyone to viewer).
   * Not `canAdminProject`: that is false while time travelling, which is exactly when this button is shown.
   */
  protected readonly canRollBack = this.permissions.isProjectAdmin;

  protected readonly compacted = computed(() => this.timeTravel.readCompacted() || this.row()?.compacted === true);

  constructor() {
    effect(() => {
      const revision = this.timeTravel.activeRevision();
      const key = this.frame.projectKey();
      this.row.set(null);
      if (revision !== null && key !== null) {
        untracked(() =>
          this.service.revision(key, revision).subscribe({
            next: (row) => {
              if (this.timeTravel.activeRevision() === revision) {
                this.row.set(row);
              }
            },
          }),
        );
      }
    }, { allowSignalWrites: true });
  }

  protected restore(row: HistoryRow): void {
    void this.actions.rollBack(row);
  }
}
