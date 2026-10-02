import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { SfTableIdentityComponent } from '../../../../shared/components/data-table/sf-table-identity.component';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDataTableColumn } from '../../../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../../../shared/components/data-table/sf-data-table.component';
import { ConfirmService } from '../../../../shared/components/dialog/confirm.service';
import { UnsavedChangesService } from '../../../../shared/components/dialog/unsaved-changes.service';
import { SfBadgeComponent } from '../../../../shared/components/display/sf-badge.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfSelectComponent, SfSelectOption } from '../../../../shared/components/forms/sf-select.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfPageHeaderComponent } from '../../../../shared/components/layout/sf-page-header.component';
import { SfSaveState, SfSaveStatusComponent } from '../../../../shared/components/layout/sf-save-status.component';
import { SfSectionComponent } from '../../../../shared/components/layout/sf-section.component';
import { SfMenuItem } from '../../../../shared/components/menu/sf-menu-item';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { minutesAgo } from '../changes/sample-area.util';
import { AdminMembership, AdminProject, AdminProjectRole, PROJECT_ROLES, STATUS_ICONS, STATUS_TONES } from './admin-data';
import { AdminState } from './admin-state';
import { SampleAdminUserDialogComponent } from './sample-admin-user-dialog.component';

/**
 * Administration › Users › a user (M35.16). One danger action per menu: **Disable** (or Enable / Unlock) is a secondary
 * button next to the title; **Delete user** sits in the header's ⋮ menu — the menu's only danger item — and asks for the
 * username to be typed. The ⋮ menu also resets the password, signs the user out everywhere and (un)makes an instance admin.
 * Sections: Profile (explicit save with the save status; leaving with unsaved changes asks), Account facts, and the
 * project memberships (role as a human label in a select, remove with Undo, *Add to project*). Nothing is saved.
 */
