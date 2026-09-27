import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ToastService } from '../../core/ui/toast.service';
import { AdminJobsComponent } from './admin-jobs.component';
import { JOB_LIST_REFRESH_MS } from './admin-jobs.util';
import { blobSweep, orphanedJob, runRecovery } from './testing/admin-jobs.fixture';

async function setup(jobs = [blobSweep, runRecovery, orphanedJob], refreshMs = 60_000) {
  const api = {
    adminJobs: vi.fn().mockReturnValue(of(jobs)),
    adminUpdateJob: vi.fn(),
  };
  const view = await render(AdminJobsComponent, {
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: JOB_LIST_REFRESH_MS, useValue: refreshMs },
    ],
  });
  await screen.findByRole('link', { name: 'Blob sweep' });
  return { api, view };
}

function row(key: string): HTMLElement {
  return document.querySelector(`tr[data-job="${key}"]`) as HTMLElement;
}

describe('AdminJobsComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists each job with its schedule in words, the raw cron as tooltip, next and last run', async () => {
    await setup();
    const sweep = within(row('blob-sweep'));

    expect(sweep.getByRole('link', { name: 'Blob sweep' }).getAttribute('href')).toBe('/admin/jobs/blob-sweep');
    expect(sweep.getByText('Removes stored bytes no version references any more.')).toBeTruthy();
    const schedule = sweep.getByText('Every day at 03:30 (UTC)');
    expect(schedule.getAttribute('title')).toBe('Cron: 30 3 * * *');
    expect((sweep.getByRole('switch', { name: 'Enable Blob sweep' }) as HTMLInputElement).checked).toBe(true);
    // Last run: outcome, duration, affected and bytes freed.
    expect(sweep.getByText('Succeeded')).toBeTruthy();
    expect(row('blob-sweep').textContent).toMatch(/2 s · 3 affected\s+· 4\.2 MB freed/);
    expect(sweep.getByText('Idle')).toBeTruthy();

    expect(within(row('generation-run-recovery')).getByText('Every 5 minutes (UTC)')).toBeTruthy();
    expect(within(row('generation-run-recovery')).getByText('Never run')).toBeTruthy();
  });

  it('shows a running job with its progress', async () => {
    await setup();
    const status = within(row('generation-run-recovery')).getByRole('status');
    expect(status).toHaveTextContent('Running: Checking 2 runs');
  });

  it('shows an orphaned job greyed, with a note, and read-only', async () => {
    await setup();
    const orphan = row('legacy-cleanup');

    expect(orphan.classList).toContain('row--muted');
    expect(within(orphan).getByText('No longer installed')).toBeTruthy();
    expect(within(orphan).getByText(/kept for its run history, it can't be changed or run/)).toBeTruthy();
    expect((within(orphan).getByRole('switch') as HTMLInputElement).disabled).toBe(true);
    expect(within(orphan).getByText('Disabled')).toBeTruthy();
  });

  it('switches a job off with the version it was read at', async () => {
    const { api } = await setup();
    api.adminUpdateJob.mockReturnValue(of({ ...blobSweep, enabled: false, version: 4 }));

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Blob sweep' }));

    expect(api.adminUpdateJob).toHaveBeenCalledWith('blob-sweep', 3, { enabled: false });
    await waitFor(() => expect(within(row('blob-sweep')).getByText('Disabled')).toBeTruthy());
  });

  it('puts the switch back and reloads when the job changed meanwhile', async () => {
    const { api, view } = await setup();
    const toast = vi.spyOn(view.fixture.debugElement.injector.get(ToastService), 'show');
    api.adminUpdateJob.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'SF-API-0409', detail: 'stale' } })),
    );
    const toggle = screen.getByRole('switch', { name: 'Enable Blob sweep' }) as HTMLInputElement;

    fireEvent.click(toggle);

    expect(toggle.checked).toBe(true);
    expect(toast).toHaveBeenCalledWith('The job was changed in the meantime; the list was reloaded.', 'error');
    expect(api.adminJobs).toHaveBeenCalledTimes(2);
  });

  it('re-reads the list while a job runs, and stops once none does', async () => {
    const { api } = await setup([blobSweep, runRecovery], 1);
    api.adminJobs.mockReturnValue(of([blobSweep, { ...runRecovery, running: false }]));

    await waitFor(() => expect(within(row('generation-run-recovery')).getByText('Idle')).toBeTruthy());
    const calls = api.adminJobs.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.adminJobs.mock.calls.length).toBe(calls);
  });
});
