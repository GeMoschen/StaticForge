import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfTableIdentityComponent } from '../../shared/components/data-table/sf-table-identity.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfSearchInputComponent } from '../../shared/components/forms/sf-search-input.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfMenuComponent } from '../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { AdminUserDialogComponent } from './admin-user-dialog.component';
import {
  NO_USER_FILTER,
  SYSTEM_ROLES,
  USER_STATUSES,
  UserFilter,
  choiceMenu,
  isUserFiltered,
  userStatusIcon,
  userStatusTone,
  userFilterFromQuery,
  userFilterToQuery,
} from './admin-user.util';

type AdminUserRow = components['schemas']['AdminUserRow'];
type AdminUserDetail = components['schemas']['AdminUserDetail'];

export const USER_SEARCH_DEBOUNCE_MS = 300;
export const USER_PAGE_SIZE = 50;

/**
 * Administration → Users (M26, M35.16): every account in an `sf-data-table` — the person (avatar, name, @username), email,
 * role, status, last sign-in and project count — paged and filtered on the server. Search, Status, Role and *Show
 * deleted* live in the URL (`q`, `status`, `role`, `deleted`). A row opens the user; its ⋮ menu offers *Edit user* and
 * *Sign out everywhere*; *New user* opens the create dialog.
 */
@Component({
  selector: 'sf-admin-users',
  standalone: true,
  imports: [
    AdminUserDialogComponent,
    SfBadgeComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfMenuComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSearchInputComponent,
    SfStatusComponent,
    SfSwitchComponent,
    SfTableIdentityComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);

  protected readonly tone = userStatusTone;
  protected readonly icon = userStatusIcon;

  protected readonly filter = signal<UserFilter>(userFilterFromQuery((name) => this.route.snapshot.queryParamMap.get(name)));
  protected readonly rows = signal<readonly AdminUserRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly creating = signal(false);

  private page = 0;
  private requested = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly filtered = computed(() => isUserFiltered(this.filter()));

  protected readonly menus = computed(() => {
    const f = this.filter();
    const picked = (name: string) => (value: string) => this.t('admin.users.filters.picked', { filter: name, value });
    const status = this.t('admin.users.filters.status');
    const role = this.t('admin.users.filters.role');
    const any = this.t('admin.users.filters.any');
    return [
      {
        id: 'status',
        ...choiceMenu(status, any, picked(status), USER_STATUSES, (s) => this.t(`enum.userStatus.${s}`), f.status, (value) =>
          this.filter.update((x) => ({ ...x, status: value })),
        ),
      },
      {
        id: 'role',
        ...choiceMenu(role, any, picked(role), SYSTEM_ROLES, (r) => this.t(`enum.systemRole.${r}`), f.role, (value) =>
          this.filter.update((x) => ({ ...x, role: value })),
        ),
      },
    ];
  });

  protected readonly columns = computed<SfDataTableColumn<AdminUserRow>[]>(() => {
    const header = (id: string) => this.t(`admin.users.columns.${id}`);
    return [
      { id: 'user', header: header('user'), value: (u) => this.nameOf(u), hideable: false, width: 340 },
      { id: 'email', header: header('email'), value: (u) => u.email ?? '', width: 240 },
      { id: 'role', header: header('role'), value: (u) => this.t(`enum.systemRole.${u.systemRole}`), width: 140 },
      { id: 'status', header: header('status'), value: (u) => this.t(`enum.userStatus.${u.status}`), width: 130 },
      { id: 'lastSignIn', header: header('lastSignIn'), value: (u) => u.lastLoginAt ?? '', width: 140 },
      { id: 'projects', header: header('projects'), value: (u) => u.projectCount ?? 0, align: 'end', width: 100 },
      { id: 'actions', header: header('actions'), width: 72, hideable: false },
    ];
  });

  protected readonly rowKey = (user: AdminUserRow) => String(user.id);
  protected readonly rowLabel = (user: AdminUserRow) => this.nameOf(user);

  constructor() {
    effect(
      () => {
        this.filter();
        untracked(() => this.reload());
      },
      { allowSignalWrites: true },
    );
    // The filter lives in the URL (replacing the history entry).
    effect(() => {
      const query = userFilterToQuery(this.filter());
      untracked(() =>
        void this.router.navigate([], { relativeTo: this.route, queryParams: query, queryParamsHandling: 'merge', replaceUrl: true }),
      );
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) {
        clearTimeout(this.searchTimer);
      }
    });
  }

  protected setSearch(q: string): void {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => this.filter.update((f) => ({ ...f, q: q.trim() })), USER_SEARCH_DEBOUNCE_MS);
  }

  protected setDeleted(deleted: boolean): void {
    this.filter.update((f) => ({ ...f, deleted }));
  }

  protected clear(): void {
    this.filter.set(NO_USER_FILTER);
  }

  protected loadMore(): void {
    if (this.rows().length < this.total() && !this.loading()) {
      this.fetch(this.page + 1);
    }
  }

  protected nameOf(user: AdminUserRow): string {
    return user.displayName || user.username || `#${user.id}`;
  }

  protected menuItems(): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('admin.users.menu.edit'), icon: 'edit' },
      { id: 'signOut', label: this.t('admin.users.menu.signOut'), icon: 'logout' },
    ];
  }

  protected async onMenu(user: AdminUserRow, item: SfMenuItem): Promise<void> {
    if (item.id === 'edit') {
      this.open(user);
    } else if (item.id === 'signOut' && user.id != null) {
      const name = this.nameOf(user);
      const confirmed = await this.confirms.confirm({
        title: this.t('admin.users.signOutTitle', { name }),
        message: this.t('admin.users.signOutMessage'),
        confirmLabel: this.t('admin.users.menu.signOut'),
      });
      if (confirmed) {
        this.api.adminRevokeSessions(user.id).subscribe({
          next: () => this.toasts.show(this.t('admin.users.signedOut', { name }), 'success'),
        });
      }
    }
  }

  protected open(row: AdminUserRow): void {
    if (row.id != null) {
      void this.router.navigate(['/admin/users', row.id]);
    }
  }

  /** The dialog already showed a generated password, if any: open the new account. */
  protected created(user: AdminUserDetail): void {
    this.creating.set(false);
    if (user.id != null) {
      void this.router.navigate(['/admin/users', user.id]);
    } else {
      this.reload();
    }
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  protected reload(): void {
    this.rows.set([]);
    this.total.set(0);
    this.fetch(0);
  }

  private fetch(page: number): void {
    const ticket = ++this.requested;
    const f = this.filter();
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .adminListUsers({
        q: f.q || undefined,
        status: f.status ?? undefined,
        systemRole: f.role ?? undefined,
        includeDeleted: f.deleted || undefined,
        page,
        size: USER_PAGE_SIZE,
        sort: 'username',
      })
      .subscribe({
        next: (result) => {
          if (ticket !== this.requested) {
            return;
          }
          this.page = page;
          this.rows.update((rows) => (page === 0 ? (result.content ?? []) : [...rows, ...(result.content ?? [])]));
          this.total.set(result.page?.totalElements ?? 0);
          this.loading.set(false);
        },
        error: () => {
          if (ticket === this.requested) {
            this.loading.set(false);
            this.failed.set(true);
          }
        },
      });
  }
}
