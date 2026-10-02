import '@angular/compiler';
import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { SampleScreenComponent } from '../sample-screen.component';
import {
  ADMIN_USERS,
  AUDIT_ACTIONS,
  NO_AUDIT_FILTERS,
  NO_USER_FILTERS,
  cronOf,
  filterAudit,
  filterUsers,
  formatAuditFilter,
  formatUserFilter,
  parseAuditFilter,
  parseUserFilter,
  runsOf,
  ADMIN_JOBS,
} from './admin-data';

/** The sample screen's Administration area (M35.16): the rail is the navigation; the screens read their query. */
async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ area: 'admin', ...query }) } } },
    ],
  });
  await screen.findByRole('heading', { level: 1 });
  return result;
}

const dialog = async () => (await screen.findAllByRole('dialog')).at(-1)!;
const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);
/** Watches what the screen writes to the URL from now on. */
const watchQuery = () => {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
};

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
  delete document.documentElement.dataset['codePalette'];
  TestBed.inject(ToastService).clear();
});

describe('admin filters', () => {
  it('round-trips the Users filters and hides deleted users unless asked', () => {
    const f = parseUserFilter('q:ada,status:active,role:admin,deleted:1');
    expect(f).toEqual({ q: 'ada', status: 'active', role: 'admin', deleted: true });
    expect(formatUserFilter(f)).toBe('q:ada,status:active,role:admin,deleted:1');
    expect(formatUserFilter(NO_USER_FILTERS)).toBeNull();
    expect(parseUserFilter('status:bogus,role:root').status).toBeNull();
    expect(filterUsers(ADMIN_USERS, NO_USER_FILTERS).some((u) => u.status === 'deleted')).toBe(false);
    expect(filterUsers(ADMIN_USERS, { ...NO_USER_FILTERS, deleted: true }).some((u) => u.status === 'deleted')).toBe(true);
    expect(filterUsers(ADMIN_USERS, { ...NO_USER_FILTERS, role: 'admin' }).map((u) => u.id)).toEqual(['u-ada', 'u-omar']);
  });

  it('round-trips the Audit filters (several actions, a user, a project, an open date range)', () => {
    const f = parseAuditFilter('act:signedIn.pageReleased,by:u-ada,project:lumen,from:2026-09-01');
    expect(f).toEqual({ actions: ['signedIn', 'pageReleased'], by: 'u-ada', project: 'lumen', from: '2026-09-01', to: null });
    expect(formatAuditFilter(f)).toBe('act:signedIn.pageReleased,by:u-ada,project:lumen,from:2026-09-01');
    expect(formatAuditFilter(NO_AUDIT_FILTERS)).toBeNull();
    expect(parseAuditFilter('act:nope,by:u-nobody,from:yesterday')).toEqual(NO_AUDIT_FILTERS);
    const now = Date.now();
    const all = filterAudit(NO_AUDIT_FILTERS, now);
    const released = filterAudit({ ...NO_AUDIT_FILTERS, actions: ['pageReleased'] }, now);
    expect(released.length).toBeGreaterThan(0);
    expect(released.length).toBeLessThan(all.length);
    expect(released.every((e) => e.action === 'pageReleased')).toBe(true);
  });

  it('describes a schedule with a cron expression and a deterministic history', () => {
    expect(cronOf({ frequency: 'daily', time: '03:00', weekday: 'mon', zone: 'UTC' })).toBe('0 3 * * *');
    expect(cronOf({ frequency: 'weekly', time: '02:30', weekday: 'sun', zone: 'UTC' })).toBe('30 2 * * 7');
    const job = ADMIN_JOBS[0];
    expect(runsOf(job)).toEqual(runsOf(job));
    expect(AUDIT_ACTIONS.every((a) => !/[A-Z_]{4,}/.test(a))).toBe(true);
  });
});

