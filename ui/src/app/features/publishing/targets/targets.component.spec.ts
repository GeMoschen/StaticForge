import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { GenerationService } from '../../generation/generation.service';
import { PublishingTargetsComponent } from './targets.component';
import { type GenerationTargetView } from './targets.util';

type JsonNode = components['schemas']['JsonNode'];

/** Targets as `GET /targets` sends them: `baseUrl` is the contract's own field next to `config`. */
const LIVE: GenerationTargetView = {
  id: 1,
  name: 'Live',
  type: 'FILESYSTEM',
  config: { path: 'site', baseUrl: 'https://example.com', keep: 'me' } as unknown as JsonNode,
  isDefault: true,
  outputPath: 'proj/site',
  redirectFormats: ['HTML_STUB'],
  baseUrl: 'https://example.com',
};
const ARCHIVE: GenerationTargetView = {
  id: 2,
  name: 'Archive',
  type: 'ZIP',
  config: { redirectFormats: ['HTACCESS', 'JSON'] } as unknown as JsonNode,
  isDefault: false,
  outputPath: 'proj/target-2',
  redirectFormats: ['HTACCESS', 'JSON'],
  baseUrl: undefined,
};

interface Setup {
  targets?: GenerationTargetView[];
  role?: string;
  readOnlyLabel?: string | null;
  confirm?: boolean;
}

async function setup({ targets = [LIVE, ARCHIVE], role = 'PROJECT_ADMIN', readOnlyLabel = null, confirm = true }: Setup = {}) {
  const api = {
    listTargets: vi.fn().mockReturnValue(of(targets)),
    createTarget: vi.fn().mockReturnValue(of(LIVE)),
    updateTarget: vi.fn().mockReturnValue(of(LIVE)),
    deleteTarget: vi.fn().mockReturnValue(of(undefined)),
  };
  const confirms = { confirm: vi.fn().mockResolvedValue(confirm) };
  const access = { readOnly: signal(readOnlyLabel !== null), readOnlyLabel: signal(readOnlyLabel) };
  const view = await render(PublishingTargetsComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: GenerationService, useValue: api },
      { provide: ConfirmService, useValue: confirms },
      { provide: ProjectAccessStore, useValue: access },
      provideProjectPermissions({ role: () => role }),
    ],
  });
  return { ...view, api, confirms };
}

const rows = () => screen.getAllByRole('row').slice(1);

