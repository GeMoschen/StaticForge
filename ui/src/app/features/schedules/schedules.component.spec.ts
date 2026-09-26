import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../../core/project/testing/project-detail.fixture';
import { SchedulesComponent } from './schedules.component';

type SchedulePageView = components['schemas']['SchedulePageView'];

const BASE = '/api/v1/projects/proj';

// A list row as ScheduleController#list sends it: no items (withItems=false), but itemCount and driftCount.
const PAGE: SchedulePageView = {
  rows: [
    {
      id: 12,
      type: 'RELEASE',
      status: 'PENDING',
      runAt: '2026-09-29T07:00:00Z',
      nextRunAt: '2026-09-29T07:00:00Z',
      pinPolicy: 'PINNED',
      missedPolicy: 'RUN_LATE',
      ownerUserId: 2,
      createdBy: 2,
      version: 1,
      itemCount: 3,
      driftCount: 1,
    },
  ],
  page: 0,
  size: 50,
  totalElements: 1,
  totalPages: 1,
};

/** The project's targets as `GET /targets` sends them: 7 is the default. */
const TARGETS = [
  { id: 7, name: 'Live', type: 'FILESYSTEM', isDefault: true, outputPath: 'proj/live' },
  { id: 8, name: 'Staging', type: 'FILESYSTEM', isDefault: false, outputPath: 'proj/staging' },
];

describe('SchedulesComponent', () => {
  let fixture: ComponentFixture<SchedulesComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SchedulesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
    TestBed.inject(ProjectContextStore).project.set(projectDetail(ALL_PUBLISH_PERMISSIONS));
    TestBed.inject(AuthStore).setUser({ id: 1, username: 'me', projectRoles: { proj: 'DEVELOPER' } });
    fixture = TestBed.createComponent(SchedulesComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('status', 'PENDING');
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush([{ userId: 2, username: 'ana', displayName: 'Ana Lopez' }]);
    http.expectOne(`${BASE}/targets`).flush(TARGETS);
    const list = http.expectOne((r) => r.url === `${BASE}/schedules`);
    expect(list.request.params.getAll('status')).toEqual(['PENDING']);
    list.flush(PAGE);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('lists owner, what and the drift warning, and re-pins', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Ana Lopez');
    expect(text).toContain('3 items');
    expect(text).toContain('Draft changed since scheduled');
    expect(fixture.nativeElement.querySelector('.schedules__status')?.textContent?.trim()).toBe('Pending');

    const repin = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Re-pin',
    )!;
    repin.click();
    http.expectOne({ method: 'POST', url: `${BASE}/schedules/12/repin` }).flush({ ...PAGE.rows![0], driftCount: 0 });
    // The action re-reads the list (release events).
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${BASE}/schedules`).flush({ ...PAGE, rows: [{ ...PAGE.rows![0], driftCount: 0 }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Draft changed since scheduled');
  });

  it('drops the drift warning once the schedule has run', () => {
    const row = PAGE.rows![0];
    fixture.componentRef.setInput('status', undefined);
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${BASE}/schedules`).flush({ ...PAGE, rows: [{ ...row, status: 'SUCCEEDED', nextRunAt: undefined }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Draft changed since scheduled');
  });

  it('offers take over for another owner’s pending schedule', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.schedules__action') as NodeListOf<HTMLElement>).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['History', 'Re-pin', 'Edit', 'Run now', 'Take over', 'Cancel']);
  });
});

type ScheduleView = components['schemas']['ScheduleView'];

/** A pending list row as ScheduleController#list sends it. */
function pendingRow(id: number, type: string, ownerUserId: number, thenGenerate?: { targetId: number | null }): ScheduleView {
  return {
    id,
    type,
    status: 'PENDING',
    runAt: '2026-09-29T07:00:00Z',
    nextRunAt: '2026-09-29T07:00:00Z',
    pinPolicy: 'PINNED',
    missedPolicy: 'RUN_LATE',
    ownerUserId,
    createdBy: ownerUserId,
    version: 1,
    itemCount: 1,
    driftCount: 0,
    ...(thenGenerate ? { thenGenerate: { ...thenGenerate, channels: [] } as unknown as ScheduleView['thenGenerate'] } : {}),
  };
}

describe('SchedulesComponent for an editor (M28.3.3)', () => {
  let fixture: ComponentFixture<SchedulesComponent>;
  let http: HttpTestingController;

  const ROWS: ScheduleView[] = [
    pendingRow(21, 'RELEASE', 1),
    pendingRow(22, 'RELEASE', 2),
    pendingRow(23, 'RELEASE', 1, { targetId: 8 }),
    pendingRow(24, 'UNPUBLISH', 1, { targetId: 7 }),
    pendingRow(25, 'RELEASE', 2, { targetId: 8 }),
    pendingRow(26, 'GENERATION', 1),
    pendingRow(27, 'RECURRING_GENERATION', 2),
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SchedulesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
    TestBed.inject(ProjectContextStore).project.set(
      projectDetail(['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'], ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD']),
    );
    TestBed.inject(AuthStore).setUser({ id: 1, username: 'erin', projectRoles: { proj: 'EDITOR' } });
    fixture = TestBed.createComponent(SchedulesComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush([
      { userId: 1, username: 'erin', displayName: 'Erin' },
      { userId: 2, username: 'ana', displayName: 'Ana Lopez' },
    ]);
    http.expectOne(`${BASE}/targets`).flush(TARGETS);
    http
      .expectOne((r) => r.url === `${BASE}/schedules`)
      .flush({ rows: ROWS, page: 0, size: 50, totalElements: ROWS.length, totalPages: 1 } satisfies SchedulePageView);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /** The row actions of schedule `index` (in list order), without the always-present History. */
  function actions(index: number): string[] {
    const row = fixture.nativeElement.querySelectorAll('tbody tr')[index] as HTMLElement;
    return Array.from(row.querySelectorAll('.schedules__action') as NodeListOf<HTMLElement>)
      .map((b) => b.textContent!.trim())
      .filter((label) => label !== 'History');
  }

  it('lets the editor change their own pending release', () => {
    expect(actions(0)).toEqual(['Edit', 'Run now', 'Cancel']);
  });

  it('offers only take over for another owner’s pending release', () => {
    expect(actions(1)).toEqual(['Take over']);
  });

  it('keeps a release that then builds another target out of reach without FULL_BUILD', () => {
    expect(actions(2)).toEqual([]);
    expect(actions(4)).toEqual([]);
  });

  it('lets the editor change their own schedule that then builds the default target', () => {
    expect(actions(3)).toEqual(['Edit', 'Run now', 'Cancel']);
  });

  it('offers nothing on generation schedules', () => {
    expect(actions(5)).toEqual([]);
    expect(actions(6)).toEqual([]);
  });

  it('does not offer a new generation schedule', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLElement>).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).not.toContain('New generation schedule');
  });
});
