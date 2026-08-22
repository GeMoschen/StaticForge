import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NavRailComponent } from './nav-rail.component';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { RevisionSpineComponent } from '../revisions/revision-spine.component';
import { TimeTravelStore } from '../revisions/time-travel.store';

@Component({
  selector: 'sf-project-shell',
  standalone: true,
  imports: [RouterOutlet, NavRailComponent, RevisionSpineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-shell.component.html',
  styleUrl: './project-shell.component.scss',
})
export class ProjectShellComponent {
  private readonly router = inject(Router);
  protected readonly store = inject(ProjectContextStore);
  protected readonly timeTravel = inject(TimeTravelStore);

  protected readonly projectKey = this.store.activeProjectKey;

  protected onTick(revision: number): void {
    const key = this.store.activeProjectKey();
    if (!key) {
      return;
    }
    this.timeTravel.enter(revision);
    this.router.navigate(['/p', key, 'settings', 'revisions', revision]);
  }

  protected backToNow(): void {
    const key = this.store.activeProjectKey();
    this.timeTravel.exit();
    this.router.navigate(['/p', key ?? '']);
  }
}
