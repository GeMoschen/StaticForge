import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SampleDensity, SampleState, SampleThemeChoice } from '../sample-state';
import { AccountState } from './account-state';

/**
 * My account › Preferences: theme, density, developer mode and the language. They apply the moment they change (they
 * are the same preferences as the top bar's appearance menu), so there is no Save here. The language is shown but
 * read-only — English is the only one yet, and the page says so.
 */
@Component({
  selector: 'sf-sample-account-preferences',
  standalone: true,
  imports: [SfFieldComponent, SfPageHeaderComponent, SfSegmentedComponent, SfSelectComponent, SfSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-preferences.component.scss',
  template: `
    <sf-page-header [title]="t('sections.preferences')" />

    <div class="page__scroll">
      <p class="page__note">{{ t('preferences.note') }}</p>
      <div class="page__form">
        <sf-field [label]="t('preferences.theme')" [hint]="t('preferences.themeHint')">
          <sf-segmented [options]="themeOptions()" [value]="sample.theme()" (valueChange)="setTheme($event)" />
        </sf-field>
        <sf-field [label]="t('preferences.density')" [hint]="t('preferences.densityHint')">
          <sf-segmented [options]="densityOptions()" [value]="sample.density()" (valueChange)="setDensity($event)" />
        </sf-field>
        <sf-field [label]="t('preferences.developer')" [hint]="t('preferences.developerHint')">
          <sf-switch [value]="sample.devMode()" (valueChange)="sample.devMode.set($event)">{{ t('preferences.developerSwitch') }}</sf-switch>
        </sf-field>
        <sf-field [label]="t('preferences.language')" [hint]="t('preferences.languageHint')">
          <sf-select disabled [options]="languageOptions" value="en" />
        </sf-field>
      </div>
    </div>
  `,
})
export class SampleAccountPreferencesComponent {
  protected readonly sample = inject(SampleState);
  protected readonly t = inject(AccountState).t;

  protected readonly themeOptions = computed<SfSegmentedOption<SampleThemeChoice>[]>(() => [
    { value: 'light', label: this.t('preferences.light'), icon: 'light_mode' },
    { value: 'dark', label: this.t('preferences.dark'), icon: 'dark_mode' },
    { value: 'system', label: this.t('preferences.system'), icon: 'computer' },
  ]);
  protected readonly densityOptions = computed<SfSegmentedOption<SampleDensity>[]>(() => [
    { value: 'compact', label: this.t('preferences.compact') },
    { value: 'comfortable', label: this.t('preferences.comfortable') },
  ]);
  protected readonly languageOptions: SfSelectOption<string>[] = [{ value: 'en', label: 'English' }];

  protected setTheme(value: SampleThemeChoice | null): void {
    if (value) {
      this.sample.theme.set(value);
    }
  }

  protected setDensity(value: SampleDensity | null): void {
    if (value) {
      this.sample.density.set(value);
    }
  }
}
