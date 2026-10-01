import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { SfSearchInputComponent } from '../../shared/components/forms/sf-search-input.component';
import { SfPopoverComponent, SfPopoverTriggerDirective } from '../../shared/components/popover/sf-popover.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { switcherGroups, toggleFavorite, type ProjectSummary } from './project-switcher.util';

/**
 * The project switcher (M35.10): a menu button naming the open project, with search, favorites, recents and all
 * projects, and "All projects" for the list at `/`. Opening a project makes it a recent one.
 */
@Component({
  selector: 'sf-project-switcher',
  standalone: true,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfPopoverComponent,
    SfPopoverTriggerDirective,
    SfSearchInputComponent,
    SfSpinnerComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-switcher.component.html',
  styleUrl: './project-switcher.component.scss',
})
export class ProjectSwitcherComponent {
  private readonly api = inject(ApiClient);
  private readonly frame = inject(FrameContextStore);
  protected readonly preferences = inject(PreferencesService);

  private readonly popover = viewChild.required<SfPopoverComponent>('switcher');

  protected readonly projects = signal<readonly ProjectSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly query = signal('');

  protected readonly current = this.frame.projectKey;
  /** The trigger's text: the open project's name; `null` outside a project. */
  protected readonly currentName = computed(() => this.frame.projectName() ?? this.current());

  protected readonly groups = computed(() =>
    switcherGroups(this.projects(), this.preferences.favoriteProjects(), this.preferences.recentProjects(), this.query()),
  );

  constructor() {
    // Opening a project makes it a recent one.
    effect(() => {
      const key = this.current();
      if (key !== null) {
        untracked(() => this.preferences.addRecentProject(key));
      }
    });
    // The list is read each time the switcher opens, so a new project shows up without a reload.
    effect(() => {
      if (this.popover().open()) {
        untracked(() => this.load());
      } else {
        untracked(() => this.query.set(''));
      }
    });
  }

  protected isFavorite(key: string | undefined): boolean {
    return !!key && this.preferences.favoriteProjects().includes(key);
  }

  protected toggleFavorite(key: string | undefined): void {
    if (key) {
      this.preferences.setFavoriteProjects(toggleFavorite(this.preferences.favoriteProjects(), key));
    }
  }

  protected nameOf(project: ProjectSummary): string {
    return project.name ?? project.key ?? '';
  }

  /** Arrow keys move between the rows of the open list; from the search box ↓ enters it and ↑ from the first row leaves it. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const panel = event.currentTarget as HTMLElement;
    const rows = Array.from(panel.querySelectorAll<HTMLElement>('.switcher__link'));
    if (rows.length === 0) {
      return;
    }
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : index - 1;
    event.preventDefault();
    if (next < 0) {
      panel.querySelector<HTMLInputElement>('input')?.focus();
    } else {
      rows[next].focus();
    }
  }

  private load(): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.listProjects().subscribe({
      next: (projects) => {
        this.projects.set(projects ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }
}
