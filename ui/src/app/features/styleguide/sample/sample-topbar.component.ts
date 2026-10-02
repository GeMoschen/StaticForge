import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfKbdComponent } from '../../../shared/components/display/sf-kbd.component';
import { SfLogoComponent } from '../../../shared/components/display/sf-logo.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfMenuComponent, SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../../../shared/components/popover/sf-popover.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfSpinnerComponent } from '../../../shared/components/sf-spinner.component';
import { ToastService } from '../../../core/ui/toast.service';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { CURRENT_PROJECT, CURRENT_USER, PROJECTS, RUNS, SAMPLE_LANGS, SampleLang } from './sample-data';
import { SampleDensity, SampleState, SampleThemeChoice } from './sample-state';

const BUILD_MS = 2500;

/**
 * The mocked M35.10 top bar on the dark chrome: mark, project switcher, breadcrumb, palette trigger, editing language,
 * build status and *Build now*, History, appearance (theme, density, developer mode), shortcut sheet and user menu.
 * The design-system components re-read the semantic tokens, so the bar re-points them at the `--sf-chrome-*` tokens
 * (see the stylesheet) instead of restyling each component.
 */
@Component({
  selector: 'sf-sample-topbar',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SfAvatarComponent,
    SfButtonComponent,
    SfFieldComponent,
    SfIconComponent,
    SfKbdComponent,
    SfLogoComponent,
    SfMenuComponent,
    SfPopoverComponent,
    SfPopoverTriggerDirective,
    SfRelativeTimeComponent,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSpinnerComponent,
    SfStatusComponent,
    SfSwitchComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-topbar.component.html',
  styleUrl: './sample-topbar.component.scss',
})
export class SampleTopbarComponent {
  protected readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);

  protected readonly project = CURRENT_PROJECT;
  protected readonly user = CURRENT_USER;
  protected readonly runs = RUNS;
  protected readonly building = signal(false);
  /** The last run's end; *Build now* moves it to "just now". */
  protected readonly lastRun = signal(Date.now() - RUNS[0].minutes * 60_000);
  protected readonly now = Date.now();

  private readonly userPopover = viewChild.required<SfPopoverComponent>('userMenu');
  private buildTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly languages: SfSelectOption<SampleLang>[] = SAMPLE_LANGS.map((lang) => ({ value: lang, label: lang.toUpperCase() }));

  /** The switcher: a search entry (the palette), favorites, recents and "All projects". */
  protected readonly projectItems = computed<SfMenuItem[]>(() => {
    const favorites = this.state.t('topbar.favorites');
    const recents = this.state.t('topbar.recents');
    const pick = (name: string) => () => this.state.notice('topbar.switchNotice', { name });
    return [
      { id: 'find', label: this.state.t('topbar.projectSearch'), icon: 'search', shortcut: 'Mod+K', action: () => this.palette() },
      ...PROJECTS.filter((p) => p.favorite).map((p) => ({ id: p.key, label: p.name, icon: 'star', group: favorites, action: pick(p.name) })),
      ...PROJECTS.filter((p) => p.recent && !p.favorite).map((p) => ({
        id: p.key,
        label: p.name,
        icon: 'history',
        group: recents,
        action: pick(p.name),
      })),
      {
        id: 'all',
        label: this.state.t('topbar.allProjects'),
        icon: 'apps',
        separatorBefore: true,
        action: () => this.state.notice('topbar.allProjectsNotice'),
      },
    ];
  });

  protected readonly themeOptions = computed<SfSegmentedOption<SampleThemeChoice>[]>(() => [
    { value: 'light', label: this.state.t('topbar.themeLight'), icon: 'light_mode' },
    { value: 'dark', label: this.state.t('topbar.themeDark'), icon: 'dark_mode' },
    { value: 'system', label: this.state.t('topbar.themeSystem'), icon: 'computer' },
  ]);
  protected readonly densityOptions = computed<SfSegmentedOption<SampleDensity>[]>(() => [
    { value: 'compact', label: this.state.t('topbar.compact') },
    { value: 'comfortable', label: this.state.t('topbar.comfortable') },
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.buildTimer && clearTimeout(this.buildTimer));
  }

  protected home(): void {
    this.state.openFolder(null);
  }

  protected palette(): void {
    this.state.paletteQuery.set('');
  }

  protected buildNow(): void {
    if (this.building()) {
      return;
    }
    this.building.set(true);
    this.toasts.show(this.state.t('topbar.buildStarted'), 'info');
    this.buildTimer = setTimeout(() => {
      this.building.set(false);
      this.lastRun.set(Date.now());
      this.buildTimer = null;
    }, BUILD_MS);
  }

  protected userAction(key: string): void {
    this.userPopover().close(true);
    this.state.notice(key);
  }

  /** Account, Administration and Sign out lead to the M35.16 screens of the sample. */
  protected async goTo(area: 'account' | 'admin' | 'login'): Promise<void> {
    this.userPopover().close(true);
    if (await this.state.canLeave()) {
      this.state.openArea(area);
    }
  }

  protected runLabel(outcome: 'published' | 'warnings'): string {
    return this.state.t(outcome === 'published' ? 'topbar.runPublished' : 'topbar.runWarnings');
  }

  protected minutesAgo(minutes: number): number {
    return this.now - minutes * 60_000;
  }
}
