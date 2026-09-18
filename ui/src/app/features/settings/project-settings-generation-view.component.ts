import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { GenerationComponent } from '../generation/generation.component';
import { ProjectSettingsTargetsComponent } from './project-settings-targets.component';

/**
 * The "Generation" project settings tab: one scrollable page stacking the generation targets
 * above the generation runs, which used to be the separate "Targets" and "Generation" tabs.
 * Each section stays its own component; this container only orders them and owns the page's
 * scrolling.
 */
@Component({
  selector: 'sf-project-settings-generation-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectSettingsTargetsComponent, GenerationComponent],
  templateUrl: './project-settings-generation-view.component.html',
  styleUrl: './project-settings-generation-view.component.scss',
})
export class ProjectSettingsGenerationViewComponent {
  readonly projectKey = input.required<string>();
}
