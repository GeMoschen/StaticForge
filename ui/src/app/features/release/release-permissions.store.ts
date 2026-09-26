import { Injectable, computed, inject } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { roleRank } from '../../core/auth/auth.guard';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';

/**
 * Who may change release state in the open project (epic decision 15). M27 asks for `DEVELOPER` for every release,
 * unpublish, discard and schedule operation, and nothing in a read-only project (time travel, archived). One
 * computed per operation, so `M28` swaps them for server-provided permissions here and nowhere else.
 */
@Injectable({ providedIn: 'root' })
export class ReleasePermissionsStore {
  private readonly auth = inject(AuthStore);
  private readonly access = inject(ProjectAccessStore);
  private readonly project = inject(ProjectContextStore);

  private readonly developer = computed(() => {
    const key = this.project.activeProjectKey();
    return !!key && roleRank(this.auth.roleFor(key)) >= roleRank('DEVELOPER');
  });

  /** Whether the project can change now: not time travel, not archived. */
  readonly writable = computed(() => !this.access.readOnly());

  readonly canRelease = computed(() => this.developer() && this.writable());
  readonly canUnpublish = computed(() => this.developer() && this.writable());
  readonly canDiscard = computed(() => this.developer() && this.writable());
  /** Every schedule operation: create, edit, cancel, run now, take over, re-pin. */
  readonly canSchedule = computed(() => this.developer() && this.writable());
}
