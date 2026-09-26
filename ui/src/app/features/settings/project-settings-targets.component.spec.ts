import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { GenerationService } from '../generation/generation.service';
import { ProjectSettingsTargetsComponent } from './project-settings-targets.component';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';

type GenerationTargetView = components['schemas']['GenerationTargetView'];
type JsonNode = components['schemas']['JsonNode'];

const live: GenerationTargetView = {
  id: 1,
  name: 'Live',
  type: 'FILESYSTEM',
  config: { path: 'site', baseUrl: 'https://example.com', keep: 'me' } as unknown as JsonNode,
  isDefault: true,
  outputPath: 'proj/site',
};

const scratch: GenerationTargetView = {
  id: 2,
  name: 'Scratch',
  type: 'ZIP',
  config: {} as JsonNode,
  isDefault: false,
  outputPath: 'proj/target-2',
};

function makeApiStub(targets: GenerationTargetView[] = [live, scratch]) {
  return {
    listTargets: vi.fn().mockReturnValue(of(targets)),
    createTarget: vi.fn().mockReturnValue(of(scratch)),
    updateTarget: vi.fn().mockReturnValue(of(live)),
    deleteTarget: vi.fn().mockReturnValue(of(undefined)),
  };
}

async function setup(api = makeApiStub(), role = 'PROJECT_ADMIN') {
  const view = await render(ProjectSettingsTargetsComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: GenerationService, useValue: api },
      provideProjectPermissions({ role: () => role, readOnly: () => false }),
    ],
  });
  return { api, view };
}

/** `sf-field` labels also contain their hint text, so match on the leading label only. */
function input(label: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
}

describe('ProjectSettingsTargetsComponent', () => {
  it('lists targets with their output folder and default badge', async () => {
    const { api } = await setup();

    expect(api.listTargets).toHaveBeenCalledWith('proj');
    await waitFor(() => expect(screen.getByText('proj/site')).toBeTruthy());
    expect(screen.getByText('proj/target-2')).toBeTruthy();
    expect(screen.getByText('https://example.com')).toBeTruthy();
    expect(screen.getAllByText('default')).toHaveLength(1);
  });

  it('creates the first target as default with the entered path', async () => {
    const api = makeApiStub([]);
    await setup(api);
    await waitFor(() => expect(screen.getByText('No generation targets yet')).toBeTruthy());

    fireEvent.click(screen.getByText('New target'));
    fireEvent.input(input('Name'), { target: { value: ' Live ' } });
    fireEvent.input(input('Output folder'), { target: { value: 'site/live' } });
    fireEvent.click(screen.getByText('Create target'));

    expect(api.createTarget).toHaveBeenCalledWith('proj', {
      name: 'Live',
      type: 'FILESYSTEM',
      config: { path: 'site/live' },
      isDefault: true,
    });
    expect(api.listTargets).toHaveBeenCalledTimes(2);
  });

  it('editing keeps unknown config keys and drops cleared ones', async () => {
    const { api } = await setup();
    await waitFor(() => expect(screen.getByText('proj/site')).toBeTruthy());

    fireEvent.click(screen.getAllByText('Edit')[0]);
    expect(input('Output folder').value).toBe('site');
    fireEvent.input(input('Base URL'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save changes'));

    expect(api.updateTarget).toHaveBeenCalledWith('proj', 1, {
      name: 'Live',
      type: 'FILESYSTEM',
      config: { path: 'site', keep: 'me' },
      isDefault: true,
    });
  });

  it('shows the server validation message when saving fails', async () => {
    const api = makeApiStub();
    api.createTarget.mockReturnValue(
      throwError(() => ({ status: 400, error: { detail: "Output path 'site' overlaps the output of target 'Live'." } })),
    );
    await setup(api);
    await waitFor(() => expect(screen.getByText('proj/site')).toBeTruthy());

    fireEvent.click(screen.getByText('New target'));
    fireEvent.input(input('Name'), { target: { value: 'Clash' } });
    fireEvent.input(input('Output folder'), { target: { value: 'site' } });
    fireEvent.click(screen.getByText('Create target'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('overlaps'));
  });

  it('deletes a target after confirmation', async () => {
    const { api } = await setup();
    await waitFor(() => expect(screen.getByText('proj/target-2')).toBeTruthy());

    fireEvent.click(screen.getAllByText('Delete')[1]);
    expect(api.deleteTarget).not.toHaveBeenCalled();
    const dialogButtons = screen.getByRole('dialog').querySelectorAll('sf-button');
    fireEvent.click(dialogButtons[dialogButtons.length - 1].querySelector('button') ?? dialogButtons[dialogButtons.length - 1]);

    expect(api.deleteTarget).toHaveBeenCalledWith('proj', 2);
    await waitFor(() => expect(screen.queryByText('proj/target-2')).toBeNull());
  });
});
