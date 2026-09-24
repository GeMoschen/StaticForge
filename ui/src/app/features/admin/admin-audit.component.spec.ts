import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AdminAuditComponent } from './admin-audit.component';
import {
  AUDIT_PAGE_SIZE,
  auditApiQuery,
  auditFilterFromParams,
  paramsFromAuditFilter,
} from './admin-audit.util';

type AdminAuditPage = components['schemas']['AdminAuditPage'];

describe('audit filter ↔ URL', () => {
  it('round-trips every filter through the query parameters', () => {
    const state = {
      actions: ['LOGIN_FAILED', 'USER_DELETED'],
      userId: 7,
      project: '_instance',
      from: '2026-09-01',
      to: '2026-09-24',
      page: 2,
    };
    const params = paramsFromAuditFilter(state);
    expect(params).toEqual({
      action: ['LOGIN_FAILED', 'USER_DELETED'],
      user: 7,
      project: '_instance',
      from: '2026-09-01',
      to: '2026-09-24',
      page: 2,
    });
    // Router query params arrive as strings (and a single action as a plain string).
    expect(
      auditFilterFromParams({ ...params, user: '7', page: '2' }),
    ).toEqual(state);
    expect(auditFilterFromParams({ action: 'LOGIN_FAILED' }).actions).toEqual(['LOGIN_FAILED']);
  });

  it('leaves empty filters out of the URL and drops malformed ones', () => {
    expect(paramsFromAuditFilter(auditFilterFromParams({}))).toEqual({
      action: null,
      user: null,
      project: null,
      from: null,
      to: null,
      page: null,
    });
    expect(auditFilterFromParams({ user: 'x', from: 'yesterday', page: '-1' })).toMatchObject({
      userId: null,
      from: null,
      page: 0,
    });
  });

  it('turns the day range into instants covering whole local days', () => {
    const query = auditApiQuery(auditFilterFromParams({ from: '2026-09-01', to: '2026-09-24', page: '1' }));
    expect(query.from).toBe(new Date(2026, 8, 1).toISOString());
    expect(query.to).toBe(new Date(2026, 8, 25).toISOString());
    expect(query).toMatchObject({ page: 1, size: AUDIT_PAGE_SIZE, action: undefined, project: undefined });
  });
});

const page: AdminAuditPage = {
  content: [
    {
      id: 11,
      timestamp: '2026-09-24T09:00:00Z',
      action: 'USER_DELETED',
      actor: { id: 1, username: 'root' },
      target: 'user:deleted-user-5',
      detail: { userId: 5 } as unknown as components['schemas']['JsonNode'],
    },
    {
      id: 10,
      timestamp: '2026-09-24T08:00:00Z',
      action: 'MEMBER_ROLE_SET',
      actor: { id: 1, username: 'root' },
      projectKey: 'acme',
      target: 'member:5',
    },
  ],
  page: { size: AUDIT_PAGE_SIZE, number: 0, totalElements: 2, totalPages: 1 },
};

async function setup(queryParams: Record<string, unknown> = {}) {
  const api = {
    adminAudit: vi.fn().mockReturnValue(of(page)),
    adminAuditActions: vi.fn().mockReturnValue(of(['MEMBER_ROLE_SET', 'USER_DELETED'])),
    adminListProjects: vi.fn().mockReturnValue(of([{ key: 'acme', name: 'ACME' }])),
    adminListUsers: vi.fn().mockReturnValue(of({ content: [{ id: 5, username: 'ed' }] })),
    adminGetUser: vi.fn().mockReturnValue(of({ id: 7, username: 'grace', status: 'ACTIVE' })),
  };
  const params = new BehaviorSubject<Record<string, unknown>>(queryParams);
  const route = { queryParams: params, snapshot: { queryParams } };
  const view = await render(AdminAuditComponent, {
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }, { provide: ActivatedRoute, useValue: route }],
  });
  const router = view.fixture.debugElement.injector.get(Router);
  const navigate = vi.spyOn(router, 'navigate').mockImplementation((_commands, extras) => {
    params.next((extras?.queryParams ?? {}) as Record<string, unknown>);
    return Promise.resolve(true);
  });
  return { api, navigate };
}

describe('AdminAuditComponent', () => {
  it('loads the page the URL describes and names the user from the URL', async () => {
    const { api } = await setup({ action: ['USER_DELETED'], user: '7', project: '_instance', page: '1' });

    expect(api.adminAudit).toHaveBeenCalledWith({
      action: ['USER_DELETED'],
      userId: 7,
      project: '_instance',
      from: undefined,
      to: undefined,
      page: 1,
      size: AUDIT_PAGE_SIZE,
    });
    expect(await screen.findByText(/grace/)).toBeTruthy();
  });

  it('writes filter changes to the URL, back on the first page, and reloads', async () => {
    const { api, navigate } = await setup({ page: '3' });

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'acme' } });

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ project: 'acme', page: null }),
    }));
    await waitFor(() => expect(api.adminAudit).toHaveBeenLastCalledWith(expect.objectContaining({ project: 'acme', page: 0 })));
  });

  it('picks the user filter from a lookup', async () => {
    const { navigate } = await setup();

    fireEvent.input(screen.getByPlaceholderText('Username…'), { target: { value: 'ed' } });
    fireEvent.click(await screen.findByRole('option', { name: /ed/ }));

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: expect.objectContaining({ user: 5 }),
    }));
  });

  it('shows the entries and expands the detail on request', async () => {
    await setup();

    expect(await screen.findByText('USER_DELETED', { selector: 'td span' })).toBeTruthy();
    expect(screen.getByText('Instance', { selector: 'td span' })).toBeTruthy();
    expect(screen.getByText('ACME', { selector: 'td' })).toBeTruthy();
    expect(screen.queryByText(/"userId": 5/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    expect(screen.getByText(/"userId": 5/)).toBeTruthy();
  });
});
