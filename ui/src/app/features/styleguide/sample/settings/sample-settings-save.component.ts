import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { SfSaveState, SfSaveStatusComponent } from '../../../../shared/components/layout/sf-save-status.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SettingsState } from './settings-state';

/**
 * A Settings sub-page's one save area (README decision 11, M35.13): the save status (`sf-save-status`: Saved, Unsaved
 * changes, Not saved — N errors) in a polite live region and a primary Save that is enabled only while the page has
 * unsaved changes. Projected into the page header's actions.
 */
@Component({
  selector: 'sf-sample-settings-save',
  standalone: true,
  imports: [SfButtonComponent, SfSaveStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-save.component.html',
  styleUrl: './sample-settings-save.component.scss',
})
export class SampleSettingsSaveComponent {
  protected readonly t = inject(SettingsState).t;

  readonly dirty = input.required<boolean>();
  /** The number of errors that refused the last save (0: none). */
  readonly errors = input(0);

  protected state(): SfSaveState {
    return this.errors() > 0 ? 'error' : this.dirty() ? 'dirty' : 'saved';
  }
  readonly save = output<void>();
}
