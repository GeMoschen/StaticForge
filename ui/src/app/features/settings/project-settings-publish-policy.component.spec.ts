import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ProjectSettingsPublishPolicyComponent } from './project-settings-publish-policy.component';
import { togglePolicy } from './publish-policy.util';

type PublishPolicyView = components['schemas']['PublishPolicyView'];
type PublishPolicyImpactView = components['schemas']['PublishPolicyImpactView'];

/** `POST …/publish-policy/impact` as the API answers it: one editor's release would fail. */
const FAILING: PublishPolicyImpactView = {
  failingSchedules: [
    {
      id: 41,
      type: 'RELEASE',
      runAt: '2026-10-01T08:00:00Z',
      ownerUserId: 7,
      ownerName: 'Ed Itor',
      missingPermission: 'SCHEDULE_RELEASE',
    },
  ],
};

async function setup(options: { role?: string; policy?: string[]; impact?: PublishPolicyImpactView } = {}) {
  const api = {
    publishPolicy: vi.fn().mockReturnValue(of<PublishPolicyView>({ editor: options.policy ?? [] })),
    updatePublishPolicy: vi.fn((_key: string, body: PublishPolicyView) => of<PublishPolicyView>(body)),
    publishPolicyImpact: vi.fn().mockReturnValue(of<PublishPolicyImpactView>(options.impact ?? { failingSchedules: [] })),
  };
  const context = { refreshDetail: vi.fn() };
  await render(ProjectSettingsPublishPolicyComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: context },
      provideProjectPermissions({ role: () => options.role ?? 'PROJECT_ADMIN', readOnly: () => false }),
    ],
  });
  await screen.findByRole('switch', { name: /Release, discard and unpublish content/ });
  return { api, context };
}

function sw(name: RegExp): HTMLInputElement {
  return screen.getByRole('switch', { name }) as HTMLInputElement;
}

const RELEASE = /Release, discard/;
const SCHEDULE = /Schedule releases/;
const INCREMENTAL = /Start incremental builds/;
const FULL = /Start full builds/;

describe('togglePolicy', () => {
  it('switching a permission off switches off what needs it, and keeps the server order', () => {
    expect(togglePolicy(['FULL_BUILD', 'RELEASE'], 'INCREMENTAL_BUILD', true)).toEqual(['RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD']);
    expect(togglePolicy(['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'], 'RELEASE', false)).toEqual(['INCREMENTAL_BUILD']);
    expect(togglePolicy(['INCREMENTAL_BUILD', 'FULL_BUILD'], 'INCREMENTAL_BUILD', false)).toEqual([]);
  });
});

describe('ProjectSettingsPublishPolicyComponent', () => {
  it('shows the stored policy; a dependent switch is disabled until what it needs is on', async () => {
    await setup({ policy: ['INCREMENTAL_BUILD'] });

    expect(sw(RELEASE).checked).toBe(false);
    expect(sw(SCHEDULE).disabled).toBe(true);
    expect(screen.getByText(/Needs “Release, discard and unpublish content”/)).toBeTruthy();
    expect(sw(INCREMENTAL).checked).toBe(true);
    expect(sw(FULL).disabled).toBe(false);

    fireEvent.click(sw(RELEASE));
    await waitFor(() => expect(sw(SCHEDULE).disabled).toBe(false));
  });

  it('Save is enabled only with a change; switching RELEASE off also switches SCHEDULE_RELEASE off', async () => {
    const { api, context } = await setup({ policy: ['RELEASE', 'SCHEDULE_RELEASE'] });
    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    fireEvent.click(sw(RELEASE));
    await waitFor(() => expect(sw(SCHEDULE).checked).toBe(false));
    expect(save().disabled).toBe(false);

    // Back to the stored state: nothing to save.
    fireEvent.click(sw(RELEASE));
    fireEvent.click(sw(SCHEDULE));
    await waitFor(() => expect(save().disabled).toBe(true));

    fireEvent.click(sw(INCREMENTAL));
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());

    await waitFor(() =>
      expect(api.updatePublishPolicy).toHaveBeenCalledWith('proj', { editor: ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'] }),
    );
    expect(api.publishPolicyImpact).toHaveBeenCalledWith('proj', { editor: ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'] });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(context.refreshDetail).toHaveBeenCalled();
    await waitFor(() => expect(save().disabled).toBe(true));
  });

  it('lists the schedules a change would make fail and saves only when confirmed', async () => {
    const { api } = await setup({ policy: ['RELEASE', 'SCHEDULE_RELEASE'], impact: FAILING });

    fireEvent.click(sw(RELEASE));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog', { name: 'These schedules would fail' });
    expect(dialog.textContent).toContain('Ed Itor');
    expect(dialog.textContent).toContain('Schedule releases and unpublishing');
    expect(api.updatePublishPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updatePublishPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(api.updatePublishPolicy).toHaveBeenCalledWith('proj', { editor: [] }));
  });

  it('is read-only below project admin', async () => {
    const { api } = await setup({ role: 'DEVELOPER', policy: ['RELEASE'] });

    expect(sw(RELEASE).checked).toBe(true);
    expect(sw(RELEASE).disabled).toBe(true);
    expect(sw(INCREMENTAL).disabled).toBe(true);
    expect(screen.getByText('Only project admins can change this.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(api.publishPolicyImpact).not.toHaveBeenCalled();
  });

  it('shows the errors of a rejected save, one per broken rule', async () => {
    const { api } = await setup();
    api.updatePublishPolicy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              type: 'https://cms.example.com/problems/sf-api-0400',
              title: 'Bad Request',
              status: 400,
              detail: 'The publish policy is invalid.',
              code: 'SF-API-0400',
              errors: ['FULL_BUILD requires INCREMENTAL_BUILD: editors who start full builds must be allowed to start incremental ones.'],
            },
          }),
      ),
    );

    fireEvent.click(sw(INCREMENTAL));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('FULL_BUILD requires INCREMENTAL_BUILD');
    // The edit is kept, to be fixed and saved again.
    expect(sw(INCREMENTAL).checked).toBe(true);
  });
});
