import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { problemOf } from '../../core/api/problem.util';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import type { EditorError, EditorStateService } from '../../core/editor/editor-state';
import { saveStateOf } from '../../core/editor/editor-state';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ToastService } from '../../core/ui/toast.service';
import { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfTableIdentityComponent } from '../../shared/components/data-table/sf-table-identity.component';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import type { SaveResult } from '../../shared/components/dialog/unsaved-changes.service';
import { SfBadgeComponent } from '../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../shared/components/display/sf-status.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfSelectComponent, SfSelectOption } from '../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSkeletonComponent } from '../../shared/components/layout/sf-skeleton.component';
import { SfMenuItem } from '../../shared/components/menu/sf-menu-item';
import { SfTooltipDirective } from '../../shared/directives/sf-tooltip.directive';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { AdminUserDialogComponent } from './admin-user-dialog.component';
import { userActionStates, userStatusIcon, userStatusTone } from './admin-user.util';

type AdminUserDetail = components['schemas']['AdminUserDetail'];
type AdminMembership = components['schemas']['AdminMembership'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];
type ProfileField = 'username' | 'email' | 'displayName';
type StatusAction = 'disable' | 'enable' | 'unlock';

/** The project roles the select offers (lowest first); the words come from `enum.projectRole`. */
const PROJECT_ROLE_VALUES = ['VIEWER', 'EDITOR', 'DEVELOPER', 'PROJECT_ADMIN'] as const;
const USERNAME = /^[a-z0-9._-]{3,}$/;
const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * Administration → one user (M26, M35.16). The header names the person with their status; **Disable** (Enable / Unlock)
 * is a secondary button, and the ⋮ menu holds Reset password…, Sign out everywhere, Make / Remove instance admin and
 * **Delete user** — the menu's only danger item, which asks for the username to be typed. The server's guard rails
 * (not yourself, not the last active admin) show as disabled entries with their reason. Sections: Profile (explicit save
 * with the save status; the screen is an editor for the frame, so leaving with unsaved changes asks), Account facts and
 * the project memberships. A deleted (anonymized) account opens read-only.
 */
