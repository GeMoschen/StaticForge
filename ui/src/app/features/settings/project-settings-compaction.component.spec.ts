import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { projectDetail } from '../../core/project/testing/project-detail.fixture';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ProjectSettingsCompactionComponent } from './project-settings-compaction.component';

type CompactionPolicyView = components['schemas']['CompactionPolicyView'];
type CompactionEstimateView = components['schemas']['CompactionEstimateView'];

/** `GET /projects/{key}/compaction` for a project that never enabled compaction (`CompactionController`). */
const OFF: CompactionPolicyView = {
  enabled: false,
  olderThanDays: 90,
  enabledAt: undefined,
  enabledBy: undefined,
  compactedThrough: undefined,
  lastRun: undefined,
};

/** The same for an enabled policy with one finished job run on the project. */
const ON: CompactionPolicyView = {
  enabled: true,
  olderThanDays: 60,
  enabledAt: '2026-08-01T09:00:00Z',
  enabledBy: 1,
  compactedThrough: 412,
  lastRun: {
    runId: 77,
    finishedAt: '2026-09-20T03:00:05Z',
    dryRun: false,
    outcome: 'SUCCEEDED',
    cutoff: '2026-07-22T03:00:00Z',
    error: undefined,
    versionsInWindow: 1200,
    assetsTouched: 40,
    versionsRemoved: 314,
    referencesRewritten: 25,
    revisionsMarked: 90,
    bytesFreed: 2 * 1024 * 1024,
  },
};

/** `GET …/compaction/estimate?olderThanDays=N` (`CompactionEstimateView`). */
const ESTIMATE: CompactionEstimateView = {
  olderThanDays: 90,
  cutoff: '2026-06-29T10:00:00Z',
  versionsInWindow: 500,
  versionsRemoved: 123,
  assetsTouched: 17,
  referencesRewritten: 4,
  revisionsMarked: 30,
  bytesFreed: 1536,
};

interface Options {
  role?: string;
  memberRole?: string;
  readOnly?: boolean;
  policy?: CompactionPolicyView;
  compactedThrough?: number;
  estimate?: CompactionEstimateView;
}

async function setup(options: Options = {}) {
  const api = {
    compactionPolicy: vi.fn().mockReturnValue(of(options.policy ?? OFF)),
    compactionEstimate: vi.fn().mockReturnValue(of(options.estimate ?? ESTIMATE)),
    updateCompactionPolicy: vi.fn((_key: string, body: { enabled?: boolean; olderThanDays?: number }) =>
      of<CompactionPolicyView>({ ...(options.policy ?? OFF), enabled: body.enabled, olderThanDays: body.olderThanDays ?? 90 }),
    ),
  };
  const project = { ...projectDetail([]), compactedThrough: options.compactedThrough };
  const role = options.role ?? 'PROJECT_ADMIN';
  await render(ProjectSettingsCompactionComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ProjectContextStore, useValue: { project: signal(project) } },
      provideProjectPermissions({
        role: () => role,
        memberRole: () => options.memberRole ?? role,
        readOnly: () => options.readOnly ?? false,
      }),
    ],
  });
  await screen.findByRole('heading', { name: 'Revision compaction' });
  if ((options.memberRole ?? role) === 'PROJECT_ADMIN') {
    // The policy renders after the load effect has run.
    await screen.findByTestId('compaction-status');
  }
  return { api };
}

function daysInput(): HTMLInputElement {
  return screen.getByRole('spinbutton') as HTMLInputElement;
}

async function openEnableDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Enable compaction…' }));
  return screen.findByRole('dialog', { name: 'Enable compaction?' });
}

