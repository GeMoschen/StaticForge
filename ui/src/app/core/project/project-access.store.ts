import { Injectable, computed, inject, signal } from '@angular/core';
import { TimeTravelStore } from '../../features/revisions/time-travel.store';
import { AuthStore } from '../auth/auth.store';

/**
 * Whether the open project can be changed right now. Editors that aren't gated by role gate on `readOnly`: true while
 * viewing a past revision (time travel) and in an archived project (M26), where the server refuses every write.
 *
 * `ProjectContextStore` reports the project it loads through {@link enterProject}; the archived flag itself lives in
 * `AuthStore`, which also lowers the effective role in an archived project to `VIEWER`.
 */
@Injectable({ providedIn: 'root' })
export class ProjectAccessStore {
  private readonly auth = inject(AuthStore);
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly projectKey = signal<string | null>(null);

  readonly archived = computed(() => this.auth.isArchived(this.projectKey()));
  readonly readOnly = computed(() => this.timeTravel.isTimeTravel() || this.archived());
  /** Why the project is read-only, for the notice editors show; empty when it isn't. */
  readonly readOnlyLabel = computed(() =>
    this.timeTravel.isTimeTravel()
      ? 'Viewing a past revision — read-only'
      : this.archived()
        ? 'Archived project — read-only'
        : '',
  );

  /** The project the app is in now, and whether the server says it is archived. */
  enterProject(projectKey: string, archived: boolean): void {
    this.projectKey.set(projectKey);
    this.auth.setProjectArchived(projectKey, archived);
  }
}
