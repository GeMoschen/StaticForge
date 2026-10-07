import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ScheduleHistoryComponent } from './schedule-history.component';

type ScheduleView = components['schemas']['ScheduleView'];
type ScheduleExecutionPageView = components['schemas']['ScheduleExecutionPageView'];

const BASE = '/api/v1/projects/proj';

const SCHEDULE: ScheduleView = {
  id: 5,
  type: 'GENERATION',
  status: 'PENDING',
  runAt: '2026-09-29T07:00:00Z',
  nextRunAt: '2026-09-29T07:00:00Z',
  missedPolicy: 'RUN_LATE',
  ownerUserId: 2,
  createdBy: 2,
  version: 1,
  params: { mode: 'FULL' } as unknown as ScheduleView['params'],
};

// Two executions as ScheduleController#executions sends them: one still links its run; the other's run was deleted
// by generation-run-retention (M29.3.1), which nulls generationRunId and keeps the id in detail.
const EXECUTIONS: ScheduleExecutionPageView = {
  rows: [
    {
      id: 2,
      scheduledFor: '2026-09-28T07:00:00Z',
      startedAt: '2026-09-28T07:00:01Z',
      finishedAt: '2026-09-28T07:00:01Z',
      outcome: 'SUCCEEDED',
      lateByMs: 1000,
      message: 'Generation run #41 started.',
      generationRunId: 41,
    },
    {
      id: 1,
      scheduledFor: '2026-06-01T07:00:00Z',
      startedAt: '2026-06-01T07:00:01Z',
      finishedAt: '2026-06-01T07:00:01Z',
      outcome: 'SUCCEEDED',
      lateByMs: 1000,
      message: 'Generation run #12 started.',
      detail: { deletedGenerationRunId: 12 } as unknown as Record<string, never>,
    },
  ],
  page: 0,
  size: 50,
  totalElements: 2,
  totalPages: 1,
};

describe('ScheduleHistoryComponent', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  async function open(schedule: ScheduleView = SCHEDULE) {
    const view = await render(ScheduleHistoryComponent, {
      componentInputs: { projectKey: 'proj', scheduleId: 5 },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    return { view, schedule };
  }

  async function flushAll(schedule: ScheduleView = SCHEDULE, executions: ScheduleExecutionPageView = EXECUTIONS) {
    const detail = await waitFor(() => http.expectOne(`${BASE}/schedules/5`));
    detail.flush(schedule);
    http.expectOne((r) => r.url === `${BASE}/schedules/5/executions`).flush(executions);
  }

  it('links a run that still exists and shows a deleted run as "run deleted" without a link', async () => {
    await open();
    await flushAll();
    await screen.findByText('Generation run #41');
    const drawer = screen.getByRole('dialog');
    const links = within(drawer).getAllByRole('link').map((a) => a.textContent?.trim());
    expect(links).toContain('Generation run #41');
    expect(links.some((text) => text?.includes('#12'))).toBe(false);
    expect(drawer.textContent).toContain('Generation run #12 (run deleted)');
  });

  it('titles the drawer with the kind and what the schedule does', async () => {
    await open();
    await flushAll();
    expect(await screen.findByRole('dialog', { name: 'History: Generation “Full build · all channels”' })).toBeInTheDocument();
  });

  it('shows the items by name — a UID only in developer mode, never the UUID', async () => {
    await open();
    await flushAll(
      {
        ...SCHEDULE,
        type: 'RELEASE',
        pinPolicy: 'PINNED',
        params: undefined,
        itemCount: 2,
        items: [
          { assetUuid: '3f1c2a90-6d4e-4c1b-9a57-0e1b7c2d5a11', assetType: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en', draftChangedSinceScheduled: true },
          { assetUuid: '8a2d7f44-1b9c-4e6a-b3d0-5c7e9f1a2b33', assetType: 'MEDIA', uid: 'hero', locale: '' },
        ],
      },
      {
        ...EXECUTIONS,
        rows: [
          {
            ...EXECUTIONS.rows![0],
            detail: { items: [{ assetUuid: '3f1c2a90-6d4e-4c1b-9a57-0e1b7c2d5a11', locale: 'en', result: 'APPLIED' }, { assetUuid: 'unknown-asset-0000', result: 'SKIPPED', reason: 'Gone' }] } as unknown as Record<string, never>,
          },
        ],
      },
    );
    await screen.findAllByText('Home');
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByText(/Home/).length).toBeGreaterThan(1);
    expect(within(drawer).getByText('Draft changed since scheduled')).toBeInTheDocument();
    expect(within(drawer).getByText(/Done/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Untitled/).length).toBeGreaterThan(1);
    expect(drawer.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|unknown-a/);
  });

  it('says what happens on a missed run in words', async () => {
    await open();
    await flushAll({ ...SCHEDULE, missedPolicy: 'SKIP_IF_LATER_THAN', maxLateness: 'PT2H' });
    expect(await screen.findByText('Skip if later than 2 hours')).toBeInTheDocument();
  });

  it('shows an error with a retry that reads the schedule again', async () => {
    await open();
    const detail = await waitFor(() => http.expectOne(`${BASE}/schedules/5`));
    http.expectOne((r) => r.url === `${BASE}/schedules/5/executions`).flush(EXECUTIONS);
    detail.flush({ title: 'Boom', detail: 'The server fell over.' }, { status: 500, statusText: 'Server Error' });
    expect(await screen.findByText('The server fell over.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flushAll();
    expect(await screen.findByText('Generation run #41')).toBeInTheDocument();
  });

  it('closes with the drawer’s close button', async () => {
    const { view } = await open();
    await flushAll();
    let closed = 0;
    view.fixture.componentInstance.closed.subscribe(() => closed++);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(closed).toBe(1);
  });
});
