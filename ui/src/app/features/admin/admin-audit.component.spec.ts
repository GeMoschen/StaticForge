import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../assets/i18n/en.json';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AdminAuditComponent } from './admin-audit.component';
import {
  AUDIT_PAGE_SIZE,
  KNOWN_AUDIT_ACTIONS,
  auditApiQuery,
  auditFilterFromParams,
  auditRangeInvalid,
  humanizeAuditAction,
  paramsFromAuditFilter,
  summarizeAuditDetail,
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
    expect(auditFilterFromParams({ ...params, user: '7', page: '2' })).toEqual(state);
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

describe('audit action labels and detail', () => {
  it('has a human label for every action the server writes', () => {
    const labels = (en as { admin: { audit: { actions: Record<string, string> } } }).admin.audit.actions;
    for (const code of KNOWN_AUDIT_ACTIONS) {
      expect(labels[code], code).toBeTruthy();
      expect(labels[code]).not.toBe(code);
    }
  });

  it('makes the code of an unknown action readable', () => {
    expect(humanizeAuditAction('USER_PASSWORD_RESET')).toBe('User password reset');
    expect(humanizeAuditAction('SOMETHING_NEW')).toBe('Something new');
  });

  it('knows when the end of the range is before the start', () => {
    expect(auditRangeInvalid({ from: '2026-09-10', to: '2026-09-01' })).toBe(true);
    expect(auditRangeInvalid({ from: '2026-09-01', to: '2026-09-01' })).toBe(false);
    expect(auditRangeInvalid({ from: null, to: '2026-09-01' })).toBe(false);
  });

  it('summarises a detail on one line and cuts a long one', () => {
    expect(summarizeAuditDetail({ userId: 5, role: 'EDITOR' })).toBe('userId: 5, role: EDITOR');
    expect(summarizeAuditDetail(null)).toBe('');
    expect(summarizeAuditDetail({ note: 'x'.repeat(200) }, 20)).toHaveLength(20);
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
    {
      id: 9,
      timestamp: '2026-09-24T07:00:00Z',
      action: 'AUTH_LOGIN_FAILED',
      target: 'user:ghost',
    },
  ],
  page: { size: AUDIT_PAGE_SIZE, number: 0, totalElements: 3, totalPages: 1 },
};

async function setup(queryParams: Record<string, unknown> = {}, audit: unknown = of(page)) {
  const api = {
    adminAudit: vi.fn().mockReturnValue(audit),
    adminAuditActions: vi.fn().mockReturnValue(of(['MEMBER_ROLE_SET', 'USER_DELETED', 'BRAND_NEW_ACTION'])),
    adminListProjects: vi.fn().mockReturnValue(of([{ key: 'acme', name: 'ACME' }])),
    adminListUsers: vi.fn().mockReturnValue(of({ content: [{ id: 5, username: 'ed', displayName: 'Ed Smith' }] })),
    adminGetUser: vi.fn().mockReturnValue(of({ id: 7, username: 'grace', displayName: 'Grace Hopper', status: 'ACTIVE' })),
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
  return { ...view, api, navigate };
}

describe('AdminAuditComponent', () => {
  it('is a page with one heading, a labelled search region and the table', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Audit' })).toBeTruthy();
    expect(screen.getByRole('search', { name: 'Audit filters' })).toBeTruthy();
    expect(await screen.findByRole('grid', { name: 'Audit log' })).toBeTruthy();
    expect(screen.getByText('3 entries')).toBeTruthy();
  });

  it('shows human action labels, never the codes, and names the project or the instance', async () => {
    await setup();
    expect(await screen.findByText('Deleted user', { selector: '.cell-name__text' })).toBeTruthy();
    expect(screen.getByText('Changed project role', { selector: '.cell-name__text' })).toBeTruthy();
    expect(screen.getByText('Sign-in failed', { selector: '.cell-name__text' })).toBeTruthy();
    expect(screen.queryByText('USER_DELETED')).toBeNull();
    expect(screen.getByText('ACME')).toBeTruthy();
    expect(screen.getAllByText('Instance').length).toBeGreaterThan(0);
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByText('userId: 5')).toBeTruthy();
  });

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
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'User' }) as HTMLInputElement).value).toBe('Grace Hopper'));
  });

  it('chooses actions in a multi-select combobox by their labels and writes them to the URL, back on the first page', async () => {
    const { api, navigate } = await setup({ page: '3' });
    const combo = screen.getByRole('combobox', { name: 'Actions' });
    fireEvent.focus(combo);
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Deleted user' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Changed project role' }));

    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ action: ['USER_DELETED', 'MEMBER_ROLE_SET'], page: null }) }),
    );
    await waitFor(() =>
      expect(api.adminAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: ['USER_DELETED', 'MEMBER_ROLE_SET'], page: 0 })),
    );
  });

  it('offers an action only the log knows by a readable form of its code', async () => {
    await setup();
    const combo = screen.getByRole('combobox', { name: 'Actions' });
    fireEvent.focus(combo);
    fireEvent.keyDown(combo, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: 'Brand new action' })).toBeTruthy();
  });

  it('finds a user by typing, and puts the choice in the URL', async () => {
    const { api, navigate } = await setup();
    const combo = screen.getByRole('combobox', { name: 'User' });
    fireEvent.input(combo, { target: { value: 'ed' } });
    await waitFor(() => expect(api.adminListUsers).toHaveBeenCalledWith({ q: 'ed', includeDeleted: true, size: 8 }));
    fireEvent.click(await screen.findByRole('option', { name: /Ed Smith/ }));

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ user: 5 }) }));
  });

  it('writes the project filter to the URL', async () => {
    const { navigate } = await setup({ page: '3' });
    // The select's options carry their index: All projects, Instance only, ACME.
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: '2' } });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ project: 'acme', page: null }) }),
    );
  });

  it('holds the date range inline and says so when the end is before the start, without asking the server', async () => {
    const { api } = await setup({ from: '2026-09-10', to: '2026-09-01' });
    expect(screen.getByRole('group', { name: 'Date range' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('The end date is before the start date.');
    expect(api.adminAudit).not.toHaveBeenCalled();
  });

  it('shows no Clear filters button while no filter is set', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('clears every filter with one button', async () => {
    const { navigate } = await setup({ project: 'acme' });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: {} }));
  });

  it('says so when nothing matches and offers to clear the filters', async () => {
    await setup({ project: 'acme' }, of({ content: [], page: { size: AUDIT_PAGE_SIZE, number: 0, totalElements: 0, totalPages: 0 } }));
    expect(await screen.findByText('No audit entries match.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });

  it('shows a skeleton while loading', async () => {
    const { container } = await setup({}, new Subject<AdminAuditPage>());
    expect(container.querySelector('[class*="skeleton"]')).toBeTruthy();
  });

  it('shows an error with Retry that asks again', async () => {
    const { api } = await setup({}, throwError(() => new Error('boom')));
    expect(await screen.findByText('The audit log could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(api.adminAudit).toHaveBeenCalledTimes(2);
  });
});
