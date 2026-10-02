import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideTranslocoTesting } from '../../core/i18n/transloco-testing';
import { ToastService } from '../../core/ui/toast.service';
import { AdminJobsComponent } from './admin-jobs.component';
import { JOB_LIST_REFRESH_MS } from './admin-jobs.util';
import { blobSweep, orphanedJob, runRecovery } from './testing/admin-jobs.fixture';

async function setup(jobs = [blobSweep, runRecovery, orphanedJob], refreshMs = 60_000) {
  const api = {
    adminJobs: vi.fn().mockReturnValue(of(jobs)),
    adminUpdateJob: vi.fn(),
    adminRunJob: vi.fn(),
  };
  const view = await render(AdminJobsComponent, {
    providers: [
      provideTranslocoTesting(),
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: JOB_LIST_REFRESH_MS, useValue: refreshMs },
    ],
  });
  await screen.findByText('Blob sweep');
  return { api, view };
}

/** The row of a job, found through its name. */
function row(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('AdminJobsComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has one h1 and lists each job with its description, schedule in words, the cron as tooltip and the last run', async () => {
    await setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const sweep = within(row('Blob sweep'));

    expect(sweep.getByText('Removes stored bytes no version references any more.')).toBeTruthy();
    expect(sweep.getByText('Every day at 03:30 (UTC)').getAttribute('title')).toBe('Cron: 30 3 * * *');
    expect(sweep.getByRole('switch', { name: 'Run Blob sweep on its schedule' }).getAttribute('aria-checked')).toBe('true');
    // The outcome is a human label, never the enum.
    expect(sweep.getByText('Succeeded')).toBeTruthy();
    expect(within(row('Interrupted-run recovery')).getByText('Every 5 minutes (UTC)')).toBeTruthy();
  });

  it('shows a running job with its progress instead of a last run', async () => {
    await setup();
    expect(within(row('Interrupted-run recovery')).getByRole('status')).toHaveTextContent('Running: Checking 2 runs');
  });

  it('shows an orphaned job muted, with the badge and the note, and its switch disabled', async () => {
    await setup();
    const orphan = within(row('legacy-cleanup'));

    expect(orphan.getByText('No longer installed')).toBeTruthy();
    expect(orphan.getByText(/kept for its run history/)).toBeTruthy();
    expect((orphan.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a job on a row click and from the Edit schedule entry of its menu', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fireEvent.click(screen.getByText('Blob sweep'));
    expect(navigate).toHaveBeenLastCalledWith(['/admin/jobs', 'blob-sweep']);

    fireEvent.click(within(row('Blob sweep')).getByRole('button', { name: 'Actions for Blob sweep' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit schedule' }));
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('starts a run from the row menu, but not for a job that is gone', async () => {
    const { api } = await setup();
    api.adminRunJob.mockReturnValue(of({ id: 50 }));
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');

    fireEvent.click(within(row('Blob sweep')).getByRole('button', { name: 'Actions for Blob sweep' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Run now' }));

    expect(api.adminRunJob).toHaveBeenCalledWith('blob-sweep', false);
    expect(toast).toHaveBeenCalledWith('Blob sweep started.', 'success');
  });

  it('switches a job off with the version it was read at', async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(of({ ...blobSweep, enabled: false, version: 4 }));

    fireEvent.click(screen.getByRole('switch', { name: 'Run Blob sweep on its schedule' }));

    expect(api.adminUpdateJob).toHaveBeenCalledWith('blob-sweep', 3, { enabled: false });
    await waitFor(() =>
      expect(within(row('Blob sweep')).getByRole('switch', { name: 'Run Blob sweep on its schedule' }).getAttribute('aria-checked')).toBe('false'),
    );
  });

  it('says so and reloads when the job changed meanwhile', async () => {
    const { api } = await setup();
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    api.adminUpdateJob.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-API-0409', detail: 'stale' } })));

    fireEvent.click(screen.getByRole('switch', { name: 'Run Blob sweep on its schedule' }));

    expect(toast).toHaveBeenCalledWith('The job was changed in the meantime; the list was reloaded.', 'error');
    expect(api.adminJobs).toHaveBeenCalledTimes(2);
  });

  it('re-reads the list while a job runs, and stops once none does', async () => {
    const { api } = await setup([blobSweep, runRecovery], 1);
    api.adminJobs.mockReturnValue(of([blobSweep, { ...runRecovery, running: false }]));

    await waitFor(() => expect(within(row('Interrupted-run recovery')).queryByRole('status')).toBeNull());
    const calls = api.adminJobs.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.adminJobs.mock.calls.length).toBe(calls);
  });

  it('shows an error state with Retry when the jobs cannot be read', async () => {
    const api = { adminJobs: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 }))) };
    await render(AdminJobsComponent, {
      providers: [provideTranslocoTesting(), provideRouter([]), { provide: ApiClient, useValue: api }],
    });
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  });
});
