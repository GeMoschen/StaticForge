import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
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
      sample: json(['3f9a…', '77c1…', 'e02b…']),
      sampleTotal: 3,
    },
    {
      id: 39,
      jobKey: 'blob-sweep',
      trigger: 'MANUAL',
      dryRun: true,
      startedAt: '2026-09-26T10:00:00Z',
      finishedAt: '2026-09-26T10:00:01Z',
      durationMs: 900,
      outcome: 'SUCCEEDED',
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
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: JOB_RUN_POLL_MS, useValue: 0 },
    ],
  });
  await screen.findByRole('heading', { name: job.name ?? job.key });
  return { api, view };
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

function setting(key: string): HTMLInputElement {
  return document.querySelector(`input[data-setting="${key}"]`) as HTMLInputElement;
}

function errorsOf(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

describe('AdminJobDetailComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the schedule and the job settings as typed fields', async () => {
    await setup();

    expect((screen.getByLabelText(/Schedule \(cron\)/) as HTMLInputElement).value).toBe('30 3 * * *');
    expect(screen.getByText('Every day at 03:30 (UTC)')).toBeTruthy();
    expect((screen.getByLabelText('Time zone of the schedule') as HTMLSelectElement).value).toBe('UTC');
    expect(setting('grace').value).toBe('PT24H');
    expect(setting('grace').type).toBe('text');
    expect(setting('batchSize').type).toBe('number');
    expect((screen.getByRole('checkbox', { name: /Delete orphan bytes/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('= 1 d')).toBeTruthy();
  });

  it('enables Save only for a valid change and sends only what changed', async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(of({ ...blobSweep, version: 4, settings: json({ grace: 'PT48H', batchSize: 500, deleteOrphanBytes: true }) }));

    expect(button('Save').disabled).toBe(true);
    expect(button('Discard').disabled).toBe(true);

    fireEvent.input(setting('grace'), { target: { value: 'two days' } });
    expect(button('Save').disabled).toBe(true);
    expect(errorsOf('job-setting-grace-errors')).toHaveTextContent('Enter a duration such as PT24H, PT30M or 30m.');

    fireEvent.input(setting('grace'), { target: { value: 'PT24H' } });
    expect(button('Save').disabled).toBe(true);

    fireEvent.input(setting('grace'), { target: { value: 'PT48H' } });
    expect(button('Save').disabled).toBe(false);

    fireEvent.input(screen.getByLabelText(/Schedule \(cron\)/), { target: { value: '30 3 * *' } });
    expect(button('Save').disabled).toBe(true);
    expect(errorsOf('job-cron-errors')).toHaveTextContent('5 fields');
    fireEvent.input(screen.getByLabelText(/Schedule \(cron\)/), { target: { value: '30 3 * * *' } });

    fireEvent.click(button('Save'));
    expect(api.adminUpdateJob).toHaveBeenCalledWith('blob-sweep', 3, { settings: { grace: 'PT48H' } });
    await waitFor(() => expect(button('Save').disabled).toBe(true));
  });

  it('discards edits back to the saved job', async () => {
    await setup();
    fireEvent.input(setting('batchSize'), { target: { value: '800' } });
    expect(button('Discard').disabled).toBe(false);

    fireEvent.click(button('Discard'));

    await waitFor(() => expect(setting('batchSize').value).toBe('500'));
    expect(button('Save').disabled).toBe(true);
  });

  it("shows the server's validation messages under the fields they name", async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              code: 'SF-DOM-0180',
              detail: 'The job settings are invalid.',
              errors: [
                "Setting 'grace' must be at least PT1H.",
                "Invalid cron expression '0 3 * * 8': Day of week out of range",
                'Settings must be a JSON object.',
              ],
            },
          }),
      ),
    );

    fireEvent.input(setting('grace'), { target: { value: 'PT5M' } });
    fireEvent.input(screen.getByLabelText(/Schedule \(cron\)/), { target: { value: '0 3 * * 8' } });
    fireEvent.click(button('Save'));

    await waitFor(() =>
      expect(errorsOf('job-setting-grace-errors')).toHaveTextContent("Setting 'grace' must be at least PT1H."),
    );
    expect(errorsOf('job-cron-errors')).toHaveTextContent('Day of week out of range');
    expect(within(screen.getByRole('list', { name: 'Problems' })).getByText('Settings must be a JSON object.')).toBeTruthy();
    expect(setting('grace').getAttribute('aria-invalid')).toBe('true');

    // Editing the field clears its server message.
    fireEvent.input(setting('grace'), { target: { value: 'PT2H' } });
    expect(errorsOf('job-setting-grace-errors').textContent?.trim()).toBe('');
  });

  it('reloads on an If-Match conflict and says so', async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-API-0409', detail: 'stale' } })),
    );
    api.adminJob.mockReturnValue(of({ ...blobSweep, version: 5, settings: json({ grace: 'PT12H', batchSize: 500, deleteOrphanBytes: true }) }));

    fireEvent.input(setting('grace'), { target: { value: 'PT48H' } });
    fireEvent.click(button('Save'));

    expect(await screen.findByText(/Someone else changed this job in the meantime/)).toBeTruthy();
    expect(api.adminJob).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(setting('grace').value).toBe('PT12H'));
    expect(button('Save').disabled).toBe(true);
  });

  it('resets to the defaults only after confirming', async () => {
    const { api } = await setup();
    api.adminResetJob.mockReturnValue(of({ ...blobSweep, version: 4 }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    fireEvent.click(button('Reset to defaults'));
    expect(api.adminResetJob).not.toHaveBeenCalled();

    fireEvent.click(button('Reset to defaults'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.adminResetJob).toHaveBeenCalledWith('blob-sweep');
  });

  it('polls a dry run until it has finished and shows its report', async () => {
    const { api } = await setup();
    api.adminRunJob.mockReturnValue(of(startedRun(true)));
    api.adminJobRun
      .mockReturnValueOnce(of(startedRun(true)))
      .mockReturnValueOnce(of({ ...startedRun(true), itemsExamined: 600 }))
      .mockReturnValue(of(finishedRun(true)));

    fireEvent.click(button('Dry run'));

    expect(api.adminRunJob).toHaveBeenCalledWith('blob-sweep', true);
    expect(await screen.findByRole('heading', { name: /Dry run finished/ })).toBeTruthy();
    expect(api.adminJobRun).toHaveBeenCalledTimes(3);
    expect(api.adminJobRun).toHaveBeenCalledWith('blob-sweep', 77);

    expect(screen.getByText('Dry run — nothing was changed')).toBeTruthy();
    expect(screen.getByText('Would affect').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Would free').nextElementSibling).toHaveTextContent('2 KB');
    const sample = screen.getByRole('table', { name: /Would remove — showing 2 of 2/ });
    expect(within(sample).getAllByRole('row')).toHaveLength(3);
    expect(within(sample).getByText('ab12')).toBeTruthy();
    // The history is re-read so the new run shows up there too.
    expect(api.adminJobRuns).toHaveBeenCalledTimes(2);
    expect(button('Run now').disabled).toBe(false);
  });

  it('keeps the run buttons disabled while the job runs', async () => {
    const { api } = await setup();
    api.adminRunJob.mockReturnValue(of(startedRun(false)));
    let finish = false;
    api.adminJobRun.mockImplementation(() => of(finish ? finishedRun(false) : startedRun(false)));

    fireEvent.click(button('Run now'));

    expect(await screen.findByText(/Run in progress/)).toBeTruthy();
    expect(button('Run now').disabled).toBe(true);
    expect(button('Dry run').disabled).toBe(true);
    finish = true;
    expect(await screen.findByRole('heading', { name: /^Run finished/ })).toBeTruthy();
  });

  it('stops polling when the page is left', async () => {
    const { api, view } = await setup();
    api.adminRunJob.mockReturnValue(of(startedRun(false)));
    api.adminJobRun.mockImplementation(() => of(startedRun(false)));

    fireEvent.click(button('Run now'));
    await waitFor(() => expect(api.adminJobRun.mock.calls.length).toBeGreaterThan(2));
    view.fixture.destroy();
    const calls = api.adminJobRun.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(api.adminJobRun.mock.calls.length).toBe(calls);
  });

  it('hides Dry run for a job without one, and picks up a run already going', async () => {
    const { api } = await setup(runRecovery);

    expect(screen.queryByRole('button', { name: 'Dry run' })).toBeNull();
    expect(screen.getByText('This job has no dry run.')).toBeTruthy();
    await waitFor(() => expect(api.adminJobRun).toHaveBeenCalledWith('generation-run-recovery', 41));
  });

  it('opens an orphaned job read-only', async () => {
    await setup(orphanedJob);

    expect(screen.getByRole('note')).toHaveTextContent('no longer installed');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect((screen.getByLabelText(/Schedule \(cron\)/) as HTMLInputElement).disabled).toBe(true);
  });

  it('lists the history with trigger, dry run and starter, each row expanding to its report', async () => {
    await setup();
    const scheduled = document.querySelector('tr[data-run="40"]') as HTMLElement;
    const manual = document.querySelector('tr[data-run="39"]') as HTMLElement;

    expect(within(scheduled).getByText('Scheduled')).toBeTruthy();
    expect(within(scheduled).getByText('System')).toBeTruthy();
    expect(within(manual).getByText('Manual')).toBeTruthy();
    expect(within(manual).getByText('Yes')).toBeTruthy();
    expect(within(manual).getByText('root')).toBeTruthy();

    fireEvent.click(within(scheduled).getByRole('button', { name: 'Report' }));

    const sample = await screen.findByRole('table', { name: /Sample — showing 3 of 3/ });
    expect(within(sample).getByText('77c1…')).toBeTruthy();
    expect(within(scheduled).getByRole('button', { name: 'Hide report' })).toBeTruthy();
  });

  it('pages the history on the server', async () => {
    const { api } = await setup(blobSweep, { ...history, page: { size: 20, number: 0, totalElements: 25, totalPages: 2 } });

    expect(screen.getByText('25 runs · page 1 of 2')).toBeTruthy();
    expect(button('Newer').disabled).toBe(true);
    fireEvent.click(button('Older'));

    expect(api.adminJobRuns).toHaveBeenLastCalledWith('blob-sweep', 1, 20);
  });
});