describe('Administration › Users', () => {
  it('lists the users with human role and status labels, and keeps the filters in the URL', async () => {
    await setup({ asec: 'users', ufilter: 'role:admin' });
    const queryOf = watchQuery();
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('2 users')).toBeInTheDocument();
    const table = screen.getByRole('grid', { name: 'Users' });
    expect(within(table).getAllByText('Instance admin').length).toBe(2);
    expect(table.textContent).not.toMatch(/INSTANCE_ADMIN|DISABLED/);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByText('13 users')).toBeInTheDocument());
    expect(queryOf()).not.toContain('ufilter');
    // Disabled, locked and pending-password users read in words.
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Password change pending')).toBeInTheDocument();
  });

  it('shows the empty, loading and error states with a way back', async () => {
    await setup({ asec: 'users', astate: 'empty' });
    expect(screen.getByText('No users match.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByText('13 users')).toBeInTheDocument());
  });

  it('shows an error with Retry', async () => {
    await setup({ asec: 'users', astate: 'error' });
    expect(screen.getByText('The users could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('13 users')).toBeInTheDocument());
  });

  it('creates a user with a one-time password shown once', async () => {
    await setup({ asec: 'users' });
    fireEvent.click(screen.getByRole('button', { name: 'New user' }));
    const form = await dialog();
    // Errors stay quiet until the first attempt.
    expect(within(form).queryByText('Enter a username.')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));
    expect(await within(form).findByText('Enter a username.')).toBeInTheDocument();
    fireEvent.input(within(form).getByRole('textbox', { name: /Username/ }), { target: { value: 'ines' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));
    expect(await within(form).findByText('That username is taken.')).toBeInTheDocument();
    fireEvent.input(within(form).getByRole('textbox', { name: /Username/ }), { target: { value: 'maya' } });
    fireEvent.input(within(form).getByRole('textbox', { name: /Display name/ }), { target: { value: 'Maya Lindqvist' } });
    fireEvent.input(within(form).getByRole('textbox', { name: /Email/ }), { target: { value: 'maya@example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create user' }));
    expect(await within(form).findByText(/only time it is shown/)).toBeInTheDocument();
    expect(within(form).getByText(/Tide-Lamp|Maple-Quill|Cedar-Pearl/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByText('14 users')).toBeInTheDocument());
  });
});

describe('Administration › User detail', () => {
  it('shows roles in words and offers one danger action in the menu, Disable as a secondary button', async () => {
    await setup({ asec: 'users', adetail: 'u-anna' });
    expect(screen.getByRole('heading', { level: 1, name: 'Anna Berger' })).toBeInTheDocument();
    expect(document.body.textContent).toContain('Release manager');
    expect(document.body.textContent).toContain('Editor');
    expect(document.body.textContent).not.toMatch(/RELEASE_MANAGER|PROJECT_ADMIN/);
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent ?? '')).toEqual([
      expect.stringContaining('Reset password…'),
      expect.stringContaining('Sign out everywhere'),
      expect.stringContaining('Make instance admin'),
      expect.stringContaining('Delete user'),
    ]);
    const danger = items.filter((i) => i.className.includes('danger') || i.getAttribute('data-danger') !== null);
    expect(danger.length).toBeLessThanOrEqual(1);
  });

  it('deletes only after the exact username is typed, and offers Undo', async () => {
    await setup({ asec: 'users', adetail: 'u-anna' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete user' }));
    const confirm = await dialog();
    const submit = within(confirm).getByRole('button', { name: 'Delete user' });
    expect(submit).toBeDisabled();
    fireEvent.input(within(confirm).getByRole('textbox'), { target: { value: 'ann' } });
    expect(submit).toBeDisabled();
    fireEvent.input(within(confirm).getByRole('textbox'), { target: { value: 'anna' } });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(lastToast()?.message).toBe('Anna Berger was deleted.'));
    expect(await screen.findByText(/This user was deleted/)).toBeInTheDocument();
    TestBed.inject(ToastService).toasts().at(-1)!.action!.run();
    await waitFor(() => expect(screen.queryByText(/This user was deleted/)).toBeNull());
  });

  it('disables with Undo instead of a confirmation, and saves the profile only when it changed', async () => {
    await setup({ asec: 'users', adetail: 'u-anna' });
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent.input(screen.getByRole('textbox', { name: /Display name/ }), { target: { value: 'Anna B.' } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(lastToast()?.message).toBe('The profile was saved.'));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(lastToast()?.message).toBe('Anna B. was disabled and can no longer sign in.'));
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });
});

describe('Administration › Projects, Jobs, Audit', () => {
  it('archives a project after a confirmation and unarchives without one', async () => {
    await setup({ asec: 'projects' });
    const queryOf = watchQuery();
    expect(screen.getByText('4 projects')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Demo site' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const confirm = await dialog();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(lastToast()?.message).toBe('Demo site was archived.'));
    await waitFor(() => expect(screen.getByText('3 projects')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('switch', { name: 'Show archived' }));
    await waitFor(() => expect(screen.getByText('6 projects')).toBeInTheDocument());
    expect(queryOf()).toContain('pfilter=archived%3A1');
  });

  it('creates a project: the key is checked as you type and Create stays disabled until it is valid', async () => {
    await setup({ asec: 'projects' });
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    const form = await dialog();
    const create = within(form).getByRole('button', { name: 'Create project' });
    expect(create).toBeDisabled();
    const key = within(form).getByRole('textbox', { name: /Project key/ });
    fireEvent.input(key, { target: { value: 'Maya' } });
    expect(await within(form).findByText('Use lower case letters only.')).toBeInTheDocument();
    fireEvent.input(key, { target: { value: 'lumen' } });
    expect(await within(form).findByText('That key is taken.')).toBeInTheDocument();
    fireEvent.input(key, { target: { value: 'maya' } });
    fireEvent.input(within(form).getByRole('textbox', { name: /Name/ }), { target: { value: 'Maya Studio' } });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(lastToast()?.message).toBe('“Maya Studio” was created.'));
    await waitFor(() => expect(screen.getByText('5 projects')).toBeInTheDocument());
  });

  it('edits a project from its row menu: the key is read-only and Save waits for a change', async () => {
    await setup({ asec: 'projects' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Demo site' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items[0].textContent).toContain('Edit project…');
    fireEvent.click(items[0]);
    const form = await dialog();
    expect(within(form).getByRole('textbox', { name: /Project key/ })).toHaveAttribute('readonly');
    const save = within(form).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.input(within(form).getByRole('textbox', { name: /Name/ }), { target: { value: 'Demo playground' } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(lastToast()?.message).toBe('“Demo playground” was saved.'));
    expect(await screen.findByText('Demo playground')).toBeInTheDocument();
  });

  it('gives the Users and Projects tables the same roomy identity cell', async () => {
    await setup({ asec: 'users' });
    expect(document.querySelector('.sf-table-identity .sf-table-identity__name')?.textContent).toContain('Ada Lovelace');
    expect(document.querySelector('.sf-table-identity__sub')?.textContent).toContain('@ada');
  });

  it('tells a job in words, mutes one whose code is gone, and opens its history', async () => {
    await setup({ asec: 'jobs' });
    expect(screen.getByText('Every day at 03:00 (Europe/Berlin)')).toBeInTheDocument();
    expect(screen.getByText('No longer installed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Compact old history'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Compact old history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dry run' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Runs of this job' })).toBeInTheDocument();
  });

  it('filters the audit log with a multi-select of human action labels', async () => {
    await setup({ asec: 'audit', afilter: 'act:signedIn.pageReleased' });
    const queryOf = watchQuery();
    expect(screen.getByRole('heading', { level: 1, name: 'Audit' })).toBeInTheDocument();
    const table = screen.getByRole('grid', { name: 'Audit log' });
    expect(table.textContent).toMatch(/Released page|Signed in/);
    expect(table.textContent).not.toMatch(/SIGNED_IN|PAGE_RELEASED/);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(queryOf()).not.toContain('afilter'));
  });
});
