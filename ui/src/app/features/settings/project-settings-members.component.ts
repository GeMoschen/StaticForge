import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime, of, switchMap, catchError } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { PROJECT_ROLES, projectRoleLabel } from '../../core/auth/roles';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';

type ProjectMemberView = components['schemas']['ProjectMemberView'];
type UserLookupHit = components['schemas']['UserLookupHit'];

/** How long the member lookup waits after the last keystroke. */
export const LOOKUP_DEBOUNCE_MS = 250;

/**
 * Project settings → Members (M26): everyone in the project sees who else is; project admins (and instance admins)
 * add existing accounts, change roles and remove members. Emails are only in the list when the server sends them
 * (project admins). Instance admins reach every project without being members, so they aren't listed.
 */
@Component({
  selector: 'sf-project-settings-members',
  standalone: true,
  imports: [DatePipe, SfButtonComponent, SfSpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-settings-members.component.html',
  styleUrl: './project-settings-members.component.scss',
})
export class ProjectSettingsMembersComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly projectKey = input.required<string>();

  protected readonly roles = PROJECT_ROLES;
  protected readonly roleLabel = projectRoleLabel;

  protected readonly members = signal<ProjectMemberView[]>([]);
  protected readonly loading = signal(true);
  protected readonly busyUserId = signal<number | null>(null);

  /** The effective role: instance admins count as project admins, and nobody manages an archived project. */
  protected readonly canManage = inject(ProjectPermissionsStore).isProjectAdmin;
  /** The server leaves emails out below project admin: show the column only when they came. */
  protected readonly showEmail = computed(() => this.members().some((m) => m.email != null));
  protected readonly selfId = this.auth.userId;

  // ── add member ──
  protected readonly query = signal('');
  protected readonly hits = signal<UserLookupHit[]>([]);
  protected readonly searching = signal(false);
  protected readonly selected = signal<UserLookupHit | null>(null);
  protected readonly newRole = signal('EDITOR');
  protected readonly adding = signal(false);
  private readonly lookups = new Subject<string>();

  constructor() {
    this.lookups
      .pipe(
        debounceTime(LOOKUP_DEBOUNCE_MS),
        switchMap((q) => {
          if (q.trim() === '') {
            return of([] as UserLookupHit[]);
          }
          this.searching.set(true);
          return this.api.lookupUsers(this.projectKey(), q.trim()).pipe(catchError(() => of([] as UserLookupHit[])));
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((hits) => {
        this.searching.set(false);
        this.hits.set(hits);
      });
    effect(() => {
      const key = this.projectKey();
      untracked(() => this.load(key));
    });
  }

  protected nameOf(member: ProjectMemberView): string {
    return member.displayName || member.username || `User #${member.userId}`;
  }

  /** Who granted the membership, when that account is still a member here; the id otherwise. */
  protected grantedByName(member: ProjectMemberView): string {
    if (member.grantedBy == null) {
      return '—';
    }
    const granter = this.members().find((m) => m.userId === member.grantedBy);
    return granter ? this.nameOf(granter) : `User #${member.grantedBy}`;
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.selected.set(null);
    this.lookups.next(value);
  }

  protected pick(hit: UserLookupHit): void {
    if (hit.member) {
      return;
    }
    this.selected.set(hit);
    this.query.set(hit.displayName ? `${hit.displayName} (${hit.username})` : (hit.username ?? ''));
    this.hits.set([]);
  }

  protected add(): void {
    const user = this.selected();
    if (!user?.id || this.adding()) {
      return;
    }
    this.adding.set(true);
    this.api.setMemberRole(this.projectKey(), user.id, this.newRole()).subscribe({
      next: () => {
        this.adding.set(false);
        this.toasts.show(`${user.displayName || user.username} was added.`, 'success');
        this.selected.set(null);
        this.query.set('');
        this.load(this.projectKey());
      },
      error: () => this.adding.set(false),
    });
  }

  protected changeRole(member: ProjectMemberView, role: string): void {
    if (!member.userId || role === member.role) {
      return;
    }
    const self = member.userId === this.selfId();
    if (
      self &&
      role !== 'PROJECT_ADMIN' &&
      !this.auth.isInstanceAdmin() &&
      !window.confirm('You are about to give up project admin. You will no longer be able to manage members. Continue?')
    ) {
      this.load(this.projectKey());
      return;
    }
    this.busyUserId.set(member.userId);
    this.api.setMemberRole(this.projectKey(), member.userId, role).subscribe({
      next: () => {
        this.busyUserId.set(null);
        if (self) {
          this.refreshOwnAccess();
        }
        this.load(this.projectKey());
      },
      error: () => {
        this.busyUserId.set(null);
        this.load(this.projectKey());
      },
    });
  }

  protected remove(member: ProjectMemberView): void {
    if (!member.userId) {
      return;
    }
    const self = member.userId === this.selfId();
    const question = self
      ? 'Remove yourself from this project? You lose access to it at once.'
      : `Remove ${this.nameOf(member)} from this project?`;
    if (!window.confirm(question)) {
      return;
    }
    this.busyUserId.set(member.userId);
    this.api.removeMember(this.projectKey(), member.userId).subscribe({
      next: () => {
        this.busyUserId.set(null);
        if (self && !this.auth.isInstanceAdmin()) {
          // The server already revoked this session's access to the project: leave before anything asks for it.
          this.toasts.show('You left the project.', 'success');
          void this.router.navigate(['/']);
          return;
        }
        this.load(this.projectKey());
      },
      error: () => this.busyUserId.set(null),
    });
  }

  private load(key: string): void {
    this.loading.set(true);
    this.api.listMembers(key).subscribe({
      next: (members) => {
        this.members.set(members);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** The own role is in the access token: fetch one that has the new role. */
  private refreshOwnAccess(): void {
    this.api.refresh().subscribe({
      next: (res) => this.auth.setSession(res),
      error: () => undefined,
    });
  }
}
