import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectSettingsMembersComponent } from './project-settings-members.component';

type ProjectMemberView = components['schemas']['ProjectMemberView'];
type UserLookupHit = components['schemas']['UserLookupHit'];
type MeResponse = components['schemas']['MeResponse'];

const owner: ProjectMemberView = {
  userId: 1,
  username: 'olga',
  displayName: 'Olga Owner',
  email: 'olga@example.com',
  status: 'ACTIVE',
  role: 'PROJECT_ADMIN',
  grantedAt: '2026-09-01T10:00:00Z',
  grantedBy: 1,
};
const editor: ProjectMemberView = {
  userId: 2,
  username: 'ed',
  displayName: 'Ed Itor',
  email: 'ed@example.com',
  status: 'DISABLED',
  role: 'EDITOR',
  grantedAt: '2026-09-02T10:00:00Z',
  grantedBy: 1,
};
/** What a viewer gets: the server leaves the emails out. */
const withoutEmails = [owner, editor].map(({ email: _email, ...rest }) => rest);

const hits: UserLookupHit[] = [
  { id: 3, username: 'nina', displayName: 'Nina New', member: false },
  { id: 2, username: 'ed', displayName: 'Ed Itor', member: true },
];

function me(id: number, role: string, systemRole = 'USER'): MeResponse {
  return { id, username: `u${id}`, systemRole, mustChangePassword: false, projectRoles: { acme: role } };
}

async function setup(user: MeResponse, members: ProjectMemberView[] = [owner, editor]) {
  const api = {
    listMembers: vi.fn().mockReturnValue(of(members)),
    lookupUsers: vi.fn().mockReturnValue(of(hits)),
    setMemberRole: vi.fn().mockReturnValue(of(owner)),
    removeMember: vi.fn().mockReturnValue(of(undefined)),
    refresh: vi.fn().mockReturnValue(of({ accessToken: 'a.b.c' })),
  };
  const view = await render(ProjectSettingsMembersComponent, {
    componentInputs: { projectKey: 'acme' },
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
    configureTestBed: (tb) => tb.inject(AuthStore).setUser(user),
  });
  // The list loads from an effect, one change-detection pass after the first render.
  await screen.findByText(members[0].displayName ?? '', { selector: '.members__name' });
  return { api, view };
}

function row(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.members__name' }).closest('tr') as HTMLElement;
}

describe('ProjectSettingsMembersComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is read-only below project admin, without emails when the server sends none', async () => {
    await setup(me(2, 'EDITOR'), withoutEmails);

    expect(screen.queryByRole('columnheader', { name: 'Email' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Add member' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Role of/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(within(row('Ed Itor')).getByText('Editor')).toBeTruthy();
  });

  it('lets a project admin manage members, and shows emails and the disabled state', async () => {
    await setup(me(1, 'PROJECT_ADMIN'));

    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeTruthy();
    expect(screen.getByText('ed@example.com')).toBeTruthy();
    expect(row('Ed Itor').className).toContain('inactive');
    expect(within(row('Ed Itor')).getByText('Disabled')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Role of Ed Itor' })).toBeTruthy();
    expect(within(row('Ed Itor')).getByText('Olga Owner')).toBeTruthy();
  });

  it('treats an instance admin as a project admin', async () => {
    await setup({ ...me(9, 'VIEWER', 'INSTANCE_ADMIN'), projectRoles: {} });

    expect(screen.getByRole('group', { name: 'Add member' })).toBeTruthy();
  });

  it('looks accounts up after typing stops, and only non-members can be added', async () => {
    const { api } = await setup(me(1, 'PROJECT_ADMIN'));

    fireEvent.input(screen.getByPlaceholderText(/Search by name/), { target: { value: 'n' } });
    fireEvent.input(screen.getByPlaceholderText(/Search by name/), { target: { value: 'ni' } });
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy());
    expect(api.lookupUsers).toHaveBeenCalledTimes(1);
    expect(api.lookupUsers).toHaveBeenCalledWith('acme', 'ni');

    const existing = screen.getByRole('option', { name: /Ed Itor/ });
    expect(existing.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(existing);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('option', { name: /Nina New/ }));
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'DEVELOPER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(api.setMemberRole).toHaveBeenCalledWith('acme', 3, 'DEVELOPER');
    expect(api.listMembers).toHaveBeenCalledTimes(2);
  });

  it('changes a role and removes a member after confirming', async () => {
    const { api } = await setup(me(1, 'PROJECT_ADMIN'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.change(screen.getByRole('combobox', { name: 'Role of Ed Itor' }), { target: { value: 'VIEWER' } });
    expect(api.setMemberRole).toHaveBeenCalledWith('acme', 2, 'VIEWER');
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ed Itor' }));
    expect(confirm).toHaveBeenCalledWith('Remove Ed Itor from this project?');
    expect(api.removeMember).toHaveBeenCalledWith('acme', 2);
  });

  it('warns before you remove yourself and leaves the project afterwards', async () => {
    const { api, view } = await setup(me(1, 'PROJECT_ADMIN'));
    const router = view.fixture.debugElement.injector.get(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Olga Owner' }));
    expect(confirm.mock.calls[0][0]).toContain('You lose access');
    expect(api.removeMember).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Olga Owner' }));
    expect(api.removeMember).toHaveBeenCalledWith('acme', 1);
    expect(navigate).toHaveBeenCalledWith(['/']);
  });
});
