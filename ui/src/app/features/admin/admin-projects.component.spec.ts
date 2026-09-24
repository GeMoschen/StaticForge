import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { AdminProjectsComponent } from './admin-projects.component';

type AdminProjectRow = components['schemas']['AdminProjectRow'];

const rows: AdminProjectRow[] = [
  { key: 'acme', name: 'ACME Website', description: 'Main site', archived: false, memberCount: 4, headRevision: 42, lastChangeAt: '2026-09-20T08:00:00Z' },
  { key: 'old', name: 'Old Campaign', archived: true, memberCount: 1, headRevision: 7, lastChangeAt: '2025-01-01T08:00:00Z' },
];

async function setup() {
  const api = {
    adminListProjects: vi.fn().mockReturnValue(of(rows)),
    archiveProject: vi.fn().mockReturnValue(of(undefined)),
    unarchiveProject: vi.fn().mockReturnValue(of(undefined)),
  };
  const view = await render(AdminProjectsComponent, {
    providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
  });
  return { api, view };
}

function row(name: string): HTMLElement {
  return screen.getByText(name, { selector: '.project-name' }).closest('tr') as HTMLElement;
}

describe('AdminProjectsComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists every project with members, last change and the archived chip; opens one', async () => {
    const { api } = await setup();

    expect(api.adminListProjects).toHaveBeenCalledWith({ includeArchived: true });
    expect(within(row('ACME Website')).getByText('4')).toBeTruthy();
    expect(within(row('ACME Website')).getByText(/r42/)).toBeTruthy();
    expect(within(row('Old Campaign')).getByText('Archived')).toBeTruthy();
    expect(within(row('ACME Website')).getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/p/acme/pages');
  });

  it('filters by text and hides archived projects on request', async () => {
    await setup();

    fireEvent.input(screen.getByLabelText('Search projects'), { target: { value: 'main SITE' } });
    expect(screen.getByText('ACME Website', { selector: '.project-name' })).toBeTruthy();
    expect(screen.queryByText('Old Campaign', { selector: '.project-name' })).toBeNull();

    fireEvent.input(screen.getByLabelText('Search projects'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Show archived'));
    expect(screen.queryByText('Old Campaign', { selector: '.project-name' })).toBeNull();
  });

  it('archives only after confirming what it does, and unarchives directly', async () => {
    const { api, view } = await setup();
    const auth = view.fixture.debugElement.injector.get(AuthStore);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(within(row('ACME Website')).getByRole('button', { name: /Archive/ }));
    expect(confirm.mock.calls[0][0]).toMatch(/members lose access.*read-only/s);
    expect(api.archiveProject).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(row('ACME Website')).getByRole('button', { name: /Archive/ }));
    expect(api.archiveProject).toHaveBeenCalledWith('acme');
    expect(auth.isArchived('acme')).toBe(true);

    fireEvent.click(within(row('Old Campaign')).getByRole('button', { name: /Unarchive/ }));
    expect(api.unarchiveProject).toHaveBeenCalledWith('old');
    expect(api.adminListProjects).toHaveBeenCalledTimes(3);
  });
});
