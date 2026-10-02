import { Injectable, computed, inject } from '@angular/core';
import { AuthStore } from '../auth/auth.store';
import { roleRank } from '../auth/auth.guard';
import { PreferencesService } from '../preferences/preferences.service';
import { FrameContextStore } from './frame-context.store';

/**
 * Developer mode (M35.10, epic decisions 7 and 19). Only people with developer rights can have it: in a project, a
 * developer or admin *of that project* (an editor there sees the editor view even if they develop elsewhere); outside
 * a project, an instance admin or a developer in any project. It is stored in the user's preferences and is on until
 * the user turns it off. Off is the editor view: no Develop group, schema tabs, CDL hints, UIDs or paths.
 */
@Injectable({ providedIn: 'root' })
export class DeveloperModeService {
  private readonly auth = inject(AuthStore);
  private readonly preferences = inject(PreferencesService);
  private readonly frame = inject(FrameContextStore);

  /** Whether the user has developer rights where they are (the switch is only offered then). */
  readonly available = computed(() => this.availableIn(this.frame.projectKey()));

  /** Whether developer details are shown. */
  readonly enabled = computed(() => this.available() && (this.preferences.developerMode() ?? true));

  /**
   * Whether developer details are shown in `projectKey` — for a route guard, which runs before the frame's location
   * (the last finished navigation) follows the URL.
   */
  enabledIn(projectKey: string | null): boolean {
    return this.availableIn(projectKey) && (this.preferences.developerMode() ?? true);
  }

  private availableIn(projectKey: string | null): boolean {
    if (projectKey !== null) {
      return roleRank(this.auth.memberRoleFor(projectKey)) >= roleRank('DEVELOPER');
    }
    return (
      this.auth.isInstanceAdmin() || Object.values(this.auth.projectRoles()).some((role) => roleRank(role) >= roleRank('DEVELOPER'))
    );
  }

  set(value: boolean): void {
    this.preferences.setDeveloperMode(value);
  }
}
