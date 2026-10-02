import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
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

async function setup(user: AdminUserDetail = ed, options: { selfId?: number; activeAdmins?: number; load?: unknown } = {}) {
  const api = {
    adminGetUser: vi.fn().mockReturnValue(options.load ?? of(user)),
    adminListUsers: vi.fn().mockReturnValue(of({ content: [], page: { totalElements: options.activeAdmins ?? 3 } })),
    adminListProjects: vi.fn().mockReturnValue(of(projects)),
    adminUpdateUser: vi.fn().mockImplementation((_id: number, body: Partial<AdminUserDetail>) => of({ ...user, ...body })),
    adminUserAction: vi.fn().mockImplementation((_id: number, action: string) => of({ ...user, status: action === 'disable' ? 'DISABLED' : 'ACTIVE' })),
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
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ApiClient, useValue: api }],
    configureTestBed: (tb) =>
      tb.inject(AuthStore).setUser({ id: options.selfId ?? 1, username: 'root', systemRole: 'INSTANCE_ADMIN' }),
  });
  if (!options.load) {
    await screen.findByRole('heading', { level: 1, name: user.status === 'DELETED' ? 'Deleted user' : 'Ed Itor' });
  }
  return { api, view };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const toast = () => TestBed.inject(ToastService).toasts().at(-1);

async function openMenu(name = 'More actions') {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.findAllByRole('menuitem');
}

