import { ChangeDetectionStrategy, Component, effect, inject, untracked } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ArchivedBannerComponent } from './archived-banner.component';
import { NavRailComponent } from './nav-rail.component';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { RevisionSpineComponent } from '../revisions/revision-spine.component';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ReleaseEventsStore } from '../release/release-events.store';

@Component({
  selector: 'sf-project-shell',
  standalone: true,
  imports: [RouterOutlet, NavRailComponent, RevisionSpineComponent, ArchivedBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-shell.component.html',
  styleUrl: './project-shell.component.scss',
})
export class ProjectShellComponent {
  private readonly router = inject(Router);
  protected readonly store = inject(ProjectContextStore);
  protected readonly timeTravel = inject(TimeTravelStore);

  protected readonly locales = inject(LocalesStore);
  protected readonly editingLocale = inject(EditingLocaleStore);

  protected readonly projectKey = this.store.activeProjectKey;
  private readonly releaseEvents = inject(ReleaseEventsStore);

  constructor() {
    // A release action (M27.6) is a revision, and it changes the statuses the folder trees show.
    effect(() => {
      if (this.releaseEvents.version() === 0) {
        return;
      }
      const key = untracked(() => this.projectKey());
      if (key) {
        untracked(() => {
          this.store.refreshFolderTrees(key);
          this.store.refreshRevision(key);
        });
      }
    });
    // The project's languages and the language last edited in it load with the project itself, so
    // every content screen can read them synchronously (M24.4.1).
    effect(
      () => {
        const key = this.projectKey();
        if (!key) {
          this.locales.clear();
          return;
        }
        this.locales.load(key).subscribe({
          next: () => this.editingLocale.restore(key),
          error: () => {
            /* a project whose languages can't be loaded simply behaves as single-language */
          },
        });
      },
      { allowSignalWrites: true },
    );
  }

  /** Switches the language every content editor, the preview and the search palette work in. */
  protected switchLocale(locale: string): void {
    const key = this.projectKey();
    if (key) {
      this.editingLocale.set(key, locale);
    }
  }

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
