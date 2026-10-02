import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { railGroups } from '../../core/frame/rail-model';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ArchivedBannerComponent } from '../dashboard/archived-banner.component';
import { HistoryDrawerComponent } from '../history/history-drawer.component';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { TimeTravelBannerComponent } from '../revisions/time-travel-banner.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { FrameRailComponent } from './frame-rail.component';
import { FrameTopbarComponent } from './frame-topbar.component';

/**
 * The frame every authenticated screen lives in (M35.10): the top bar across, the banner region (archived project, time
 * travel) below it, then the rail and the main region. Landmarks: `header` (top bar), `nav` (rail), `main`. The rail is
 * left out where there is nothing to navigate (the project list, the account page).
 */
@Component({
  selector: 'sf-app-frame',
  standalone: true,
  imports: [
    ArchivedBannerComponent,
    FrameRailComponent,
    FrameTopbarComponent,
    HistoryDrawerComponent,
    RouterOutlet,
    TimeTravelBannerComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-frame.component.html',
  styleUrl: './app-frame.component.scss',
})
export class AppFrameComponent {
  private readonly router = inject(Router);
  private readonly frame = inject(FrameContextStore);
  private readonly developerMode = inject(DeveloperModeService);
  protected readonly project = inject(ProjectContextStore);
  protected readonly timeTravel = inject(TimeTravelStore);
  protected readonly history = inject(HistoryDrawerStore);
  /** Created with the frame: Ctrl/Cmd+S and the tab-close prompt work from the first screen on (M35.13). */
  private readonly editors = inject(ActiveEditorService);

  protected readonly projectKey = this.frame.projectKey;
  protected readonly hasRail = computed(
    () => railGroups({ location: this.frame.location(), developerMode: this.developerMode.enabled() }).length > 0,
  );

  protected backToNow(): void {
    const key = this.frame.projectKey();
    this.timeTravel.exit();
    void this.router.navigate(['/p', key ?? '']);
  }
}
