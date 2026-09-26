import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import type { ReleaseChoice } from '../release/release-choice.util';
import { ScheduleDialogComponent } from './schedule-dialog.component';

type ScheduleView = components['schemas']['ScheduleView'];

const BASE = '/api/v1/projects/proj';
const CHOICES: ReleaseChoice[] = [
  { assetUuid: 'page-1', locale: 'en', label: 'English (EN) — Changed', status: 'CHANGED', checked: true },
];

/** Writable view of the dialog's protected form signals. */
interface Form {
  zone: { set(value: string): void };
  date: { set(value: string): void };
  time: { set(value: string): void };
  cronMode: { set(value: 'preset' | 'advanced'): void };
  advancedCron: { set(value: string): void };
}

describe('ScheduleDialogComponent', () => {
  let fixture: ComponentFixture<ScheduleDialogComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T10:00:00Z'));
    TestBed.configureTestingModule({
      imports: [ScheduleDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  function open(types: string[], choices: ReleaseChoice[] = [], schedule: ScheduleView | null = null): Form {
    fixture = TestBed.createComponent(ScheduleDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('types', types);
    fixture.componentRef.setInput('choices', choices);
    fixture.componentRef.setInput('schedule', schedule);
    fixture.detectChanges();
    // The generation options (a child created in the first pass) load targets and channels in their effect.
    fixture.detectChanges();
    for (const request of http.match((r) => r.url.endsWith('/targets') || r.url.endsWith('/channels'))) {
      request.flush([]);
    }
    return fixture.componentInstance as unknown as Form;
  }

  function scheduleButton(): HTMLButtonElement {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Schedule' || b.textContent?.trim() === 'Save',
    )!;
  }

  it('sends a Berlin wall-clock time across the autumn DST switch as the right UTC instant', () => {
    const form = open(['RELEASE', 'UNPUBLISH'], CHOICES);
    form.zone.set('Europe/Berlin');
    form.date.set('2026-10-25');
    form.time.set('03:30');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Europe/Berlin (CET)');

    vi.advanceTimersByTime(300);
    http.expectOne(`${BASE}/releases/plan`).flush({ items: [], dependencies: [], incomplete: [], warnings: [] });
    fixture.detectChanges();
    fixture.detectChanges();

    scheduleButton().click();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === `${BASE}/schedules`);
    expect(request.request.body).toMatchObject({
      type: 'RELEASE',
      runAt: '2026-10-25T02:30:00.000Z',
      pinPolicy: 'PINNED',
      missedPolicy: 'RUN_LATE',
      params: { items: [{ assetUuid: 'page-1', locale: 'en' }], includeDependencies: [] },
    });
    request.flush({ id: 5, type: 'RELEASE', runAt: '2026-10-25T02:30:00Z', status: 'PENDING' } satisfies ScheduleView);
  });

  it('refuses a time in the past before asking the server', () => {
    const form = open(['GENERATION']);
    form.date.set('2026-09-26');
    form.time.set('09:00');
    form.zone.set('UTC');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Pick a time in the future.');
    expect(scheduleButton().disabled).toBe(true);
  });

  it('shows the server’s SF-DOM-0165 message for an invalid cron and blocks saving', () => {
    const form = open(['RECURRING_GENERATION']);
    vi.advanceTimersByTime(500);
    const first = http.expectOne(`${BASE}/schedules/preview-times`);
    expect(first.request.body).toMatchObject({ cron: '0 9 * * *', count: 5 });
    first.flush({ cron: '0 0 9 * * *', zoneId: 'UTC', times: ['2026-09-27T09:00:00Z', '2026-09-28T09:00:00Z'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.sched__preview li').length).toBe(2);

    form.cronMode.set('advanced');
    form.advancedCron.set('61 * * * *');
    fixture.detectChanges();
    vi.advanceTimersByTime(500);
    http
      .expectOne(`${BASE}/schedules/preview-times`)
      .flush(
        { code: 'SF-DOM-0165', detail: "Invalid cron expression '61 * * * *': Minute out of range", status: 422 },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid cron expression '61 * * * *'",
    );
    expect(scheduleButton().disabled).toBe(true);
  });

  it('edits a recurring schedule in its own zone and sends If-Match', () => {
    open(['RECURRING_GENERATION'], [], {
      id: 9,
      type: 'RECURRING_GENERATION',
      status: 'PENDING',
      cron: '0 0 7 * * 1-5',
      zoneId: 'America/New_York',
      missedPolicy: 'RUN_LATE',
      params: { mode: 'INCREMENTAL', targetId: null, channels: [] } as unknown as ScheduleView['params'],
      version: 4,
    });
    expect(fixture.nativeElement.textContent).toContain('America/New_York');
    vi.advanceTimersByTime(500);
    http
      .expectOne(`${BASE}/schedules/preview-times`)
      .flush({ cron: '0 0 7 * * 1-5', zoneId: 'America/New_York', times: ['2026-09-28T11:00:00Z'] });
    fixture.detectChanges();

    scheduleButton().click();
    const request = http.expectOne((r) => r.method === 'PUT' && r.url === `${BASE}/schedules/9`);
    expect(request.request.headers.get('If-Match')).toBe('"v4"');
    expect(request.request.body).toMatchObject({
      type: 'RECURRING_GENERATION',
      cron: '0 7 * * 1-5',
      zoneId: 'America/New_York',
      params: { mode: 'INCREMENTAL', targetId: null },
    });
    request.flush({ id: 9, type: 'RECURRING_GENERATION', status: 'PENDING', nextRunAt: '2026-09-28T11:00:00Z' } satisfies ScheduleView);
  });
});
