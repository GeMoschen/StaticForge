import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../../../shared/components/display/sf-tag.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText } from '../changes/sample-area.util';
import { formatRevisionTime, injectHistoryActions } from './history-actions';
import { HISTORY_KIND_ICONS, HISTORY_TYPE_ICONS, HistoryAction, HistoryRevision } from './history-data';
import { SampleHistoryDiffComponent } from './sample-history-diff.component';

const ACTION_TONES: Readonly<Record<HistoryAction, 'info' | 'warning' | 'danger' | 'success' | 'neutral'>> = {
  created: 'info',
  changed: 'warning',
  deleted: 'danger',
  released: 'success',
  restored: 'neutral',
};
const ACTION_ICONS: Readonly<Record<HistoryAction, string>> = {
  created: 'fiber_new',
  changed: 'edit_note',
  deleted: 'delete_forever',
  released: 'publish',
  restored: 'restore',
};

/**
 * The detail pane of the full history page (M35.9 review round 2, M35.12): the revision's number (the pane's h2), its
 * time, author and kind, then **the assets it changed, by name** — each with its type, what happened, the languages
 * and the field changes as a diff (old −, new +; never UUIDs). Actions: **View this state** (time travel),
 * **Restore this asset** per asset (confirm, then Undo) and **Roll back project to this revision** (danger, typed
 * confirmation — instance and project admins only in the app).
 */
@Component({
  selector: 'sf-sample-history-revision',
  standalone: true,
  imports: [SampleHistoryDiffComponent, SfAvatarComponent, SfButtonComponent, SfIconComponent, SfStatusComponent, SfTagComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-history-revision.component.html',
  styleUrl: './sample-history-revision.component.scss',
  host: { role: 'region', 'aria-labelledby': 'sample-history-rev-title' },
})
export class SampleHistoryRevisionComponent {
  readonly revision = input.required<HistoryRevision>();
  readonly closed = output<void>();

  protected readonly t = injectSampleText('styleguide.sample.history');
  private readonly actions = injectHistoryActions();
  protected readonly tones = ACTION_TONES;
  protected readonly icons = ACTION_ICONS;
  protected readonly typeIcons = HISTORY_TYPE_ICONS;
  protected readonly kindIcons = HISTORY_KIND_ICONS;
  protected readonly when = computed(() => formatRevisionTime(this.revision().minutes));

  protected view(): void {
    this.actions.view(this.revision());
  }

  protected rollBack(): void {
    void this.actions.rollBack(this.revision());
  }

  protected restore(index: number): void {
    const revision = this.revision();
    void this.actions.restoreAsset(revision, revision.assets[index]);
  }
}