@Component({
  selector: 'sf-sample-admin-user-detail',
  standalone: true,
  imports: [
    SfTableIdentityComponent,
    SampleAdminUserDialogComponent,
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
    SfStatusComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-admin-user-detail.component.html',
  styleUrl: './sample-admin-user-detail.component.scss',
})
export class SampleAdminUserDetailComponent {
  readonly userId = input.required<string>();

  protected readonly admin = inject(AdminState);
  protected readonly t = this.admin.t;
  private readonly confirms = inject(ConfirmService);
  private readonly toasts = inject(ToastService);
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly tones = STATUS_TONES;
  protected readonly icons = STATUS_ICONS;
  protected readonly user = computed(() => this.admin.user(this.userId())!);
  protected readonly deleted = computed(() => this.user().status === 'deleted');

  // ── Profile draft ──────────────────────────────────────────────────────────
  protected readonly username = signal('');
  protected readonly email = signal('');
  protected readonly displayName = signal('');
  protected readonly attempted = signal(false);
  /** The draft was loaded from the user (before that it is not "changed"). */
  private readonly loaded = signal(false);
  protected readonly dirty = computed(() => {
    const u = this.user();
    return this.loaded() && (this.username() !== u.username || this.email() !== u.email || this.displayName() !== u.displayName);
  });
  protected readonly errors = computed(() => ({
    displayName: this.attempted() && this.displayName().trim() === '' ? this.t('detail.displayNameRequired') : null,
    email: this.attempted() && !/^\S+@\S+\.\S+$/.test(this.email().trim()) ? this.t('newUser.emailInvalid') : null,
    username: this.attempted() && this.username().trim().length < 3 ? this.t('newUser.usernameFormat') : null,
  }));
  protected readonly errorCount = computed(() => Object.values(this.errors()).filter(Boolean).length);
  protected readonly saveState = computed<SfSaveState>(() => (this.errorCount() > 0 ? 'error' : this.dirty() ? 'dirty' : 'saved'));

  // ── Header ─────────────────────────────────────────────────────────────────
  protected readonly menuItems = computed<SfMenuItem[]>(() => {
    const u = this.user();
    if (this.deleted()) {
      return [];
    }
    return [
      { id: 'reset', label: this.t('detail.menu.reset'), icon: 'key' },
      { id: 'signout', label: this.t('detail.menu.signOut'), icon: 'logout' },
      u.role === 'admin'
        ? { id: 'removeAdmin', label: this.t('detail.menu.removeAdmin'), icon: 'shield' }
        : { id: 'makeAdmin', label: this.t('detail.menu.makeAdmin'), icon: 'shield_person' },
      { id: 'delete', label: this.t('detail.menu.delete'), icon: 'delete', danger: true, separatorBefore: true },
    ];
  });

  /** The status action: Disable for an active user, Enable for a disabled one, Unlock for a locked one. */
  protected readonly statusAction = computed(() => {
    const status = this.user().status;
    return status === 'disabled' ? 'enable' : status === 'locked' ? 'unlock' : status === 'active' ? 'disable' : null;
  });
  protected readonly resetting = signal(false);

  // ── Memberships ────────────────────────────────────────────────────────────
  protected readonly roleOptions = computed<SfSelectOption<AdminProjectRole>[]>(() => PROJECT_ROLES.map((value) => ({ value, label: this.admin.roleLabel(value) })));
  protected readonly newProject = signal<string | null>(null);
  protected readonly newRole = signal<AdminProjectRole>('editor');
  protected readonly addable = computed<SfSelectOption<string>[]>(() => {
    const has = new Set(this.user().memberships.map((m) => m.project));
    return this.admin.projects().filter((p) => !has.has(p.key) && !this.admin.isArchived(p.key)).map((p) => ({ value: p.key, label: p.name }));
  });
  protected readonly columns = computed<SfDataTableColumn<AdminMembership>[]>(() => [
    { id: 'project', header: this.t('detail.memberships.project'), value: (m) => this.admin.projectName(m.project), sortable: true, hideable: false, width: 280 },
    { id: 'role', header: this.t('detail.memberships.role'), value: (m) => this.admin.roleLabel(m.role), width: 220 },
    { id: 'remove', header: this.t('detail.memberships.remove'), width: 120 },
  ]);
  protected readonly rowKey = (m: AdminMembership) => m.project;
  protected readonly rowLabel = (m: AdminMembership) => this.admin.projectName(m.project);

  constructor() {
    // Load the draft when another user opens (and after a save).
    effect(() => {
      const u = this.user();
      untracked(() => {
        this.username.set(u.username);
        this.email.set(u.email);
        this.displayName.set(u.displayName);
        this.attempted.set(false);
        this.loaded.set(true);
      });
    });
    // Leaving with unsaved changes asks first (the rail, the breadcrumb, another area).
    const unregister = this.admin.sample.registerGuard(async () => {
      if (!this.dirty()) {
        return true;
      }
      return this.unsaved.confirmLeave({
        name: this.user().displayName,
        save: async () => {
          this.save();
          return this.errorCount() > 0 ? { ok: false, message: this.t('detail.notSaved') } : { ok: true };
        },
        discard: () => this.discard(),
      });
    });
    inject(DestroyRef).onDestroy(unregister);
  }

  protected save(): void {
    this.attempted.set(true);
    if (this.errorCount() > 0) {
      return;
    }
    this.admin.patchUser(this.userId(), { username: this.username().trim(), email: this.email().trim(), displayName: this.displayName().trim() });
    this.admin.notice(this.t('detail.saved'));
  }

  protected discard(): void {
    const u = this.user();
    this.username.set(u.username);
    this.email.set(u.email);
    this.displayName.set(u.displayName);
    this.attempted.set(false);
  }

  protected ago(minutes: number): number {
    return minutesAgo(minutes, this.admin.now);
  }

  /** Disable, Enable and Unlock are reversible: a toast with Undo says so instead of a confirmation. */
  protected changeStatus(): void {
    const action = this.statusAction();
    const user = this.user();
    if (action === null) {
      return;
    }
    const previous = user.status;
    this.admin.patchUser(user.id, { status: action === 'disable' ? 'disabled' : 'active' });
    this.toasts.undo(this.t(`detail.status.${action}Done`, { name: user.displayName }), () => this.admin.patchUser(user.id, { status: previous }));
  }

  protected async onMenu(item: SfMenuItem): Promise<void> {
    const user = this.user();
    const name = user.displayName;
    switch (item.id) {
      case 'reset':
        this.resetting.set(true);
        break;
      case 'signout':
        if (await this.confirms.confirm({ title: this.t('detail.signOutTitle', { name }), message: this.t('detail.signOutMessage'), confirmLabel: this.t('detail.menu.signOut') })) {
          this.admin.notice(this.t('detail.signedOut', { name }));
        }
        break;
      case 'makeAdmin':
      case 'removeAdmin': {
        const make = item.id === 'makeAdmin';
        if (
          await this.confirms.confirm({
            title: this.t(make ? 'detail.makeAdminTitle' : 'detail.removeAdminTitle', { name }),
            message: this.t(make ? 'detail.makeAdminMessage' : 'detail.removeAdminMessage'),
            confirmLabel: this.t(make ? 'detail.menu.makeAdmin' : 'detail.menu.removeAdmin'),
          })
        ) {
          this.admin.patchUser(user.id, { role: make ? 'admin' : 'user' });
          this.admin.notice(this.t(make ? 'detail.madeAdmin' : 'detail.removedAdmin', { name }));
        }
        break;
      }
      case 'delete':
        await this.delete();
        break;
    }
  }

  /** The user's one danger action: a typed confirmation of the username, then Undo. */
  private async delete(): Promise<void> {
    const user = this.user();
    const confirmed = await this.confirms.confirm({
      title: this.t('detail.deleteTitle', { name: user.displayName }),
      message: this.t('detail.deleteMessage', { name: user.displayName }),
      confirmLabel: this.t('detail.menu.delete'),
      tone: 'danger',
      typeToConfirm: user.username,
    });
    if (confirmed) {
      const previous = user.status;
      this.admin.patchUser(user.id, { status: 'deleted' });
      this.toasts.undo(this.t('detail.deleted', { name: user.displayName }), () => this.admin.patchUser(user.id, { status: previous }));
    }
  }

  // ── Memberships ────────────────────────────────────────────────────────────

  protected setRole(project: string, role: AdminProjectRole | null): void {
    if (role) {
      this.admin.setMembershipRole(this.userId(), project, role);
    }
  }

  protected removeMembership(m: AdminMembership): void {
    const userId = this.userId();
    const name = this.admin.projectName(m.project);
    this.admin.setMemberships(userId, (all) => all.filter((x) => x.project !== m.project));
    this.toasts.undo(this.t('detail.memberships.removed', { name }), () => this.admin.setMemberships(userId, (all) => [...all, m]));
  }

  protected addMembership(): void {
    const key = this.newProject();
    const project: AdminProject | undefined = key ? this.admin.projectByKey(key) : undefined;
    if (!project) {
      return;
    }
    this.admin.setMemberships(this.userId(), (all) => [...all, { project: project.key, role: this.newRole() }]);
    this.newProject.set(null);
    this.admin.notice(this.t('detail.memberships.added', { name: project.name }));
  }
}
