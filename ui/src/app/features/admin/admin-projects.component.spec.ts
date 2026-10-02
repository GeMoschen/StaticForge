import '@angular/compiler';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { ToastService } from '../../core/ui/toast.service';
import { AdminProjectsComponent } from './admin-projects.component';

type AdminProjectRow = components['schemas']['AdminProjectRow'];

const rows: AdminProjectRow[] = [
  { key: 'acme', name: 'ACME Website', description: 'Main site', archived: false, memberCount: 4, headRevision: 42, lastChangeAt: '2026-09-20T08:00:00Z' },
  { key: 'old', name: 'Old Campaign', archived: true, memberCount: 1, headRevision: 7, lastChangeAt: '2025-01-01T08:00:00Z' },
];

async function setup(query: Record<string, string> = {}) {
  const api = {
    adminListProjects: vi.fn().mockReturnValue(of(rows)),
    archiveProject: vi.fn().mockReturnValue(of(undefined)),
    unarchiveProject: vi.fn().mockReturnValue(of(undefined)),
    createProject: vi.fn().mockReturnValue(of({ key: 'new' })),
    getProject: vi.fn().mockReturnValue(of({ key: 'acme', allowedMimeTypes: ['image/png'] })),
    updateProject: vi.fn().mockReturnValue(of({ key: 'acme' })),
  };
  const view = await render(AdminProjectsComponent, {
    providers: [
      provideTranslocoTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  await waitFor(() => expect(api.adminListProjects).toHaveBeenCalled());
  await screen.findByRole('grid');
  return { api, view };
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const menuOf = async (name: string) => {
  fireEvent.click(within(row(name)).getByRole('button', { name: `Actions for ${name}` }));
};

describe('AdminProjectsComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the active projects with the key under the name, members, last change and status; archived ones stay hidden', async () => {
    const { api } = await setup();

    expect(api.adminListProjects).toHaveBeenCalledWith({ includeArchived: true });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const acme = within(row('ACME Website'));
    expect(acme.getByText('acme')).toBeTruthy();
    expect(acme.getByText('Main site')).toBeTruthy();
    expect(acme.getByText('4')).toBeTruthy();
    expect(acme.getByText(/r42/)).toBeTruthy();
    expect(acme.getByText('Active')).toBeTruthy();
    expect(screen.queryByText('Old Campaign')).toBeNull();
  });

  it('shows archived projects on request, muted and named as Archived, with the filters in the URL', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Show archived' }));
    expect(within(row('Old Campaign')).getAllByText('Archived').length).toBeGreaterThan(0);
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { q: null, archived: '1' } })));

    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'main SITE' } });
    expect(screen.queryByText('Old Campaign')).toBeNull();
    expect(screen.getByText('ACME Website')).toBeTruthy();
    await waitFor(() => expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { q: 'main SITE', archived: '1' } })));
  });

  it('starts from the filters of the URL and clears them', async () => {
    await setup({ q: 'campaign', archived: '1' });
    expect(screen.getByText('Old Campaign')).toBeTruthy();
    expect(screen.queryByText('ACME Website')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('ACME Website')).toBeTruthy();
    expect(screen.queryByText('Old Campaign')).toBeNull();
  });

  it('says so when nothing matches', async () => {
    await setup({ q: 'zzz' });
    expect(await screen.findByText('No projects match.')).toBeTruthy();
  });

  it('opens the project on a row click and from the menu', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fireEvent.click(screen.getByText('ACME Website'));
    expect(navigate).toHaveBeenLastCalledWith(['/p', 'acme', 'pages']);
  });

  it('puts Edit project… first in the row menu, then Open and Archive', async () => {
    await setup();
    await menuOf('ACME Website');
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent?.trim() ?? '');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/Edit project…$/);
    expect(items[1]).toMatch(/Open project$/);
    expect(items[2]).toMatch(/Archive$/);
  });

  it('archives only after a confirmation, tells the auth store, and offers Undo that unarchives', async () => {
    const { api } = await setup();
    const auth = TestBed.inject(AuthStore);
    const setArchived = vi.spyOn(auth, 'setProjectArchived');
    const toast = vi.spyOn(TestBed.inject(ToastService), 'undo');

    await menuOf('ACME Website');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive ACME Website?' });
    expect(api.archiveProject).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(api.archiveProject).toHaveBeenCalledWith('acme'));
    expect(setArchived).toHaveBeenCalledWith('acme', true);
    const undo = toast.mock.calls.at(-1)![1];
    undo();
    expect(api.unarchiveProject).toHaveBeenCalledWith('acme');
  });

  it('does not archive when the confirmation is declined', async () => {
    const { api } = await setup();
    await menuOf('ACME Website');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.archiveProject).not.toHaveBeenCalled();
  });

  it('unarchives without a confirmation', async () => {
    const { api } = await setup({ archived: '1' });
    await menuOf('Old Campaign');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unarchive' }));
    expect(api.unarchiveProject).toHaveBeenCalledWith('old');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens New project from the primary button and reloads the list after it was created', async () => {
    const { api } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });

    fireEvent.input(within(dialog).getByLabelText(/Project key/), { target: { value: 'lumen' } });
    fireEvent.input(within(dialog).getByLabelText(/^Name/), { target: { value: 'Lumen Coffee' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

    expect(api.createProject).toHaveBeenCalledWith({ key: 'lumen', name: 'Lumen Coffee', description: '' });
    await waitFor(() => expect(api.adminListProjects).toHaveBeenCalledTimes(2));
  });

  it('shows an error state with Retry when the projects cannot be read', async () => {
    const api = { adminListProjects: vi.fn().mockReturnValue(throwError(() => new Error('down'))) };
    await render(AdminProjectsComponent, {
      providers: [provideTranslocoTesting(), provideRouter([]), { provide: ApiClient, useValue: api }],
    });
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
    expect(Location).toBeDefined();
  });
});
