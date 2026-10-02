import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionService } from '../../core/auth/session.service';
import { buildBreadcrumb } from '../../core/frame/breadcrumb.util';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { DensityService } from '../../core/ui/density.service';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ThemeService } from '../../core/ui/theme.service';
import { DensityPreference, ThemePreference } from '../../core/preferences/preferences.types';
import { SfAvatarComponent } from '../../shared/components/display/sf-avatar.component';
import { SfKbdComponent } from '../../shared/components/display/sf-kbd.component';
import { SfLogoComponent } from '../../shared/components/display/sf-logo.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../shared/components/forms/sf-segmented.component';
import { SfSelectComponent, SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../../shared/components/popover/sf-popover.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { BuildStatusComponent } from './build-status.component';
import { FrameBreadcrumbComponent } from './frame-breadcrumb.component';
import { ProjectSwitcherComponent } from './project-switcher.component';

/**
 * The top bar of the app frame (M35.10), one for every authenticated screen, on the dark chrome: product mark, project
 * switcher, breadcrumb, search, editing language, build status and *Build now*, History, appearance (theme, density,
 * developer mode), the shortcut sheet and the user menu. The design-system components read the semantic tokens, so the
 * bar re-points those at the `--sf-chrome-*` tokens (see the stylesheet) instead of restyling each component.
 */
@Component({
  selector: 'sf-frame-topbar',
  standalone: true,
  imports: [
    BuildStatusComponent,
    FrameBreadcrumbComponent,
    ProjectSwitcherComponent,
    SfAvatarComponent,
    SfButtonComponent,
    SfFieldComponent,
    SfKbdComponent,
    SfLogoComponent,
    SfPopoverComponent,
    SfPopoverTriggerDirective,
    SfSegmentedComponent,
    SfSelectComponent,
    SfSwitchComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './frame-topbar.component.html',
  styleUrl: './frame-topbar.component.scss',
})
export class FrameTopbarComponent {
  private readonly auth = inject(AuthStore);
  private readonly session = inject(SessionService);
  private readonly transloco = inject(TranslocoService);
  private readonly shortcuts = inject(ShortcutService);
  protected readonly frame = inject(FrameContextStore);
  protected readonly theme = inject(ThemeService);
  protected readonly density = inject(DensityService);
  protected readonly developerMode = inject(DeveloperModeService);
  protected readonly locales = inject(LocalesStore);
  protected readonly editingLocale = inject(EditingLocaleStore);

  private readonly userPopover = viewChild.required<SfPopoverComponent>('userMenu');

  protected readonly inProject = computed(() => this.frame.location().kind === 'project');
  protected readonly historyLink = computed(() => ['/p', this.frame.projectKey() ?? '', 'history']);

  protected readonly crumbs = computed(() =>
    buildBreadcrumb({
      location: this.frame.location(),
      label: (key) => this.transloco.translate(key),
      item: this.frame.item(),
    }),
  );

  protected readonly name = computed(() => this.auth.displayName() ?? this.auth.username() ?? '');
  protected readonly username = this.auth.username;
  protected readonly isInstanceAdmin = this.auth.isInstanceAdmin;

  /** The editing-language select is for a project with more than one language; the bar is narrow, so it shows codes. */
  protected readonly languageOptions = computed<SfSelectOption<string>[] | null>(() => {
    const locales = this.locales.locales();
    return this.inProject() && locales.length > 1
      ? locales.map((locale) => ({ value: locale.code ?? '', label: (locale.code ?? '').toUpperCase() }))
      : null;
  });

  protected readonly themeOptions = computed<SfSegmentedOption<ThemePreference>[]>(() => [
    { value: 'light', label: this.transloco.translate('frame.topbar.themeLight'), icon: 'light_mode' },
    { value: 'dark', label: this.transloco.translate('frame.topbar.themeDark'), icon: 'dark_mode' },
    { value: 'system', label: this.transloco.translate('frame.topbar.themeSystem'), icon: 'computer' },
  ]);
  protected readonly densityOptions = computed<SfSegmentedOption<DensityPreference>[]>(() => [
    { value: 'compact', label: this.transloco.translate('frame.topbar.compact') },
    { value: 'comfortable', label: this.transloco.translate('frame.topbar.comfortable') },
  ]);

  protected openSearch(): void {
    this.shortcuts.commandPaletteOpen.set(true);
  }

  protected openShortcuts(): void {
    this.shortcuts.shortcutSheetOpen.set(true);
  }

  protected switchLocale(locale: string | null): void {
    const key = this.frame.projectKey();
    if (key && locale) {
      this.editingLocale.set(key, locale);
    }
  }

  protected signOut(): void {
    this.userPopover().close(false);
    this.session.signOut();
  }
}
