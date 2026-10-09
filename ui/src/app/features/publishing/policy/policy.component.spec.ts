import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import type { components } from '../../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../../core/project/project-access.store';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { PublishingPolicyComponent } from './policy.component';
import { togglePolicy } from './policy.util';

type PublishPolicyView = components['schemas']['PublishPolicyView'];
type PublishPolicyImpactView = components['schemas']['PublishPolicyImpactView'];

/** `POST .../publish-policy/impact` as the API answers it: one editor's schedule would fail. */
const FAILING: PublishPolicyImpactView = {
  failingSchedules: [
    {
      id: 41,
      type: 'RELEASE',
      runAt: '2026-10-01T08:00:00Z',
      ownerUserId: 7,
      ownerName: 'Ed Itor',
      missingPermission: 'SCHEDULE_RELEASE',
      itemName: 'Spring harvest arrives',
      itemCount: 3,
    },
    { id: 42, type: 'GENERATION', runAt: '2026-10-02T08:00:00Z', ownerUserId: 7, ownerName: 'Ed Itor', missingPermission: 'FULL_BUILD', itemName: null, itemCount: 0 },
  ],
};

interface Setup {
  role?: string;
  policy?: string[];
  impact?: PublishPolicyImpactView;
  readOnlyLabel?: string | null;
}

async function setup({ role = 'PROJECT_ADMIN', policy = [], impact = { failingSchedules: [] }, readOnlyLabel = null }: Setup = {}) {
  const api = {
    publishPolicy: vi.fn().mockReturnValue(of<PublishPolicyView>({ editor: policy })),
    updatePublishPolicy: vi.fn((_key: string, body: PublishPolicyView) => of<PublishPolicyView>(body)),
    publishPolicyImpact: vi.fn().mockReturnValue(of<PublishPolicyImpactView>(impact)),
  };
  const context = { refreshDetail: vi.fn() };
  const access = { readOnly: signal(readOnlyLabel !== null), readOnlyLabel: signal(readOnlyLabel) };
  await render(PublishingPolicyComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: context },
      { provide: ProjectAccessStore, useValue: access },
      provideProjectPermissions({ role: () => role }),
    ],
  });
  await screen.findByRole('switch', { name: RELEASE });
  return { api, context };
}

const sw = (name: RegExp) => screen.getByRole('switch', { name });
const isOn = (name: RegExp) => sw(name).getAttribute('aria-checked') === 'true';
const save = () => screen.getByRole('button', { name: 'Save' });

const RELEASE = /^Release, discard and unpublish/;
const SCHEDULE = /^Schedule releases/;
const INCREMENTAL = /^Incremental builds/;
const FULL = /^Full builds/;

describe('togglePolicy', () => {
  it('switching a permission off switches off what needs it, and keeps the server order', () => {
    expect(togglePolicy(['FULL_BUILD', 'RELEASE'], 'INCREMENTAL_BUILD', true)).toEqual(['RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD']);
    expect(togglePolicy(['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'], 'RELEASE', false)).toEqual(['INCREMENTAL_BUILD']);
    expect(togglePolicy(['INCREMENTAL_BUILD', 'FULL_BUILD'], 'INCREMENTAL_BUILD', false)).toEqual([]);
  });
});

describe('PublishingPolicyComponent', () => {
  it('shows the stored policy; a dependent switch is disabled until what it needs is on', async () => {
    await setup({ policy: ['INCREMENTAL_BUILD'] });

    expect(isOn(RELEASE)).toBe(false);
    expect(sw(SCHEDULE)).toBeDisabled();
    expect(screen.getByText('Needs “Release, discard and unpublish”')).toBeInTheDocument();
    expect(isOn(INCREMENTAL)).toBe(true);
    expect(sw(FULL)).toBeEnabled();
    expect(screen.getByText('Developers and admins can always do all of this.')).toBeInTheDocument();

    fireEvent.click(sw(RELEASE));
    await waitFor(() => expect(sw(SCHEDULE)).toBeEnabled());
  });

  it('Save and Discard are enabled only with a change; switching Release off also switches Schedule off', async () => {
    const { api, context } = await setup({ policy: ['RELEASE', 'SCHEDULE_RELEASE'] });
    expect(save()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();

    fireEvent.click(sw(RELEASE));
    await waitFor(() => expect(isOn(SCHEDULE)).toBe(false));
    expect(save()).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Back to the stored state: nothing to save.
    fireEvent.click(sw(RELEASE));
    fireEvent.click(sw(SCHEDULE));
    await waitFor(() => expect(save()).toBeDisabled());

    fireEvent.click(sw(INCREMENTAL));
    await waitFor(() => expect(save()).toBeEnabled());
    fireEvent.click(save());

    const saved = { editor: ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'] };
    await waitFor(() => expect(api.updatePublishPolicy).toHaveBeenCalledWith('proj', saved));
    expect(api.publishPolicyImpact).toHaveBeenCalledWith('proj', saved);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(context.refreshDetail).toHaveBeenCalled();
    await waitFor(() => expect(save()).toBeDisabled());
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('Discard goes back to the saved policy', async () => {
    await setup({ policy: ['RELEASE'] });

    fireEvent.click(sw(INCREMENTAL));
    await waitFor(() => expect(isOn(INCREMENTAL)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(isOn(INCREMENTAL)).toBe(false));
    expect(save()).toBeDisabled();
  });

  it('lists the schedules a change would make fail and saves only when confirmed', async () => {
    const { api } = await setup({ policy: ['RELEASE', 'SCHEDULE_RELEASE'], impact: FAILING });

    fireEvent.click(sw(RELEASE));
    fireEvent.click(save());

    const dialog = await screen.findByRole('dialog', { name: 'These schedules would fail' });
    expect(dialog.textContent).toContain('Ed Itor');
    expect(dialog.textContent).toContain('Release');
    expect(dialog.textContent).toContain('Schedule releases and unpublishing');
    expect(dialog.textContent).toContain('Spring harvest arrives');
    expect(dialog.textContent).toContain('+2 more');
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
    expect(api.updatePublishPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updatePublishPolicy).not.toHaveBeenCalled();

    fireEvent.click(save());
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(api.updatePublishPolicy).toHaveBeenCalledWith('proj', { editor: [] }));
  });

  it('is read-only below project admin, and says so', async () => {
    const { api } = await setup({ role: 'DEVELOPER', policy: ['RELEASE'] });

    expect(isOn(RELEASE)).toBe(true);
    expect(sw(RELEASE)).toBeDisabled();
    expect(sw(INCREMENTAL)).toBeDisabled();
    expect(screen.getByText('Only project admins can change this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(api.publishPolicyImpact).not.toHaveBeenCalled();
  });

  it('names the read-only state of the project instead of the admin note', async () => {
    await setup({ readOnlyLabel: 'This project is archived.', policy: ['RELEASE'] });

    expect(screen.getByText('This project is archived.')).toBeInTheDocument();
    expect(screen.queryByText('Only project admins can change this.')).toBeNull();
  });

  it('shows the errors of a rejected save and keeps the edit', async () => {
    const { api } = await setup();
    api.updatePublishPolicy.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              detail: 'The publish policy is invalid.',
              code: 'SF-API-0400',
              errors: ['FULL_BUILD requires INCREMENTAL_BUILD.'],
            },
          }),
      ),
    );

    fireEvent.click(sw(INCREMENTAL));
    fireEvent.click(save());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('FULL_BUILD requires INCREMENTAL_BUILD.');
    expect(isOn(INCREMENTAL)).toBe(true);
  });
});
