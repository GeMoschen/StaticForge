import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { BuildStatusStore } from '../frame/build-status.store';
import { RUN_STATUS_ICONS, RUN_STATUS_TONES, isActiveRun, runStatusOf } from './runs/runs.util';

/**
 * The Publishing page header's status (M35.24, gate decision 27): the build in progress, if any, and the last finished
 * one, as status pills. Read from the top bar's build status, so both always agree.
 */
@Component({
  selector: 'sf-publishing-status',
  standalone: true,
  imports: [SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (active(); as run) {
      <sf-status
        size="sm"
        [tone]="tones[status(run)]"
        [icon]="icons[status(run)]"
        [label]="'publishing.runs.number' | transloco: { n: run.id }"
        [detail]="'publishing.runs.status.' + status(run) | transloco"
      />
    }
    @if (last(); as run) {
      <sf-status
        size="sm"
        [tone]="tones[status(run)]"
        [icon]="icons[status(run)]"
        [label]="'publishing.header.lastBuild' | transloco: { n: run.id }"
        [detail]="'publishing.runs.status.' + status(run) | transloco"
      />
    }
  `,
  styles: ':host { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--sf-space-2); }',
})
export class PublishingStatusComponent {
  private readonly builds = inject(BuildStatusStore);

  protected readonly tones = RUN_STATUS_TONES;
  protected readonly icons = RUN_STATUS_ICONS;
  protected readonly status = runStatusOf;

  protected readonly active = computed(() => this.builds.runs().find(isActiveRun) ?? null);
  protected readonly last = computed(() => this.builds.runs().find((run) => !isActiveRun(run)) ?? null);
}
