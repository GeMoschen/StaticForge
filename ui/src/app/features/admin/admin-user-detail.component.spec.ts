import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { AdminUserDetailComponent } from './admin-user-detail.component';

type AdminUserDetail = components['schemas']['AdminUserDetail'];
type AdminProjectRow = components['schemas']['AdminProjectRow'];

const ed: AdminUserDetail = {
  id: 5,
  username: 'ed',
  displayName: 'Ed Itor',
  email: 'ed@example.com',
  status: 'ACTIVE',
  systemRole: 'USER',
  mustChangePassword: false,
  createdAt: '2026-09-01T10:00:00Z',
  failedLogins: 0,
  projectCount: 2,
  memberships: [
    { projectKey: 'acme', projectName: 'ACME', archived: false, role: 'EDITOR', grantedAt: '2026-09-02T10:00:00Z', grantedBy: 'root' },
    { projectKey: 'old', projectName: 'Old', archived: true, role: 'VIEWER', grantedAt: '2026-09-02T10:00:00Z', grantedBy: 'root' },
  ],
};
const projects: AdminProjectRow[] = [
  { key: 'acme', name: 'ACME', archived: false },
  { key: 'beta', name: 'Beta', archived: false },
];

async function setup(user: AdminUserDetail = ed, options: { selfId?: number; activeAdmins?: number } = {}) {
  const api = {
    adminGetUser: vi.fn().mockReturnValue(of(user)),
    adminListUsers: vi.fn().mockReturnValue(of({ content: [], page: { totalElements: options.activeAdmins ?? 3 } })),
    adminListProjects: vi.fn().mockReturnValue(of(projects)),
    adminUpdateUser: vi.fn().mockReturnValue(of(user)),
    adminUserAction: vi.fn().mockReturnValue(of({ ...user, status: 'DISABLED' })),
    adminDeleteUser: vi.fn().mockReturnValue(of(undefined)),
    adminResetPassword: vi.fn().mockReturnValue(of({ ...user, generatedPassword: 'Gen-3rated-pw!' })),
    adminSetSystemRole: vi.fn().mockReturnValue(of(user)),
    adminRevokeSessions: vi.fn().mockReturnValue(of(undefined)),
    setMemberRole: vi.fn().mockReturnValue(of({})),
    removeMember: vi.fn().mockReturnValue(of(undefined)),
    passwordPolicy: vi.fn().mockReturnValue(of({ minLength: 12, requireMixed: false, maxBytes: 72 })),
  };
  const view = await render(AdminUserDetailComponent, {
    componentInputs: { id: String(user.id) },
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
    configureTestBed: (tb) =>
      tb.inject(AuthStore).setUser({ id: options.selfId ?? 1, username: 'root', systemRole: 'INSTANCE_ADMIN' }),
  });
  await screen.findByRole('heading', { name: user.status === 'DELETED' ? 'Deleted user' : 'Ed Itor' });
  return { api, view };
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('AdminUserDetailComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the account and saves only a changed profile', async () => {
    const { api } = await setup();

    expect(button('Save profile').disabled).toBe(true);
    fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'Ed Itor-King' } });
    fireEvent.click(button('Save profile'));

    expect(api.adminUpdateUser).toHaveBeenCalledWith(5, {
      username: 'ed',
      email: 'ed@example.com',
      displayName: 'Ed Itor-King',
    });
  });

  it('offers the actions an active user allows and disables after confirming', async () => {
    const { api } = await setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
    fireEvent.click(button('Disable'));

    expect(confirm).toHaveBeenCalled();
    expect(api.adminUserAction).toHaveBeenCalledWith(5, 'disable');
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy();
  });

  it('shows the guard rails as disabled actions with their reason', async () => {
    await setup({ ...ed, systemRole: 'INSTANCE_ADMIN' }, { activeAdmins: 1 });

    expect(button('Disable').disabled).toBe(true);
    expect(button('Delete user').disabled).toBe(true);
    expect(button('Revoke instance admin').disabled).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent("The last active instance admin can't be deleted.");
  });

  it("doesn't let you delete yourself", async () => {
    await setup(ed, { selfId: 5 });
    expect(button('Delete user').disabled).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent("You can't delete your own account.");
  });

  it('deletes only after the username is typed exactly', async () => {
    const { api, view } = await setup();
    const navigate = vi.spyOn(view.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);

    fireEvent.click(button('Delete user'));
    const dialog = within(await screen.findByRole('dialog'));
    const confirm = dialog.getByRole('button', { name: 'Delete user' }) as HTMLButtonElement;
    expect(dialog.getByText(/can't be undone/)).toBeTruthy();

    fireEvent.input(dialog.getByLabelText('Type ed to confirm'), { target: { value: 'Ed' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.input(dialog.getByLabelText('Type ed to confirm'), { target: { value: 'ed' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(api.adminDeleteUser).toHaveBeenCalledWith(5, 'ed');
    expect(navigate).toHaveBeenCalledWith(['/admin/users']);
  });

  it('resets the password to a generated one and shows it once', async () => {
    const { api } = await setup();

    fireEvent.click(button('Reset password'));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Reset password' }));

    expect(api.adminResetPassword).toHaveBeenCalledWith(5, { generatePassword: true, mustChangePassword: true });
    expect(await dialog.findByText('Gen-3rated-pw!')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Gen-3rated-pw!')).toBeNull();
  });

  it('adds, changes and removes memberships, and leaves archived ones read-only', async () => {
    const { api } = await setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Only projects the user isn't in yet can be added.
    const projectSelect = screen.getByLabelText('Project to add') as HTMLSelectElement;
    expect(Array.from(projectSelect.options).map((o) => o.value)).toEqual(['', 'beta']);
    fireEvent.change(projectSelect, { target: { value: 'beta' } });
    fireEvent.change(screen.getByLabelText('Role for the new project'), { target: { value: 'VIEWER' } });
    fireEvent.click(button('Add'));
    expect(api.setMemberRole).toHaveBeenCalledWith('beta', 5, 'VIEWER');

    fireEvent.change(screen.getByLabelText('Role in ACME'), { target: { value: 'DEVELOPER' } });
    expect(api.setMemberRole).toHaveBeenCalledWith('acme', 5, 'DEVELOPER');

    fireEvent.click(button('Remove from ACME'));
    expect(api.removeMember).toHaveBeenCalledWith('acme', 5);

    expect(screen.queryByLabelText('Role in Old')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove from Old' })).toBeNull();
  });

  it('opens a deleted account read-only', async () => {
    await setup({ ...ed, status: 'DELETED', username: 'deleted-user-5', displayName: 'Deleted user' });

    expect(screen.getByText(/This account was deleted/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Account actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull();
    expect(screen.queryByLabelText('Project to add')).toBeNull();
    expect((screen.getByLabelText('Username') as HTMLInputElement).disabled).toBe(true);
  });
});
