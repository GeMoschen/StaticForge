import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ReleaseEventsStore } from '../release/release-events.store';

/**
 * The open project inside the app frame (M35.10): loads what every content screen reads synchronously (the project's
 * languages and the language last edited), refreshes the folder trees after release actions and ends time travel when
 * the user leaves. The top bar, rail, banners and the History drawer are the frame's.
 */
@Component({
  selector: 'sf-project-shell',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-shell.component.html',
  styleUrl: './project-shell.component.scss',
})
export class ProjectShellComponent {
  protected readonly store = inject(ProjectContextStore);
  protected readonly timeTravel = inject(TimeTravelStore);

  private readonly locales = inject(LocalesStore);
  private readonly editingLocale = inject(EditingLocaleStore);

  protected readonly projectKey = this.store.activeProjectKey;
  private readonly releaseEvents = inject(ReleaseEventsStore);

  constructor() {
    // Time travel is a view of *this* project: leaving it (the project list, another project, sign-out) ends it —
    // otherwise the viewed revision, its read-only banner and the write block follow the user out.
    inject(DestroyRef).onDestroy(() => this.timeTravel.exit());
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
}
