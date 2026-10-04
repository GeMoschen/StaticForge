import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import type { CodePalettePreference, DensityPreference, ThemePreference } from '../../core/preferences/preferences.types';
import { CodePaletteService } from '../../core/ui/code-palette.service';
import { DensityService } from '../../core/ui/density.service';
import { ThemeService } from '../../core/ui/theme.service';
import { SfSegmentedComponent, SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';

/**
 * My account › Preferences: theme, density, code palette, developer mode and the language. They apply the moment they change (they are
 * the same preferences as the top bar's appearance menu (the code palette is only here)), so there is no Save here. Developer mode is offered to people
 * with developer rights only. The language is shown but read-only — English is the only one yet, and the page says so.
 */
@Component({
  selector: 'sf-account-preferences',
  standalone: true,
  imports: [SfFieldComponent, SfPageHeaderComponent, SfSegmentedComponent, SfSelectComponent, SfSwitchComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-preferences.component.scss',
  template: `
    <sf-page-header [title]="'account.sections.preferences' | transloco" />

    <div class="page__scroll">
      <p class="page__note">{{ 'account.preferences.note' | transloco }}</p>
      <div class="page__form">
        <sf-field [label]="'account.preferences.theme' | transloco" [hint]="'account.preferences.themeHint' | transloco">
          <sf-segmented [options]="themeOptions()" [value]="theme.preference()" (valueChange)="setTheme($event)" />
        </sf-field>
        <sf-field [label]="'account.preferences.density' | transloco" [hint]="'account.preferences.densityHint' | transloco">
          <sf-segmented [options]="densityOptions()" [value]="density.density()" (valueChange)="setDensity($event)" />
        </sf-field>
        <sf-field [label]="'account.preferences.codePalette' | transloco" [hint]="'account.preferences.codePaletteHint' | transloco">
          <sf-segmented [options]="codePaletteOptions()" [value]="codePalette.palette()" (valueChange)="setCodePalette($event)" />
        </sf-field>
        @if (developer.available()) {
          <sf-field [label]="'account.preferences.developer' | transloco" [hint]="'account.preferences.developerHint' | transloco">
            <sf-switch [value]="developer.enabled()" (valueChange)="developer.set($event)">{{ 'account.preferences.developerSwitch' | transloco }}</sf-switch>
          </sf-field>
        }
        <sf-field [label]="'account.preferences.language' | transloco" [hint]="'account.preferences.languageHint' | transloco">
          <sf-select disabled [options]="languageOptions" value="en" />
        </sf-field>
      </div>
    </div>
  `,
})
export class AccountPreferencesComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly density = inject(DensityService);
  protected readonly codePalette = inject(CodePaletteService);
  protected readonly developer = inject(DeveloperModeService);
  private readonly transloco = inject(TranslocoService);

  protected readonly themeOptions = computed<SfSegmentedOption<ThemePreference>[]>(() => [
    { value: 'light', label: this.transloco.translate('account.preferences.light'), icon: 'light_mode' },
    { value: 'dark', label: this.transloco.translate('account.preferences.dark'), icon: 'dark_mode' },
    { value: 'system', label: this.transloco.translate('account.preferences.system'), icon: 'computer' },
  ]);
  protected readonly densityOptions = computed<SfSegmentedOption<DensityPreference>[]>(() => [
    { value: 'compact', label: this.transloco.translate('account.preferences.compact') },
    { value: 'comfortable', label: this.transloco.translate('account.preferences.comfortable') },
  ]);
  protected readonly codePaletteOptions = computed<SfSegmentedOption<CodePalettePreference>[]>(() => [
    { value: 'current', label: this.transloco.translate('account.preferences.paletteCurrent') },
    { value: 'refined', label: this.transloco.translate('account.preferences.paletteRefined') },
  ]);
  // The language file is English only; the select names it in its own language.
  protected readonly languageOptions: SfSelectOption<string>[] = [{ value: 'en', label: 'English' }];

  protected setTheme(value: ThemePreference | null): void {
    if (value) {
      this.theme.set(value);
    }
  }

  protected setCodePalette(value: CodePalettePreference | null): void {
    if (value) {
      this.codePalette.set(value);
    }
  }

  protected setDensity(value: DensityPreference | null): void {
    if (value) {
      this.density.set(value);
    }
  }
}
