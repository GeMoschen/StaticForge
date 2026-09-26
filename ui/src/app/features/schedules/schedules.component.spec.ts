import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
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
    TestBed.inject(AuthStore).setUser({ id: 1, username: 'me', projectRoles: { proj: 'DEVELOPER' } });
    fixture = TestBed.createComponent(SchedulesComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('status', 'PENDING');
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush([{ userId: 2, username: 'ana', displayName: 'Ana Lopez' }]);
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

  it('offers take over for another owner’s pending schedule', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.schedules__action') as NodeListOf<HTMLElement>).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toEqual(['History', 'Re-pin', 'Edit', 'Run now', 'Take over', 'Cancel']);
  });
});
