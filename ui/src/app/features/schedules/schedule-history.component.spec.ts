import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  let fixture: ComponentFixture<ScheduleHistoryComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ScheduleHistoryComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ScheduleHistoryComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('scheduleId', 5);
    fixture.detectChanges();
    fixture.detectChanges();
    http.expectOne(`${BASE}/schedules/5`).flush(SCHEDULE);
    http.expectOne((r) => r.url === `${BASE}/schedules/5/executions`).flush(EXECUTIONS);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('links a run that still exists and shows a deleted run as "run deleted" without a link', () => {
    const links = Array.from(fixture.nativeElement.querySelectorAll('.history__links a') as NodeListOf<HTMLAnchorElement>)
      .map((a) => a.textContent?.trim());
    expect(links).toContain('Generation run #41');
    expect(links.some((text) => text?.includes('#12'))).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Generation run #12 (run deleted)');
  });
});
