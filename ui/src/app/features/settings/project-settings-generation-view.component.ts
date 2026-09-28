import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { GenerationComponent } from '../generation/generation.component';
import { ProjectSettingsPublishPolicyComponent } from './project-settings-publish-policy.component';
import { ProjectSettingsTargetsComponent } from './project-settings-targets.component';

/**
 * The "Generation" project settings tab: one scrollable page stacking the publishing policy for
 * editors (M28), the generation targets and the generation runs, which used to be the separate "Targets" and "Generation" tabs.
 * Each section stays its own component; this container only orders them and owns the page's
 * scrolling.
 */
@Component({
  selector: 'sf-project-settings-generation-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectSettingsPublishPolicyComponent, ProjectSettingsTargetsComponent, GenerationComponent],
  templateUrl: './project-settings-generation-view.component.html',
  styleUrl: './project-settings-generation-view.component.scss',
})
export class ProjectSettingsGenerationViewComponent {
  readonly projectKey = input.required<string>();
  /** `?run=` opens that run's details (the Schedules history links a run it started, M27.6.5). */
  readonly run = input<string | undefined>();
  /** `?tab=findings` opens that run's findings (M30.6.2): a shared findings view. */
  readonly tab = input<string | undefined>();
  protected readonly runId = computed(() => (this.run() ? Number(this.run()) : null));
}