describe('AdminUserDetailComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the person, their status in words and the account facts', async () => {
    await setup();
    expect(screen.getByText('@ed')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('User', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('Set by the user')).toBeTruthy();
    expect(screen.queryByText('USER')).toBeNull();
  });

  it('saves only a changed profile, with the save status and an enabled Save only while dirty', async () => {
    const { api } = await setup();
    expect(button('Save').disabled).toBe(true);
    fireEvent.input(screen.getByLabelText(/^Display name/), { target: { value: 'Ed Itor-King' } });
    expect(button('Save').disabled).toBe(false);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(button('Save'));
    await waitFor(() =>
      expect(api.adminUpdateUser).toHaveBeenCalledWith(5, { username: 'ed', email: 'ed@example.com', displayName: 'Ed Itor-King' }),
    );
    await waitFor(() => expect(toast()?.message).toBe('The profile was saved.'));
    await waitFor(() => expect(button('Save').disabled).toBe(true));
  });

  it('discards edits and refuses invalid input with inline errors and a count', async () => {
    const { api } = await setup();
    fireEvent.input(screen.getByLabelText(/^Display name/), { target: { value: '' } });
    fireEvent.click(button('Save'));
    expect(await screen.findByText('Enter a display name.')).toBeTruthy();
    expect(api.adminUpdateUser).not.toHaveBeenCalled();
    fireEvent.click(button('Discard'));
    expect((screen.getByLabelText(/^Display name/) as HTMLInputElement).value).toBe('Ed Itor');
  });

  it('disables with an Undo (Enable is its inverse) and says what happened', async () => {
    const { api } = await setup();
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
    fireEvent.click(button('Disable'));
    await waitFor(() => expect(api.adminUserAction).toHaveBeenCalledWith(5, 'disable'));
    await waitFor(() => expect(toast()?.message).toBe('Ed Itor was disabled and can no longer sign in.'));
    expect(toast()?.action).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy();
    toast()!.action!.run();
    await waitFor(() => expect(api.adminUserAction).toHaveBeenLastCalledWith(5, 'enable'));
  });

  it('keeps Disable secondary and puts Delete user — the menu’s only danger item — in the ⋮ menu', async () => {
    await setup();
    expect(button('Disable').className).toContain('secondary');
    expect(screen.queryByRole('button', { name: 'Delete user' })).toBeNull();
    const items = await openMenu();
    expect(items.map((i) => i.textContent?.replace(/^\w+(?=[A-Z])/, '').trim())).toEqual([
      expect.stringContaining('Reset password'),
      expect.stringContaining('Sign out everywhere'),
      expect.stringContaining('Make instance admin'),
      expect.stringContaining('Delete user'),
    ]);
    expect(items.filter((i) => i.className.includes('danger'))).toHaveLength(1);
  });

  it('shows the guard rails as disabled menu entries and a disabled Disable button, with the reason', async () => {
    await setup({ ...ed, systemRole: 'INSTANCE_ADMIN' }, { activeAdmins: 1 });
    expect(button('Disable').disabled).toBe(true);
    const items = await openMenu();
    const del = items.find((i) => i.textContent?.includes('Delete user'))!;
    const demote = items.find((i) => i.textContent?.includes('Remove instance admin'))!;
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(demote.getAttribute('aria-disabled')).toBe('true');
  });

  it("doesn't let you delete yourself", async () => {
    await setup(ed, { selfId: 5 });
    const items = await openMenu();
    expect(items.find((i) => i.textContent?.includes('Delete user'))!.getAttribute('aria-disabled')).toBe('true');
    expect(button('Disable').disabled).toBe(true);
  });

  it('deletes only after the username is typed exactly, then goes back to the list', async () => {
    const { api, view } = await setup();
    const navigate = vi.spyOn(view.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    const items = await openMenu();
    fireEvent.click(items.find((i) => i.textContent?.includes('Delete user'))!);
    const dialog = within(await screen.findByRole('dialog'));
    const confirm = dialog.getByRole('button', { name: 'Delete user' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.input(dialog.getByRole('textbox'), { target: { value: 'Ed' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.input(dialog.getByRole('textbox'), { target: { value: 'ed' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.adminDeleteUser).toHaveBeenCalledWith(5, 'ed'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/admin/users']));
    expect(toast()?.message).toBe('Ed Itor was deleted.');
    expect(toast()?.action).toBeFalsy();
  });

  it('signs out everywhere only after a confirmation', async () => {
    const { api } = await setup();
    const items = await openMenu();
    fireEvent.click(items.find((i) => i.textContent?.includes('Sign out everywhere'))!);
    const dialog = within(await screen.findByRole('dialog'));
    expect(api.adminRevokeSessions).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(api.adminRevokeSessions).toHaveBeenCalledWith(5));
  });

  it('resets the password to a generated one and shows it once', async () => {
    const { api } = await setup();
    const items = await openMenu();
    fireEvent.click(items.find((i) => i.textContent?.includes('Reset password'))!);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(api.adminResetPassword).toHaveBeenCalledWith(5, { generatePassword: true, mustChangePassword: true }));
    expect(await dialog.findByText('Gen-3rated-pw!')).toBeTruthy();
    expect(dialog.getByText('This is the only time it is shown. Copy it now.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Gen-3rated-pw!')).toBeNull());
  });

  it('shows project roles as human labels, adds, changes and removes memberships (with Undo), archived ones read-only', async () => {
    const { api } = await setup();
    expect(screen.getByText('ACME')).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();
    expect(screen.queryByText('EDITOR')).toBeNull();

    // Removing is undone by adding the same role back.
    fireEvent.click(button('Remove from ACME'));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith('acme', 5));
    await waitFor(() => expect(toast()?.message).toBe('Removed from ACME.'));
    toast()!.action!.run();
    expect(api.setMemberRole).toHaveBeenCalledWith('acme', 5, 'EDITOR');

    // An archived project can't be written: its row is read-only.
    expect(button('Remove from Old').disabled).toBe(true);
  });

  it('opens a deleted account read-only, without actions', async () => {
    await setup({ ...ed, status: 'DELETED', username: 'deleted-user-5', displayName: 'Deleted user' });
    expect(screen.getByText(/This user was deleted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    expect((screen.getByLabelText(/^Username/) as HTMLInputElement).readOnly).toBe(true);
  });

  it('shows a skeleton while it loads and an error with Retry when it fails', async () => {
    const pending = new Subject<AdminUserDetail>();
    const { api, view } = await setup(ed, { load: pending });
    expect(view.container.querySelector('sf-skeleton')).toBeTruthy();
    pending.error(new Error('down'));
    expect(await screen.findByText('The user could not be loaded.')).toBeTruthy();
    api.adminGetUser.mockReturnValue(of(ed));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ed Itor' })).toBeTruthy();
  });
});
