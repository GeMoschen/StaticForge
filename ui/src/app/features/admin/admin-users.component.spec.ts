import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ToastService } from '../../core/ui/toast.service';
import { AdminUsersComponent, USER_PAGE_SIZE, USER_SEARCH_DEBOUNCE_MS } from './admin-users.component';

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
    {
      id: 6,
      username: 'nina',
      displayName: 'Nina Park',
      email: 'nina@example.com',
      status: 'ACTIVE',
      systemRole: 'USER',
      mustChangePassword: false,
      projectCount: 0,
    },
  ],
  page: { size: USER_PAGE_SIZE, number: 0, totalElements: 2, totalPages: 1 },
};

async function setup(_query: Record<string, string> = {}, result: unknown = of(page)) {
  const api = {
    adminListUsers: vi.fn().mockReturnValue(result),
    adminRevokeSessions: vi.fn().mockReturnValue(of(undefined)),
    adminCreateUser: vi.fn(),
    adminListProjects: vi.fn().mockReturnValue(of([])),
    passwordPolicy: vi.fn().mockReturnValue(of({ minLength: 12, requireMixed: false, maxBytes: 72 })),
  };
  const view = await render(AdminUsersComponent, {
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
  });
  return { api, view };
}

/** Renders the list with query parameters on the route snapshot (the filter is read from the URL). */
async function withQuery(query: Record<string, string>) {
  const { ActivatedRoute, convertToParamMap } = await import('@angular/router');
  const api = {
    adminListUsers: vi.fn().mockReturnValue(of(page)),
    adminRevokeSessions: vi.fn().mockReturnValue(of(undefined)),
    adminListProjects: vi.fn().mockReturnValue(of([])),
    passwordPolicy: vi.fn().mockReturnValue(of({ minLength: 12, requireMixed: false, maxBytes: 72 })),
  };
  await render(AdminUsersComponent, {
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  return api;
}

const lastQuery = (api: { adminListUsers: ReturnType<typeof vi.fn> }) => api.adminListUsers.mock.calls.at(-1)?.[0];

afterEach(() => vi.useRealTimers());

describe('AdminUsersComponent', () => {
  it('lists the first page sorted by username, in human words — never enums', async () => {
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
    expect(screen.getByText('@ed')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByText('Instance admin')).toBeTruthy();
    expect(screen.getByText('Password change pending')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.queryByText('INSTANCE_ADMIN')).toBeNull();
    expect(screen.queryByText('LOCKED')).toBeNull();
    expect(screen.getByText('2 users')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeTruthy();
  });

  it('reads the filter from the URL and sends it to the server', async () => {
    const api = await withQuery({ q: 'ed', status: 'LOCKED', role: 'INSTANCE_ADMIN', deleted: '1' });
    expect(lastQuery(api)).toMatchObject({ q: 'ed', status: 'LOCKED', systemRole: 'INSTANCE_ADMIN', includeDeleted: true, page: 0 });
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Status: Locked' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Role: Instance admin' })).toBeTruthy();
  });

  it('writes the filter to the URL when it changes, searching after a short pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = await setup();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: ' ed ' } });
    expect(lastQuery(api).q).toBeUndefined();
    vi.advanceTimersByTime(USER_SEARCH_DEBOUNCE_MS + 10);
    await waitFor(() => expect(lastQuery(api)).toMatchObject({ q: 'ed', page: 0 }));
    await waitFor(() => expect(navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { q: 'ed', status: null, role: null, deleted: null }, replaceUrl: true }));
  });

  it('filters by status and shows deleted users when asked', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disabled' }));
    await waitFor(() => expect(lastQuery(api)).toMatchObject({ status: 'DISABLED', page: 0 }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show deleted' }));
    await waitFor(() => expect(lastQuery(api)).toMatchObject({ includeDeleted: true }));
  });

  it('opens a user from the row and from the row menu (Edit user)', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(await screen.findByText('Ed Itor'));
    expect(navigate).toHaveBeenCalledWith(['/admin/users', 5]);
    navigate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Nina Park' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit user' }));
    expect(navigate).toHaveBeenCalledWith(['/admin/users', 6]);
  });

  it('signs a user out everywhere only after a confirmation, and says so', async () => {
    const { api } = await setup();
    await screen.findByText('Nina Park');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Nina Park' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out everywhere' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sign Nina Park out everywhere?')).toBeTruthy();
    expect(api.adminRevokeSessions).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(api.adminRevokeSessions).toHaveBeenCalledWith(6));
    await waitFor(() => expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toContain('Nina Park was signed out everywhere'));
  });

  it('keeps the list menu free of danger items', async () => {
    await setup();
    await screen.findByText('Nina Park');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Nina Park' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Edit user');
    expect(items[1].textContent).toContain('Sign out everywhere');
    expect(items.some((i) => /delete/i.test(i.textContent ?? ''))).toBe(false);
  });

  it('shows the empty state for an empty answer', async () => {
    await setup({}, of({ content: [], page: { totalElements: 0 } }));
    expect(await screen.findByText('No users match.')).toBeTruthy();
  });

  it('shows the loading skeleton while the users load and an error with Retry when they fail', async () => {
    const pending = new Subject<AdminUserPage>();
    const { api, view } = await setup({}, pending);
    expect(view.container.querySelector('[aria-busy="true"], sf-skeleton, .sf-data-table__skeleton')).toBeTruthy();
    pending.error(new Error('down'));
    expect(await screen.findByText('The users could not be loaded.')).toBeTruthy();
    api.adminListUsers.mockReturnValue(of(page));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ed Itor')).toBeTruthy();
  });

  it('opens the New user dialog, and opens the account after it was created', async () => {
    const { api } = await setup();
    api.adminCreateUser.mockReturnValue(of({ id: 9, username: 'ada', displayName: 'Ada L', email: 'ada@example.com', status: 'ACTIVE', systemRole: 'USER' }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    fireEvent.input(within(dialog).getByLabelText(/^Username/), { target: { value: 'ada' } });
    fireEvent.input(within(dialog).getByLabelText(/^Display name/), { target: { value: 'Ada L' } });
    fireEvent.input(within(dialog).getByLabelText(/^Email/), { target: { value: 'ada@example.com' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Set a password/ }));
    fireEvent.input(await within(dialog).findByLabelText(/^New password/), { target: { value: 'a-long-enough-pw' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/admin/users', 9]));
    expect(api.adminCreateUser).toHaveBeenCalledWith(expect.objectContaining({ username: 'ada', password: 'a-long-enough-pw', systemRole: 'USER' }));
  });
});
