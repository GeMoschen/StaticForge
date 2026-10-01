import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../../shared/components/popover/sf-popover.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { BuildNowService } from '../generation/build-now.service';
import { BuildStatusStore } from './build-status.store';
import { iconOf, stateOfRun, toneOf } from './build-status.util';

/**
 * The top bar's build status (M35.10): the last build's state (a spinner while one runs) that opens the recent builds,
 * and *Build now* for people who may start an incremental build. While a build runs, *Build now* stays but is disabled
 * with the reason — a temporary state, not a missing permission.
 */
@Component({
  selector: 'sf-build-status',
  standalone: true,
  imports: [
    SfButtonComponent,
    SfIconComponent,
    SfPopoverComponent,
    SfPopoverTriggerDirective,
    SfRelativeTimeComponent,
    SfSpinnerComponent,
    SfStatusComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './build-status.component.html',
  styleUrl: './build-status.component.scss',
})
export class BuildStatusComponent {
  private readonly frame = inject(FrameContextStore);
  private readonly buildNowService = inject(BuildNowService);
  protected readonly status = inject(BuildStatusStore);
  protected readonly permissions = inject(ProjectPermissionsStore);

  protected readonly running = computed(() => this.status.state() === 'running');
  protected readonly icon = computed(() => iconOf(this.status.state()));
  protected readonly tone = computed(() => toneOf(this.status.state()));
  /** When the newest build ended (or started, while it runs). */
  protected readonly when = computed(() => {
    const run = this.status.latest();
    return run?.finishedAt ?? run?.startedAt ?? null;
  });

  /** Until Publishing is a screen of its own (M35.11), the builds live on the Generation page of Settings. */
  protected readonly generationLink = computed(() => ['/p', this.frame.projectKey() ?? '', 'settings', 'generation']);

  protected readonly stateOfRun = stateOfRun;
  protected readonly toneOf = toneOf;

  protected buildNow(): void {
    const key = this.frame.projectKey();
    if (key && !this.running()) {
      this.buildNowService.start(key, 'Build now');
    }
  }
}