async function openMenu(rowIndex: number, item: string): Promise<void> {
  fireEvent.click(within(rows()[rowIndex]).getByRole('button', { name: /^Actions for/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

function field(label: RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function fill(label: RegExp, value: string): void {
  fireEvent.input(field(label), { target: { value } });
}

function problem(status: number, body: Record<string, unknown>) {
  return throwError(() => new HttpErrorResponse({ status, error: body }));
}

describe('PublishingTargetsComponent', () => {
  it('lists the targets with their kind, output folder and base URL, and marks the default', async () => {
    const { api } = await setup();

    expect(api.listTargets).toHaveBeenCalledWith('proj');
    await waitFor(() => expect(rows()).toHaveLength(2));
    const live = within(rows()[0]);
    expect(live.getByText('Live')).toBeInTheDocument();
    expect(live.getByText('Default')).toBeInTheDocument();
    expect(live.getByText('Folder')).toBeInTheDocument();
    expect(live.getByText('proj/site')).toBeInTheDocument();
    expect(live.getByText('https://example.com')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('ZIP')).toBeInTheDocument();
    expect(screen.getAllByText('Default')).toHaveLength(1);
  });

  it('shows an empty state with New target when the project has none', async () => {
    const { api } = await setup({ targets: [] });

    expect(await screen.findByText('No generation targets yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New target' }));
    expect(await screen.findByRole('dialog', { name: 'New target' })).toBeInTheDocument();
    // The first target starts as the default so builds work without a second step.
    expect(screen.getByRole('checkbox', { name: 'Default target' })).toBeChecked();
    expect(api.createTarget).not.toHaveBeenCalled();
  });

  it('creates a target from the drawer: type, output folder, base URL and redirect output', async () => {
    const { api } = await setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'New target' }));
    await screen.findByRole('dialog', { name: 'New target' });
    expect(screen.getByRole('checkbox', { name: 'Default target' })).not.toBeChecked();
    const create = screen.getByRole('button', { name: 'Create target' });
    expect(create).toBeDisabled();

    fill(/^Name/, ' Cloud ');
    fireEvent.click(screen.getByRole('radio', { name: 'S3' }));
    fill(/^Output folder/, ' cloud/site ');
    fill(/^Base URL/, 'https://cdn.example.com');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Apache .htaccess' }));
    fireEvent.click(create);

    await waitFor(() => expect(api.createTarget).toHaveBeenCalledTimes(1));
    expect(api.createTarget).toHaveBeenCalledWith('proj', {
      name: 'Cloud',
      type: 'S3',
      config: { path: 'cloud/site', redirectFormats: ['HTML_STUB', 'HTACCESS'] },
      isDefault: false,
      baseUrl: 'https://cdn.example.com',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.listTargets).toHaveBeenCalledTimes(2);
  });

  it('edits a target with its values, keeps the config keys it does not edit and sends a cleared base URL as blank', async () => {
    const { api } = await setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await openMenu(0, 'Edit');
    await screen.findByRole('dialog', { name: 'Edit target “Live”' });
    expect(field(/^Name/).value).toBe('Live');
    expect(field(/^Output folder/).value).toBe('site');
    expect(field(/^Base URL/).value).toBe('https://example.com');
    expect(screen.getByText(/starts a fresh folder/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'HTML redirect pages' })).toBeChecked();

    fill(/^Base URL/, '');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.updateTarget).toHaveBeenCalledTimes(1));
    expect(api.updateTarget).toHaveBeenCalledWith('proj', 1, {
      name: 'Live',
      type: 'FILESYSTEM',
      config: { path: 'site', baseUrl: 'https://example.com', keep: 'me', redirectFormats: ['HTML_STUB'] },
      isDefault: true,
      baseUrl: '',
    });
  });

  it('opens the drawer from a row too', async () => {
    await setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(within(rows()[1]).getByText('Archive'));
    expect(await screen.findByRole('dialog', { name: 'Edit target “Archive”' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'ZIP' })).toBeChecked();
  });

  it('shows a duplicate name on the Name field and keeps the drawer open', async () => {
    const { api } = await setup();
    api.createTarget.mockReturnValue(problem(409, { code: 'SF-API-0409', field: 'name', detail: 'A target named Live exists.' }));
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'New target' }));
    await screen.findByRole('dialog', { name: 'New target' });
    fill(/^Name/, 'live');
    fireEvent.click(screen.getByRole('button', { name: 'Create target' }));

    expect(await screen.findByText('A target with this name already exists.')).toBeInTheDocument();
    expect(field(/^Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Typing a new name answers the refusal.
    fill(/^Name/, 'Live 2');
    await waitFor(() => expect(screen.queryByText('A target with this name already exists.')).toBeNull());
  });

  it('shows an output folder that overlaps another target on the Output folder field', async () => {
    const { api } = await setup();
    api.createTarget.mockReturnValue(
      problem(400, { code: 'SF-API-0400', detail: "Output path 'site/a' overlaps the output of target 'Live'." }),
    );
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'New target' }));
    await screen.findByRole('dialog', { name: 'New target' });
    fill(/^Name/, 'Nested');
    fill(/^Output folder/, 'site/a');
    fireEvent.click(screen.getByRole('button', { name: 'Create target' }));

    expect(await screen.findByText("Output path 'site/a' overlaps the output of target 'Live'.")).toBeInTheDocument();
    expect(field(/^Output folder/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a rejected base URL on the Base URL field', async () => {
    const { api } = await setup();
    api.createTarget.mockReturnValue(problem(400, { code: 'SF-API-0400', field: 'baseUrl', detail: 'baseUrl must be an absolute http(s) URL.' }));
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'New target' }));
    await screen.findByRole('dialog', { name: 'New target' });
    fill(/^Name/, 'Odd');
    fill(/^Base URL/, 'example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Create target' }));

    expect(await screen.findByText('baseUrl must be an absolute http(s) URL.')).toBeInTheDocument();
    expect(field(/^Base URL/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('toasts an error that belongs to no field', async () => {
    const { api } = await setup();
    api.createTarget.mockReturnValue(problem(403, { detail: 'Not allowed.' }));
    const show = vi.spyOn(TestBed.inject(ToastService), 'show');
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'New target' }));
    await screen.findByRole('dialog', { name: 'New target' });
    fill(/^Name/, 'Odd');
    fireEvent.click(screen.getByRole('button', { name: 'Create target' }));

    await waitFor(() => expect(show).toHaveBeenCalledWith('Not allowed.', 'error'));
  });

  it('asks before deleting and deletes only when confirmed', async () => {
    const declined = await setup({ confirm: false });
    await waitFor(() => expect(rows()).toHaveLength(2));
    await openMenu(1, 'Delete…');

    await waitFor(() => expect(declined.confirms.confirm).toHaveBeenCalled());
    expect(declined.confirms.confirm.mock.calls[0][0]).toMatchObject({
      title: 'Delete “Archive”?',
      message: 'Past runs published to it can no longer be promoted. Files already written to proj/target-2 stay on the server.',
      confirmLabel: 'Delete target',
      tone: 'danger',
    });
    expect(declined.api.deleteTarget).not.toHaveBeenCalled();
  });

  it('deletes the confirmed target and reloads the list', async () => {
    const { api } = await setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await openMenu(1, 'Delete…');

    await waitFor(() => expect(api.deleteTarget).toHaveBeenCalledWith('proj', 2));
    await waitFor(() => expect(api.listTargets).toHaveBeenCalledTimes(2));
  });

  it('is read-only for an editor: no New target, no row menu, no drawer, and says why', async () => {
    await setup({ role: 'EDITOR' });
    await waitFor(() => expect(rows()).toHaveLength(2));

    expect(screen.queryByRole('button', { name: 'New target' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.getByText('Only project admins can change targets.')).toBeInTheDocument();
    fireEvent.click(within(rows()[0]).getByText('Live'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets a developer create a target but not change one', async () => {
    await setup({ role: 'DEVELOPER' });
    await waitFor(() => expect(rows()).toHaveLength(2));

    expect(screen.getByRole('button', { name: 'New target' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('names the read-only state of the project instead of the admin hint', async () => {
    await setup({ readOnlyLabel: 'This project is archived.', role: 'PROJECT_ADMIN' });

    expect(await screen.findByText('This project is archived.')).toBeInTheDocument();
    expect(screen.queryByText('Only project admins can change targets.')).toBeNull();
  });
});
