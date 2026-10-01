import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfTextareaComponent } from '../../../../shared/components/forms/sf-textarea.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSectionComponent } from '../../../../shared/components/layout/sf-section.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SampleSettingsSaveComponent } from './sample-settings-save.component';
import { GeneralForm, PROJECT_KEY } from './settings-data';
import { SettingsState } from './settings-state';

/**
 * Settings › General: name, description, the project key (read-only; copyable in developer mode) and the default
 * editing language, with the page's save area; a danger zone at the bottom archives the project after a typed
 * confirmation of the project key.
 */
@Component({
  selector: 'sf-sample-settings-general',
  standalone: true,
  imports: [
    SampleSettingsSaveComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfFieldComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfSectionComponent,
    SfSelectComponent,
    SfTextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-settings-general.component.html',
  styleUrl: './sample-settings-general.component.scss',
})
export class SampleSettingsGeneralComponent {
  protected readonly state = inject(SettingsState);
  protected readonly t = this.state.t;
  private readonly confirms = inject(ConfirmService);
  protected readonly projectKey = PROJECT_KEY;

  protected readonly languageOptions = computed<SfSelectOption<string>[]>(() =>
    this.state.languages().map((l) => ({ value: l.code, label: l.label })),
  );

  protected patch(change: Partial<GeneralForm>): void {
    this.state.general.update((g) => ({ ...g, ...change }));
  }

  protected save(): void {
    this.state.generalSaved.set(this.state.general());
    this.state.notice();
  }

  protected async archive(): Promise<void> {
    const confirmed = await this.confirms.confirm({
      title: this.t('general.archiveTitle', { name: this.state.generalSaved().name }),
      message: this.t('general.archiveMessage'),
      confirmLabel: this.t('general.archiveConfirm'),
      tone: 'danger',
      typeToConfirm: PROJECT_KEY,
    });
    if (confirmed) {
      this.state.notice();
    }
  }
}
