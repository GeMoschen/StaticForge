import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SettingsState } from './settings-state';

/**
 * A Settings sub-page's one save area (README decision 11, M35.13): the save status in a polite live region and a
 * primary Save that is enabled only while the page has unsaved changes. Projected into the page header's actions.
 */
@Component({
  selector: 'sf-sample-settings-save',
  standalone: true,
  imports: [SfButtonComponent, SfStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-save.component.html',
  styleUrl: './sample-settings-save.component.scss',
})
export class SampleSettingsSaveComponent {
  protected readonly t = inject(SettingsState).t;

  readonly dirty = input.required<boolean>();
  readonly save = output<void>();
}
