import '@angular/compiler';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ProjectSettingsMediaComponent } from './project-settings-media.component';

async function setup() {
  const api = {
    getProject: vi.fn().mockReturnValue(of({ name: 'Demo', allowedMimeTypes: ['image/*', 'application/pdf'] })),
    updateProject: vi.fn().mockReturnValue(of({})),
  };
  await render(ProjectSettingsMediaComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: { loadFor: () => of(undefined) } },
      provideProjectPermissions({ role: () => 'PROJECT_ADMIN', readOnly: () => false }),
    ],
  });
  const patterns = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
  const save = () => screen.getByRole('button', { name: /Save changes|Saving/ }) as HTMLButtonElement;
  return { api, patterns, save };
}

describe('ProjectSettingsMediaComponent', () => {
  it('keeps Save disabled until the patterns change, and again after a save', async () => {
    const { api, patterns, save } = await setup();
    expect(patterns.value).toBe('image/*\napplication/pdf');
    expect(save().disabled).toBe(true);

    fireEvent.input(patterns, { target: { value: 'image/*\napplication/pdf\ntext/plain' } });
    await waitFor(() => expect(save().disabled).toBe(false));

    save().click();
    expect(api.updateProject).toHaveBeenCalledWith('proj', {
      name: 'Demo',
      description: undefined,
      allowedMimeTypes: ['image/*', 'application/pdf', 'text/plain'],
    });
    await waitFor(() => expect(save().disabled).toBe(true));
  });

  it('does not count blank lines and padding as a change', async () => {
    const { patterns, save } = await setup();

    fireEvent.input(patterns, { target: { value: ' image/*\n\napplication/pdf  \n' } });

    expect(save().disabled).toBe(true);
  });
});
