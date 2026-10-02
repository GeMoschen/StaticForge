import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { ToastService } from '../../core/ui/toast.service';
import { AdminJobDetailComponent } from './admin-job-detail.component';
import { JOB_RUN_POLL_MS } from './admin-jobs.util';
import { blobSweep, finishedRun, json, orphanedJob, runRecovery, startedRun } from './testing/admin-jobs.fixture';

type AdminJobView = components['schemas']['AdminJobView'];
type AdminJobRunPage = components['schemas']['AdminJobRunPage'];

const history: AdminJobRunPage = {
  content: [
    {
      id: 40,
      jobKey: 'blob-sweep',
      trigger: 'SCHEDULE',
      dryRun: false,
      startedAt: '2026-09-27T03:30:00Z',
      finishedAt: '2026-09-27T03:30:02Z',
      durationMs: 2150,
      outcome: 'SUCCEEDED',
      itemsExamined: 1200,
      itemsAffected: 3,
      bytesFreed: 4_404_019,
      message: 'Examined 1200, affected 3, freed 4.2 MB.',
      sample: json([]),
      sampleTotal: 0,
    },
    {
      id: 39,
      jobKey: 'blob-sweep',
      trigger: 'MANUAL',
      dryRun: true,
      startedAt: '2026-09-26T10:00:00Z',
      finishedAt: '2026-09-26T10:00:01Z',
      durationMs: 900,
      outcome: 'PARTIAL',
      itemsExamined: 1100,
      itemsAffected: 0,
      bytesFreed: 0,
      startedBy: { id: 1, username: 'root' },
      sample: json([]),
      sampleTotal: 0,
    },
  ],
  page: { size: 20, number: 0, totalElements: 2, totalPages: 1 },
};

