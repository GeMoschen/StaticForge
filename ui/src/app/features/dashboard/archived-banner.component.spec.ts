import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ArchivedBannerComponent } from './archived-banner.component';

type MeResponse = components['schemas']['MeResponse'];

const member: MeResponse = { id: 2, username: 'ed', systemRole: 'USER', projectRoles: { acme: 'PROJECT_ADMIN' } };
const admin: MeResponse = { id: 1, username: 'root', systemRole: 'INSTANCE_ADMIN', projectRoles: {} };

async function setup(user: MeResponse, archived: boolean) {
  const api = { unarchiveProject: vi.fn().mockReturnValue(of(undefined)) };
  const context = { loadFor: vi.fn().mockReturnValue(of(undefined)) };
  await render(ArchivedBannerComponent, {
    componentInputs: { projectKey: 'acme' },
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: context },
    ],
    configureTestBed: (tb) => {
      tb.inject(AuthStore).setUser(user);
      tb.inject(ProjectAccessStore).enterProject('acme', archived);
    },
  });
  return { api, context };
}

describe('ArchivedBannerComponent', () => {
  it('shows nothing for a project that is not archived', async () => {
    await setup(admin, false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('tells anyone in an archived project that it is read-only, without an Unarchive for non-admins', async () => {
    await setup(member, true);
    expect(screen.getByRole('status')).toHaveTextContent('This project is archived and read-only.');
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull();
  });

  it('lets an instance admin unarchive, then reloads the project', async () => {
    const { api, context } = await setup(admin, true);

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));

    expect(api.unarchiveProject).toHaveBeenCalledWith('acme');
    expect(context.loadFor).toHaveBeenCalledWith('acme', true);
  });
});
