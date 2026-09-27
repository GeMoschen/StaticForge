import { provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ProjectSettingsGeneralComponent } from './project-settings-general.component';

type ProjectDetail = components['schemas']['ProjectDetail'];

const project = { key: 'acme', name: 'Acme site', description: 'Our site' } as ProjectDetail;

async function setup() {
  const api = {
    getProject: vi.fn().mockReturnValue(of(project)),
    updateProject: vi.fn().mockReturnValue(of(project)),
  };
  await render(ProjectSettingsGeneralComponent, {
    componentInputs: { projectKey: 'acme' },
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: { project: () => project, loadFor: () => of(project) } },
      provideProjectPermissions({ projectKey: 'acme' }),
    ],
  });
  return api;
}

describe('ProjectSettingsGeneralComponent', () => {
  it('offers Save only after a real change', async () => {
    const api = await setup();
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    const name = screen.getByDisplayValue('Acme site');
    fireEvent.input(name, { target: { value: 'Acme web' } });
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeEnabled();

    // Typing the old value back (or only padding it with spaces) is no change.
    fireEvent.input(name, { target: { value: ' Acme site ' } });
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeDisabled();

    fireEvent.input(name, { target: { value: 'Acme web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.updateProject).toHaveBeenCalledWith('acme', expect.objectContaining({ name: 'Acme web' }));
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});
