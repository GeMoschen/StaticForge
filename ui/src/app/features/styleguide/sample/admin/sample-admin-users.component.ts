import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { SfTableIdentityComponent } from '../../../../shared/components/data-table/sf-table-identity.component';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { SfAvatarComponent } from '../../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { SfMenuComponent } from '../../../../shared/components/menu/sf-menu.component';
import { SfMenuItem } from '../../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { injectSampleQuery, minutesAgo } from '../changes/sample-area.util';
import {
  AdminSystemRole,
  AdminUser,
  AdminUserStatus,
  NO_USER_FILTERS,
  STATUS_ICONS,
  STATUS_TONES,
  SYSTEM_ROLES,
  USER_STATUSES,
  UserFilters,
  filterUsers,
  formatUserFilter,
  parseUserFilter,
} from './admin-data';
import { AdminState } from './admin-state';
import { SampleAdminUserDialogComponent } from './sample-admin-user-dialog.component';

/**
 * Administration › Users (M35.16): `sf-data-table` of the instance's users with a search, Status and Role menus and a
 * *Show deleted* switch — the filters live in the URL (`ufilter=q:ada,status:active,role:admin,deleted:1`). Roles and
 * statuses read as human labels; a row opens the user. *New user* opens the create dialog. Review states through
 * `astate=loading|error|empty`.
 */
@Component({
  selector: 'sf-sample-admin-users',
  standalone: true,
  imports: [
    SfTableIdentityComponent,
    SampleAdminUserDialogComponent,
    SfAvatarComponent,
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-users.component.html',
  styleUrl: './sample-admin-users.component.scss',
})
export class SampleAdminUsersComponent {
  protected readonly admin = inject(AdminState);
  private readonly confirms = inject(ConfirmService);
  protected readonly t = this.admin.t;
  private readonly query = injectSampleQuery();

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  protected readonly filters = signal<UserFilters>(NO_USER_FILTERS);
  protected readonly creating = signal(false);

  protected readonly rows = computed(() => (this.admin.review() !== 'live' ? [] : filterUsers(this.admin.users(), this.filters())));
  protected readonly filtered = computed(() => formatUserFilter(this.filters()) !== null || this.admin.review() === 'empty');
  protected readonly error = computed(() => (this.admin.review() === 'error' ? this.t('users.error') : null));

  protected readonly menus = computed(() => {
    const f = this.filters();
    return [
      this.admin.menu<AdminUserStatus>('status', USER_STATUSES, f.status, (s) => this.t(`status.${s}`), (status) => this.filters.update((x) => ({ ...x, status }))),
      this.admin.menu<AdminSystemRole>('role', SYSTEM_ROLES, f.role, (r) => this.t(`systemRoles.${r}`), (role) => this.filters.update((x) => ({ ...x, role }))),
    ];
  });

  protected readonly columns = computed<SfDataTableColumn<AdminUser>[]>(() => {
    const header = (id: string) => this.t(`users.columns.${id}`);
    return [
      { id: 'user', header: header('user'), value: (u) => u.displayName, sortable: true, hideable: false, width: 340 },
      { id: 'email', header: header('email'), value: (u) => u.email, sortable: true, width: 240 },
      { id: 'role', header: header('role'), value: (u) => this.t(`systemRoles.${u.role}`), sortable: true, width: 130 },
      { id: 'status', header: header('status'), value: (u) => this.t(`status.${u.status}`), sortable: true, width: 130 },
      { id: 'lastSignIn', header: header('lastSignIn'), value: (u) => u.lastSignInMinutes ?? Number.MAX_SAFE_INTEGER, sortable: true, width: 140 },
      { id: 'projects', header: header('projects'), value: (u) => u.memberships.length, sortable: true, align: 'end', width: 100 },
      { id: 'actions', header: header('actions'), width: 72, hideable: false },
    ];
  });

  protected readonly rowKey = (user: AdminUser) => user.id;
  protected readonly rowLabel = (user: AdminUser) => user.displayName;

  constructor() {
    this.filters.set(parseUserFilter(this.query.get('ufilter')));
    effect(() => this.query.set({ ufilter: formatUserFilter(this.filters()) }));
    inject(DestroyRef).onDestroy(() => this.query.set({ ufilter: null }));
  }

  protected setSearch(q: string): void {
    this.filters.update((f) => ({ ...f, q }));
  }

  protected setDeleted(deleted: boolean): void {
    this.filters.update((f) => ({ ...f, deleted }));
  }

  protected clear(): void {
    this.filters.set(NO_USER_FILTERS);
    this.admin.review.set('live');
  }

  protected menuItems(): SfMenuItem[] {
    return [
      { id: 'edit', label: this.t('users.menu.edit'), icon: 'edit' },
      { id: 'signOut', label: this.t('users.menu.signOut'), icon: 'logout' },
    ];
  }

  protected async onMenu(user: AdminUser, item: SfMenuItem): Promise<void> {
    if (item.id === 'edit') {
      this.open(user);
    } else if (item.id === 'signOut') {
      const confirmed = await this.confirms.confirm({
        title: this.t('detail.signOutTitle', { name: user.displayName }),
        message: this.t('detail.signOutMessage'),
        confirmLabel: this.t('users.menu.signOut'),
      });
      if (confirmed) {
        this.admin.notice(this.t('detail.signedOut', { name: user.displayName }));
      }
    }
  }

  protected open(user: AdminUser): void {
    this.admin.sample.adminDetail.set(user.id);
  }

  protected created(user: AdminUser): void {
    this.admin.users.update((all) => [user, ...all]);
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.admin.now);
  }
}
