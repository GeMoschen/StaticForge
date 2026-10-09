import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { areaNav, type NavArea } from '../../core/frame/area-nav';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSideNavComponent, type SfSideNavItem } from '../../shared/components/layout/sf-side-nav.component';

/**
 * An area with sub-pages — Publishing or Settings (M35.11): a secondary side menu (`sf-side-nav`, M35.9 decisions
 * 28–29), then the open sub-page under its own page header (the page's one `h1`). The sub-page is a child route in the
 * outlet. Below 1024 px the menu is a select above the page. What the menu lists follows `areaNav`. An area can add a
 * status and actions to the page header: content marked `sfAreaStatus` / `sfAreaActions`.
 */
@Component({
  selector: 'sf-area-shell',
  standalone: true,
  imports: [RouterOutlet, SfPageHeaderComponent, SfSideNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './area-shell.component.html',
  styleUrl: './area-shell.component.scss',
})
export class AreaShellComponent {
  readonly area = input.required<NavArea>();

  private readonly transloco = inject(TranslocoService);
  private readonly frame = inject(FrameContextStore);
  private readonly developerMode = inject(DeveloperModeService);
  private readonly permissions = inject(ProjectPermissionsStore);

  protected readonly items = computed<SfSideNavItem[]>(() => {
    const area = this.area();
    return areaNav(area, {
      developerMode: this.developerMode.enabled(),
      projectAdmin: this.permissions.readsAsProjectAdmin(),
    }).map((entry) => ({
      id: entry.id,
      label: this.transloco.translate(`frame.sub.${area}.${entry.id}`),
      icon: entry.icon,
      link: entry.id,
      group: entry.group ? this.transloco.translate(`frame.sidenav.group.${entry.group}`) : undefined,
    }));
  });

  protected readonly label = computed(() => this.transloco.translate(`frame.sidenav.${this.area()}`));

  /** The open sub-page's name; the menu entries and the header share it. */
  protected readonly title = computed(() => {
    const { sub } = this.frame.location();
    return this.transloco.translate(sub ? `frame.sub.${this.area()}.${sub}` : `frame.section.${this.area()}`);
  });
}