describe('ProjectSettingsCompactionComponent', () => {
  describe('gating', () => {
    it('a project admin sees the policy, can edit the age and enable it', async () => {
      const { api } = await setup();

      expect(api.compactionPolicy).toHaveBeenCalledWith('proj');
      expect((await screen.findByTestId('compaction-status')).textContent).toContain('Off');
      expect(daysInput().disabled).toBe(false);
      expect(daysInput().value).toBe('90');
      expect(screen.getByRole('button', { name: 'Enable compaction…' })).toBeTruthy();
    });

    it('an editor sees the explanation and how far history is compacted, but not the policy', async () => {
      const { api } = await setup({ role: 'EDITOR', compactedThrough: 250 });

      expect(api.compactionPolicy).not.toHaveBeenCalled();
      expect(screen.getByText(/the state of each page, record and file at the end of every day/)).toBeTruthy();
      expect(screen.getByText(/revision 250/)).toBeTruthy();
      expect(screen.getByText('Only project admins can see and change this setting.')).toBeTruthy();
      expect(screen.queryByRole('spinbutton')).toBeNull();
      expect(screen.queryByRole('button', { name: /Enable compaction/ })).toBeNull();
    });

    it('in an archived project a project admin reads the policy but can change nothing', async () => {
      // Archiving lowers the effective role to VIEWER; the membership still lets the admin read the policy.
      const { api } = await setup({ role: 'VIEWER', memberRole: 'PROJECT_ADMIN', readOnly: true, policy: ON });

      expect(api.compactionPolicy).toHaveBeenCalledWith('proj');
      expect((await screen.findByTestId('compaction-status')).textContent).toContain('On — older than 60 days');
      expect(daysInput().disabled).toBe(true);
      expect(screen.queryByRole('button', { name: 'Disable compaction' })).toBeNull();
      expect(screen.getByText(/Read-only while the project is archived/)).toBeTruthy();
    });

    it('in time travel a project admin gets the same read-only card', async () => {
      await setup({ readOnly: true });

      expect(daysInput().disabled).toBe(true);
      expect(screen.queryByRole('button', { name: /Enable compaction/ })).toBeNull();
    });
  });

  it('shows compactedThrough and the last compaction result', async () => {
    await setup({ policy: ON });

    expect(await screen.findByText(/revision 412/)).toBeTruthy();
    const lastRun = screen.getByTestId('compaction-last-run').textContent ?? '';
    // The outcome in words, as on the Jobs page, not the API's enum.
    expect(lastRun).toContain('Succeeded');
    expect(lastRun).not.toContain('SUCCEEDED');
    expect(lastRun).toContain('314 versions removed');
    expect(lastRun).toContain('2 MB freed');
  });

  it('says "1 version" and "1 asset" for single counts', async () => {
    const one = { ...ON.lastRun!, versionsRemoved: 1 };
    await setup({ policy: { ...OFF, lastRun: one }, estimate: { ...ESTIMATE, versionsRemoved: 1, assetsTouched: 1 } });

    expect(screen.getByTestId('compaction-last-run').textContent).toContain('1 version removed,');
    await openEnableDialog();
    const estimate = (await screen.findByTestId('compaction-estimate')).textContent ?? '';
    expect(estimate).toContain('1 version removed');
    expect(estimate).toMatch(/in 1 asset\s+—/);
  });

  describe('older than', () => {
    it('shows the 30-day rule as a hint and refuses less before anything is sent', async () => {
      const { api } = await setup();

      expect(screen.getByText(/At least 30 days/)).toBeTruthy();
      fireEvent.input(daysInput(), { target: { value: '29' } });

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByText('Enter a whole number of days, at least 30.')).toBeTruthy();
      const enable = screen.getByRole('button', { name: 'Enable compaction…' }) as HTMLButtonElement;
      expect(enable.disabled).toBe(true);
      fireEvent.click(enable);
      expect(api.compactionEstimate).not.toHaveBeenCalled();

      fireEvent.input(daysInput(), { target: { value: '30' } });
      await waitFor(() => expect(enable.disabled).toBe(false));
    });

    it('while enabled, raising the age saves at once without a confirmation', async () => {
      const { api } = await setup({ policy: ON });

      fireEvent.input(daysInput(), { target: { value: '120' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

      expect(api.updateCompactionPolicy).toHaveBeenCalledWith('proj', { enabled: true, olderThanDays: 120 }, undefined);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('while enabled, lowering the age asks for the project key first', async () => {
      const { api } = await setup({ policy: ON });

      fireEvent.input(daysInput(), { target: { value: '45' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

      const dialog = await screen.findByRole('dialog', { name: 'Compact more history?' });
      expect(api.compactionEstimate).toHaveBeenCalledWith('proj', 45);
      expect(api.updateCompactionPolicy).not.toHaveBeenCalled();
      fireEvent.input(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'proj' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Compact more history' }));
      expect(api.updateCompactionPolicy).toHaveBeenCalledWith('proj', { enabled: true, olderThanDays: 45 }, 'proj');
    });
  });

  describe('enable dialog', () => {
    it('shows the estimate for the entered age', async () => {
      const { api } = await setup();

      fireEvent.input(daysInput(), { target: { value: '90' } });
      await openEnableDialog();

      expect(api.compactionEstimate).toHaveBeenCalledWith('proj', 90);
      const estimate = (await screen.findByTestId('compaction-estimate')).textContent ?? '';
      expect(estimate).toContain('123 versions removed');
      expect(estimate).toContain('of 500');
      expect(estimate).toContain('1.5 KB');
    });

    it('enables Save only with the exact project key, and saves with ?confirm=', async () => {
      const { api } = await setup();
      const dialog = await openEnableDialog();
      const confirmInput = dialog.querySelector('input') as HTMLInputElement;
      const save = screen.getByRole('button', { name: 'Enable compaction' }) as HTMLButtonElement;

      expect(save.disabled).toBe(true);
      for (const wrong of ['pro', 'PROJ', 'proj ', ' proj']) {
        fireEvent.input(confirmInput, { target: { value: wrong } });
        await waitFor(() => expect(save.disabled).toBe(true));
      }
      fireEvent.click(save);
      expect(api.updateCompactionPolicy).not.toHaveBeenCalled();

      fireEvent.input(confirmInput, { target: { value: 'proj' } });
      await waitFor(() => expect(save.disabled).toBe(false));
      fireEvent.click(save);

      expect(api.updateCompactionPolicy).toHaveBeenCalledWith('proj', { enabled: true, olderThanDays: 90 }, 'proj');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByTestId('compaction-status').textContent).toContain('On — older than 90 days');
    });

    it('shows the server refusal inside the dialog', async () => {
      const { api } = await setup();
      api.updateCompactionPolicy.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 422,
              error: { code: 'SF-DOM-0182', detail: 'Type the project key to confirm compaction.' },
            }),
        ),
      );
      const dialog = await openEnableDialog();
      fireEvent.input(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'proj' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Enable compaction' }));

      expect(await screen.findByText('Type the project key to confirm compaction.')).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  it('disabling is one click with no typing', async () => {
    const { api } = await setup({ policy: ON });

    fireEvent.click(await screen.findByRole('button', { name: 'Disable compaction' }));

    expect(api.updateCompactionPolicy).toHaveBeenCalledWith('proj', { enabled: false }, undefined);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('compaction-status').textContent).toContain('Off'));
  });
});
