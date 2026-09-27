import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ChannelsComponent } from '../channels/channels.component';
import { ProjectSettingsCompactionComponent } from './project-settings-compaction.component';
import { ProjectSettingsGeneralComponent } from './project-settings-general.component';
import { ProjectSettingsLocalesComponent } from './project-settings-locales.component';
import { ProjectSettingsMediaComponent } from './project-settings-media.component';

/**
 * The "General" project settings tab: one scrollable page stacking what used to be four
 * separate tabs — General, Channels, Languages and Media — plus revision compaction (M29.5.2) under General. Each section stays its own
 * component with its own state and API calls; this container only orders them and owns the
 * page's scrolling.
 */
@Component({
  selector: 'sf-project-settings-general-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ProjectSettingsGeneralComponent,
    ProjectSettingsCompactionComponent,
    ChannelsComponent,
    ProjectSettingsLocalesComponent,
    ProjectSettingsMediaComponent,
  ],
  templateUrl: './project-settings-general-view.component.html',
  styleUrl: './project-settings-general-view.component.scss',
})
export class ProjectSettingsGeneralViewComponent {
  readonly projectKey = input.required<string>();
}
