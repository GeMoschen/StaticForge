import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from '../api/api.client';
import type { components } from '../api/generated/schema.d.ts';

type ProjectMemberView = components['schemas']['ProjectMemberView'];

/**
 * The open project's members, loaded once per project (M27.6): who owns a schedule, who changed an asset, the
 * "changed by" filter of the Changes view. A user who isn't a member (an instance admin) reads as "User #12".
 */
@Injectable({ providedIn: 'root' })
export class ProjectMembersStore {
  private readonly api = inject(ApiClient);
  private loadedFor: string | null = null;

  readonly members = signal<ProjectMemberView[]>([]);

  private readonly names = computed(() => {
    const map = new Map<number, string>();
    for (const member of this.members()) {
      if (member.userId != null) {
        map.set(member.userId, member.displayName || member.username || `User #${member.userId}`);
      }
    }
    return map;
  });

  /** Loads the members of `projectKey`; a repeat call for the same project is a no-op. */
  load(projectKey: string): void {
    if (!projectKey || this.loadedFor === projectKey) {
      return;
    }
    this.loadedFor = projectKey;
    this.members.set([]);
    this.api.listMembers(projectKey).subscribe({
      next: (list) => this.members.set(list ?? []),
      error: () => {
        this.loadedFor = null;
      },
    });
  }

  /** "Ana Lopez", or "User #12" for someone who isn't (or is no longer) a member; empty for no user. */
  nameOf(userId: number | null | undefined): string {
    if (userId == null) {
      return '';
    }
    return this.names().get(userId) ?? `User #${userId}`;
  }
}
