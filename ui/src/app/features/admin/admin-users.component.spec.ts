import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AdminUsersComponent, USER_PAGE_SIZE } from './admin-users.component';

type AdminUserPage = components['schemas']['AdminUserPage'];

const page: AdminUserPage = {
  content: [
    {
      id: 5,
      username: 'ed',
      displayName: 'Ed Itor',
      email: 'ed@example.com',
      status: 'LOCKED',
      systemRole: 'INSTANCE_ADMIN',
      mustChangePassword: true,
      lastLoginAt: '2026-09-20T08:00:00Z',
      projectCount: 2,
    },
  ],
  page: { size: USER_PAGE_SIZE, number: 0, totalElements: 30, totalPages: 2 },
};

async function setup() {
  const api = {
    adminListUsers: vi.fn().mockReturnValue(of(page)),
    adminListProjects: vi.fn().mockReturnValue(of([])),
    passwordPolicy: vi.fn().mockReturnValue(of({ minLength: 12, requireMixed: false, maxBytes: 72 })),
  };
  const view = await render(AdminUsersComponent, {
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
  });
  return { api, view };
}

function lastQuery(api: { adminListUsers: ReturnType<typeof vi.fn> }) {
  return api.adminListUsers.mock.calls.at(-1)?.[0];
}

describe('AdminUsersComponent', () => {
  it('lists the first page sorted by username, with status, role and pending-password hints', async () => {
    const { api } = await setup();

    expect(lastQuery(api)).toEqual({
      q: undefined,
      status: undefined,
      systemRole: undefined,
      includeDeleted: undefined,
      page: 0,
      size: USER_PAGE_SIZE,
      sort: 'username',
    });
    expect(await screen.findByText('Ed Itor')).toBeTruthy();
    expect(screen.getByText('Locked', { selector: '.chip' })).toBeTruthy();
    expect(screen.getByText('Instance admin')).toBeTruthy();
    expect(screen.getByText('Password change pending')).toBeTruthy();
    expect(screen.getByText(/30 user\(s\) · page 1 of 2/)).toBeTruthy();
  });

  it('searches after typing stops, on the first page', async () => {
    const { api } = await setup();

    fireEvent.input(screen.getByLabelText('Search users'), { target: { value: 'e' } });
    fireEvent.input(screen.getByLabelText('Search users'), { target: { value: 'ed ' } });
    expect(api.adminListUsers).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(api.adminListUsers).toHaveBeenCalledTimes(2));
    expect(lastQuery(api)).toMatchObject({ q: 'ed', page: 0 });
  });

  it('filters by status and role, shows deleted accounts on request, and pages', async () => {
    const { api } = await setup();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'DISABLED' } });
    expect(lastQuery(api)).toMatchObject({ status: 'DISABLED', page: 0 });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'INSTANCE_ADMIN' } });
    expect(lastQuery(api)).toMatchObject({ status: 'DISABLED', systemRole: 'INSTANCE_ADMIN' });
    fireEvent.click(screen.getByLabelText('Show deleted'));
    expect(lastQuery(api)).toMatchObject({ includeDeleted: true });

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(lastQuery(api)).toMatchObject({ page: 1, includeDeleted: true });
  });

  it('opens a user from the list', async () => {
    const { view } = await setup();
    const navigate = vi.spyOn(view.fixture.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);

    fireEvent.click((await screen.findByText('ed@example.com')).closest('tr')!);

    expect(navigate).toHaveBeenCalledWith(['/admin/users', 5]);
  });
});