@Component({
  selector: 'sf-admin-user-detail',
  standalone: true,
  imports: [
    AdminUserDialogComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfFieldComponent,
    SfInputComponent,
    SfPageHeaderComponent,
    SfRelativeTimeComponent,
    SfSaveStatusComponent,
    SfSectionComponent,
    SfSelectComponent,
    SfSkeletonComponent,
    SfStatusComponent,
    SfTableIdentityComponent,
    SfTooltipDirective,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-user-detail.component.html',
  styleUrl: './admin-user-detail.component.scss',
})
export class AdminUserDetailComponent {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly confirms = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  /** The `:id` route parameter. */
  readonly id = input.required<string>();

  protected readonly tone = userStatusTone;
  protected readonly icon = userStatusIcon;

  protected readonly user = signal<AdminUserDetail | null>(null);
  protected readonly loadFailed = signal(false);
  /** Unknown until loaded: the guard rails aren't shown before (the server enforces them anyway). */
  private readonly activeAdminCount = signal(Number.POSITIVE_INFINITY);
  protected readonly busy = signal(false);
  protected readonly resetting = signal(false);

  protected readonly deleted = computed(() => this.user()?.status === 'DELETED');
  protected readonly name = computed(() => this.nameOf(this.user()));
  protected readonly isAdmin = computed(() => this.user()?.systemRole === 'INSTANCE_ADMIN');
  protected readonly actions = computed(() => {
    const user = this.user();
    return user ? userActionStates(user, this.auth.userId(), this.activeAdminCount()) : null;
  });

  /** Disable for an active user, Enable for a disabled one, Unlock for a locked one. */
  protected readonly statusAction = computed<StatusAction | null>(() => {
    const a = this.actions();
    return a?.enable.shown ? 'enable' : a?.unlock.shown ? 'unlock' : a?.disable.shown ? 'disable' : null;
  });
  protected readonly statusActionAllowed = computed(() => {
    const a = this.actions();
    const action = this.statusAction();
    return !!a && action !== null && a[action].allowed && !this.busy();
  });
  protected readonly statusActionReason = computed(() => {
    const reason = this.actions()?.disable.reason;
    return this.statusAction() === 'disable' && reason ? this.t(`admin.userdetail.guard.${reason}`) : null;
  });

  protected readonly menuItems = computed<SfMenuItem[]>(() => {
    const a = this.actions();
    if (!a || this.deleted()) {
      return [];
    }
    const refused = (state: { allowed: boolean; reason?: string }): Partial<SfMenuItem> =>
      state.allowed ? {} : { disabled: true, disabledReason: this.t(`admin.userdetail.guard.${state.reason}`) };
    return [
      { id: 'reset', label: this.t('admin.userdetail.menu.reset'), icon: 'key' },
      { id: 'signOut', label: this.t('admin.userdetail.menu.signOut'), icon: 'logout' },
      this.isAdmin()
        ? { id: 'removeAdmin', label: this.t('admin.userdetail.menu.removeAdmin'), icon: 'shield', ...refused(a.toggleAdmin) }
        : { id: 'makeAdmin', label: this.t('admin.userdetail.menu.makeAdmin'), icon: 'shield_person', ...refused(a.toggleAdmin) },
      { id: 'delete', label: this.t('admin.userdetail.menu.delete'), icon: 'delete', danger: true, separatorBefore: true, ...refused(a.delete) },
    ];
  });

  // ── profile (explicit save) ──
  protected readonly username = signal('');
  protected readonly email = signal('');
  protected readonly displayName = signal('');
  protected readonly attempted = signal(false);
  protected readonly saving = signal(false);
  protected readonly lastSaved = signal<string | null>(null);
  private readonly serverErrors = signal<Partial<Record<ProfileField, string>>>({});
  protected readonly dirty = computed(() => {
    const u = this.user();
    return (
      !!u &&
      (this.username().trim() !== (u.username ?? '') || this.email().trim() !== (u.email ?? '') || this.displayName().trim() !== (u.displayName ?? ''))
    );
  });
  protected readonly errors = computed<Record<ProfileField, string | null>>(() => {
    const server = this.serverErrors();
    const check = this.attempted();
    return {
      displayName: server.displayName ?? (check && this.displayName().trim() === '' ? this.t('admin.userdialog.displayNameRequired') : null),
      username:
        server.username ??
        (check && this.username().trim() !== (this.user()?.username ?? '') && !USERNAME.test(this.username().trim())
          ? this.t('admin.userdialog.usernameFormat')
          : null),
      email:
        server.email ??
        (check && this.email().trim() !== (this.user()?.email ?? '') && !EMAIL.test(this.email().trim())
          ? this.t('admin.userdialog.emailInvalid')
          : null),
    };
  });
  protected readonly errorCount = computed(() => Object.values(this.errors()).filter(Boolean).length);
  private readonly refusal = signal<string | null>(null);
  protected readonly saveState = computed(() =>
    saveStateOf({
      dirty: this.dirty,
      saving: this.saving,
      error: computed<EditorError | null>(() => (this.errorCount() > 0 || this.refusal() ? { message: this.refusal() ?? '', count: this.errorCount() } : null)),
    }),
  );

  // ── memberships ──
  protected readonly projects = signal<AdminProjectRow[]>([]);
  protected readonly newProject = signal<string | null>(null);
  protected readonly newRole = signal<string>('EDITOR');
  protected readonly roleOptions = computed<SfSelectOption<string>[]>(() =>
    PROJECT_ROLE_VALUES.map((value) => ({ value, label: this.t(`enum.projectRole.${value}`) })),
  );
  /** Projects the user could still join: not archived (the server refuses writes there) and not a membership yet. */
  protected readonly addable = computed<SfSelectOption<string>[]>(() => {
    const member = new Set((this.user()?.memberships ?? []).map((m) => m.projectKey));
    return this.projects()
      .filter((p) => !p.archived && !member.has(p.key))
      .map((p) => ({ value: p.key ?? '', label: p.name ?? p.key ?? '' }));
  });
  protected readonly columns = computed<SfDataTableColumn<AdminMembership>[]>(() => [
    { id: 'project', header: this.t('admin.userdetail.memberships.project'), value: (m) => this.projectName(m), hideable: false, width: 280 },
    { id: 'role', header: this.t('admin.userdetail.memberships.role'), value: (m) => m.role ?? '', width: 220 },
    { id: 'remove', header: this.t('admin.userdetail.memberships.remove'), width: 120 },
  ]);
  protected readonly rowKey = (m: AdminMembership) => m.projectKey ?? '';
  protected readonly rowLabel = (m: AdminMembership) => this.projectName(m);

  constructor() {
    // The open user is an editor for the frame (M35.13): Ctrl+S saves the profile and leaving with edits asks first.
    const editor: EditorStateService = {
      name: this.name,
      dirty: this.dirty,
      saving: this.saving,
      lastSaved: this.lastSaved,
      error: computed(() => (this.errorCount() > 0 || this.refusal() ? { message: this.refusal() ?? '', count: this.errorCount() } : null)),
      autosave: false,
      save: () => this.saveProfile(),
      discard: async () => this.discardProfile(),
    };
    const unregister = inject(ActiveEditorService).register(editor);
    inject(DestroyRef).onDestroy(unregister);
    // The breadcrumb ends with the open user.
    useFrameItem(() => {
      const user = this.user();
      return user ? { label: this.nameOf(user) } : null;
    });
    effect(() => {
      const id = Number(this.id());
      untracked(() => this.load(id));
    });
    this.api.adminListProjects({ includeArchived: false }).subscribe({
      next: (projects) => this.projects.set(projects),
      error: () => undefined,
    });
  }

  // ── profile ──

  protected save(): void {
    void this.saveProfile();
  }

  protected async saveProfile(): Promise<SaveResult> {
    const user = this.user();
    this.attempted.set(true);
    if (!user?.id || !this.dirty()) {
      return { ok: true };
    }
    if (this.errorCount() > 0) {
      return { ok: false, message: this.t('admin.userdetail.notSaved') };
    }
    if (this.saving()) {
      return { ok: false, message: this.t('admin.userdetail.notSaved') };
    }
    this.saving.set(true);
    this.serverErrors.set({});
    this.refusal.set(null);
    return new Promise<SaveResult>((resolve) => {
      this.api
        .adminUpdateUser(user.id!, { username: this.username().trim(), email: this.email().trim(), displayName: this.displayName().trim() })
        .subscribe({
          next: (updated) => {
            this.saving.set(false);
            this.show(updated);
            this.lastSaved.set(new Date().toTimeString().slice(0, 5));
            this.toasts.show(this.t('admin.userdetail.saved'), 'success');
            resolve({ ok: true });
          },
          error: (err: unknown) => {
            this.saving.set(false);
            const problem = problemOf(err, this.t('admin.userdetail.notSaved'));
            if (problem.field && ['username', 'email', 'displayName'].includes(problem.field)) {
              this.serverErrors.set({ [problem.field as ProfileField]: problem.detail });
            } else {
              this.refusal.set(problem.detail);
            }
            resolve({ ok: false, message: problem.detail });
          },
        });
    });
  }

  protected discardProfile(): void {
    const user = this.user();
    if (user) {
      this.show(user);
    }
  }

  // ── header ──

  protected async changeStatus(): Promise<void> {
    const action = this.statusAction();
    if (action) {
      await this.setStatus(action, true);
    }
  }

  /** Disable and Enable are each other's Undo; Unlock has none. */
  private async setStatus(action: StatusAction, withUndo: boolean): Promise<void> {
    const user = this.user();
    if (!user?.id || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.adminUserAction(user.id, action).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.show(updated);
        this.loadAdminCount();
        const message = this.t(`admin.userdetail.status.${action}Done`, { name: this.nameOf(updated) });
        if (withUndo && action !== 'unlock') {
          this.toasts.undo(message, () => void this.setStatus(action === 'disable' ? 'enable' : 'disable', false));
        } else {
          this.toasts.show(message, 'success');
        }
      },
      error: () => this.busy.set(false),
    });
  }

  protected async onMenu(item: SfMenuItem): Promise<void> {
    const user = this.user();
    if (!user?.id || this.busy()) {
      return;
    }
    const name = this.nameOf(user);
    switch (item.id) {
      case 'reset':
        this.resetting.set(true);
        break;
      case 'signOut':
        if (
          await this.confirms.confirm({
            title: this.t('admin.userdetail.signOutTitle', { name }),
            message: this.t('admin.userdetail.signOutMessage'),
            confirmLabel: this.t('admin.userdetail.menu.signOut'),
          })
        ) {
          this.api.adminRevokeSessions(user.id).subscribe({
            next: () => this.toasts.show(this.t('admin.userdetail.signedOut', { name }), 'success'),
          });
        }
        break;
      case 'makeAdmin':
      case 'removeAdmin': {
        const grant = item.id === 'makeAdmin';
        const key = grant ? 'makeAdmin' : 'removeAdmin';
        if (
          await this.confirms.confirm({
            title: this.t(`admin.userdetail.${key}Title`, { name }),
            message: this.t(`admin.userdetail.${key}Message`),
            confirmLabel: this.t(`admin.userdetail.menu.${key}`),
          })
        ) {
          this.busy.set(true);
          this.api.adminSetSystemRole(user.id, grant ? 'INSTANCE_ADMIN' : 'USER').subscribe({
            next: (updated) => {
              this.busy.set(false);
              this.show(updated);
              this.loadAdminCount();
              this.toasts.show(this.t(grant ? 'admin.userdetail.madeAdmin' : 'admin.userdetail.removedAdmin', { name }), 'success');
            },
            error: () => this.busy.set(false),
          });
        }
        break;
      }
      case 'delete':
        await this.deleteUser(user);
        break;
    }
  }

  /** The only danger action: the username has to be typed. There is no restore for a user, so no Undo. */
  private async deleteUser(user: AdminUserDetail): Promise<void> {
    const name = this.nameOf(user);
    const confirmed = await this.confirms.confirm({
      title: this.t('admin.userdetail.deleteTitle', { name }),
      message: this.t('admin.userdetail.deleteMessage', { name }),
      confirmLabel: this.t('admin.userdetail.deleteConfirm'),
      tone: 'danger',
      typeToConfirm: user.username ?? '',
    });
    if (!confirmed || user.id == null) {
      return;
    }
    this.busy.set(true);
    this.api.adminDeleteUser(user.id, user.username ?? '').subscribe({
      next: () => {
        this.busy.set(false);
        this.toasts.show(this.t('admin.userdetail.deleted', { name }), 'success');
        void this.router.navigate(['/admin/users']);
      },
      error: () => this.busy.set(false),
    });
  }

  /** The password was reset: the user is signed out everywhere, and their state changed. */
  protected passwordReset(updated: AdminUserDetail): void {
    this.show(updated);
  }

  // ── memberships ──

  protected addMembership(): void {
    const user = this.user();
    const key = this.newProject();
    if (!user?.id || !key || this.busy()) {
      return;
    }
    this.busy.set(true);
    const name = this.projects().find((p) => p.key === key)?.name ?? key;
    this.api.setMemberRole(key, user.id, this.newRole()).subscribe({
      next: () => {
        this.newProject.set(null);
        this.toasts.show(this.t('admin.userdetail.memberships.added', { name }), 'success');
        this.reload();
      },
      error: () => this.busy.set(false),
    });
  }

  protected changeMembershipRole(membership: AdminMembership, role: string | null): void {
    const user = this.user();
    if (!user?.id || !membership.projectKey || !role || role === membership.role || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.setMemberRole(membership.projectKey, user.id, role).subscribe({
      next: () => this.reload(),
      error: () => this.reload(),
    });
  }

  /** Removing a membership has an Undo: it adds the same role back. */
  protected removeMembership(membership: AdminMembership): void {
    const user = this.user();
    if (!user?.id || !membership.projectKey || this.busy()) {
      return;
    }
    const key = membership.projectKey;
    const role = membership.role ?? 'EDITOR';
    const userId = user.id;
    const name = this.projectName(membership);
    this.busy.set(true);
    this.api.removeMember(key, userId).subscribe({
      next: () => {
        this.reload();
        this.toasts.undo(this.t('admin.userdetail.memberships.removed', { name }), () =>
          this.api.setMemberRole(key, userId, role).subscribe({ next: () => this.reload() }),
        );
      },
      error: () => this.busy.set(false),
    });
  }

  protected projectName(membership: AdminMembership): string {
    return membership.projectName || membership.projectKey || '';
  }

  protected retry(): void {
    this.load(Number(this.id()));
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  private nameOf(user: AdminUserDetail | null): string {
    return user ? user.displayName || user.username || `#${user.id}` : '';
  }

  private reload(): void {
    const id = this.user()?.id;
    if (id != null) {
      this.load(id);
    }
  }

  private load(id: number): void {
    this.loadFailed.set(false);
    this.api.adminGetUser(id).subscribe({
      next: (user) => {
        this.busy.set(false);
        this.show(user);
      },
      error: () => {
        this.busy.set(false);
        this.loadFailed.set(true);
      },
    });
    this.loadAdminCount();
  }

  private loadAdminCount(): void {
    this.api.adminListUsers({ systemRole: 'INSTANCE_ADMIN', status: 'ACTIVE', size: 1 }).subscribe({
      next: (page) => this.activeAdminCount.set(page.page?.totalElements ?? 0),
      error: () => undefined,
    });
  }

  /** Shows `user` and resets the profile form to it. */
  private show(user: AdminUserDetail): void {
    this.user.set(user);
    this.username.set(user.username ?? '');
    this.email.set(user.email ?? '');
    this.displayName.set(user.displayName ?? '');
    this.attempted.set(false);
    this.serverErrors.set({});
    this.refusal.set(null);
  }
}