async function setup(job: AdminJobView = blobSweep, runs: AdminJobRunPage = history) {
  const api = {
    adminJob: vi.fn().mockReturnValue(of(job)),
    adminJobRuns: vi.fn().mockReturnValue(of(runs)),
    adminJobRun: vi.fn().mockReturnValue(of(finishedRun(false))),
    adminUpdateJob: vi.fn(),
    adminResetJob: vi.fn(),
    adminRunJob: vi.fn(),
  };
  const view = await render(AdminJobDetailComponent, {
    componentInputs: { key: job.key! },
    providers: [
      provideTranslocoTesting(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: JOB_RUN_POLL_MS, useValue: 0 },
    ],
  });
  await screen.findByRole('heading', { level: 1, name: job.name ?? job.key });
  return { api, view };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;

describe('AdminJobDetailComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has one h1 with the job, the schedule form and the job settings as typed fields', async () => {
    await setup();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(field(/Schedule \(cron expression\)/).value).toBe('30 3 * * *');
    expect(screen.getByText('Every day at 03:30 (UTC)')).toBeTruthy();
    expect(field('Grace').value).toBe('PT24H');
    expect(screen.getByText('= 1 d')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Delete orphan bytes' }).getAttribute('aria-checked')).toBe('true');
  });

  it('enables Save only for a valid change, sends only what changed and says when it saved', async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(of({ ...blobSweep, version: 4, settings: json({ grace: 'PT48H', batchSize: 500, deleteOrphanBytes: true }) }));
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');

    expect(button('Save').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(true);

    fireEvent.input(field('Grace'), { target: { value: 'two days' } });
    expect(button('Save').disabled).toBe(false); // dirty; the form refuses it with its problems
    expect(await screen.findByText('Enter a duration such as PT24H, PT30M or 30m.')).toBeTruthy();

    fireEvent.input(field('Grace'), { target: { value: 'PT48H' } });
    fireEvent.click(button('Save'));

    await waitFor(() => expect(api.adminUpdateJob).toHaveBeenCalled());
    expect(api.adminUpdateJob).toHaveBeenCalledWith('blob-sweep', 3, { settings: { grace: 'PT48H' } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('saved'), 'success'));
    expect(button('Save').disabled).toBe(true);
  });

  it('does not call the server for an invalid cron and shows the problem under the field', async () => {
    const { api } = await setup();
    fireEvent.input(field(/Schedule \(cron expression\)/), { target: { value: '30 3 * *' } });
    fireEvent.click(button('Save'));
    expect(api.adminUpdateJob).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/five fields|cron/i);
  });

  it('discards edits back to the saved job', async () => {
    await setup();
    fireEvent.input(field('Grace'), { target: { value: 'PT48H' } });
    fireEvent.click(button('Discard'));
    expect(field('Grace').value).toBe('PT24H');
    expect(button('Save').disabled).toBe(true);
  });

  it('registers as an editor of the frame while it has unsaved changes', async () => {
    await setup();
    const editors = TestBed.inject(ActiveEditorService);
    expect(editors.hasUnsaved()).toBe(false);
    fireEvent.input(field('Grace'), { target: { value: 'PT48H' } });
    await waitFor(() => expect(editors.hasUnsaved()).toBe(true));
    fireEvent.click(button('Discard'));
    await waitFor(() => expect(editors.hasUnsaved()).toBe(false));
  });

  it("shows the server's validation messages under the fields they name", async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 422, error: { code: 'SF-API-0422', detail: 'invalid', errors: ['cron: five fields, please'] } })),
    );
    fireEvent.input(field('Grace'), { target: { value: 'PT48H' } });
    fireEvent.click(button('Save'));
    await waitFor(() => expect(api.adminUpdateJob).toHaveBeenCalled());
    expect(await screen.findByText(/five fields, please/)).toBeTruthy();
  });

  it('reloads on an If-Match conflict and says so', async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-API-0409', detail: 'stale' } })));
    api.adminJob.mockReturnValue(of({ ...blobSweep, version: 9, cron: '0 4 * * *' }));
    fireEvent.input(field('Grace'), { target: { value: 'PT48H' } });
    fireEvent.click(button('Save'));

    expect(await screen.findByText(/Someone else changed this job/)).toBeTruthy();
    await waitFor(() => expect(field(/Schedule \(cron expression\)/).value).toBe('0 4 * * *'));
  });

  it('resets to the defaults only after confirming', async () => {
    const { api } = await setup();
    api.adminResetJob.mockReturnValue(of(blobSweep));

    fireEvent.click(button('More actions'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Reset to defaults/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset Blob sweep?' });
    expect(api.adminResetJob).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => expect(api.adminResetJob).toHaveBeenCalledWith('blob-sweep'));
  });

  it('polls a dry run until it has finished and shows its report', async () => {
    const { api } = await setup();
    api.adminRunJob.mockReturnValue(of(startedRun(true)));
    api.adminJobRun.mockReturnValue(of({ ...finishedRun(true), outcome: 'SUCCEEDED' }));

    fireEvent.click(button('Dry run'));

    expect(api.adminRunJob).toHaveBeenCalledWith('blob-sweep', true);
    expect(await screen.findByText(/Dry run — nothing was changed/)).toBeTruthy();
    expect(screen.getByText('Would affect')).toBeTruthy();
  });

  it('hides Dry run for a job without one', async () => {
    await setup(runRecovery);
    expect(screen.queryByRole('button', { name: 'Dry run' })).toBeNull();
    // It is running, so Run now is off as well.
    expect(button('Run now').disabled).toBe(true);
  });

  it('opens an orphaned job read-only, with the note and no run or save buttons', async () => {
    await setup(orphanedJob);
    expect(screen.getByText(/code is gone/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((field(/Schedule \(cron expression\)/) as HTMLInputElement).disabled).toBe(true);
  });

  it('lists the history with human outcomes and trigger, and opens a run’s report in a dialog', async () => {
    await setup();
    const grid = await screen.findByRole('grid', { name: 'Runs of this job' });
    expect(within(grid).getByText('Succeeded')).toBeTruthy();
    expect(within(grid).getByText('Partial')).toBeTruthy();
    expect(within(grid).getByText('Scheduled')).toBeTruthy();
    expect(within(grid).getByText('Manual')).toBeTruthy();
    expect(within(grid).getByText('root')).toBeTruthy();
    expect(within(grid).getAllByText('Dry run').length).toBeGreaterThan(0);

    fireEvent.click(within(grid).getByText('Scheduled'));
    const dialog = await screen.findByRole('dialog', { name: 'Run report' });
    expect(within(dialog).getByText(/Examined 1200/)).toBeTruthy();
  });

  it('pages the history on the server', async () => {
    const many: AdminJobRunPage = { ...history, page: { size: 20, number: 0, totalElements: 45, totalPages: 3 } };
    const { api } = await setup(blobSweep, many);
    expect(api.adminJobRuns).toHaveBeenCalledWith('blob-sweep', 0, 20);
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(api.adminJobRuns).toHaveBeenCalledWith('blob-sweep', 1, 20));
  });
});
