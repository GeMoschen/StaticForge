import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ProjectSettingsExportComponent } from './project-settings-export.component';
import { ProjectSettingsImportComponent } from './project-settings-import.component';

/**
 * Project settings tab: "Import / Export" (`M10`) — hosts the export picker
 * ({@link ProjectSettingsExportComponent}) and the import/conflict-review panel
 * ({@link ProjectSettingsImportComponent}) side by side under one tab, matching how
 * other multi-concern settings tabs lay out independent panels in one body.
 */
@Component({
  selector: 'sf-project-settings-import-export',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectSettingsExportComponent, ProjectSettingsImportComponent],
  templateUrl: './project-settings-import-export.component.html',
  styleUrl: './project-settings-import-export.component.scss',
})
export class ProjectSettingsImportExportComponent {
  readonly projectKey = input.required<string>();
}
