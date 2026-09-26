import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../../core/project/testing/project-detail.fixture';
import { NavRailComponent } from '../dashboard/nav-rail.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { ChangesComponent } from './changes.component';
import { paramsFromState, pendingCount, queryFromState, stateFromParams } from './changes-query.util';

type ChangesPageView = components['schemas']['ChangesPageView'];

const BASE = '/api/v1/projects/proj';

// Rows as ChangesController#list sends them (stored folder paths, locale per row).
const PAGE: ChangesPageView = {
  rows: [
    {
      uuid: 'page-1',
      type: 'PAGE',
      uid: 'home',
      displayName: 'Home',
      folderPath: '/pages_root/',
      locale: 'en',
      status: 'CHANGED',
      changedBy: 2,
      changedAt: '2026-09-25T10:00:00Z',
      releasedRevision: 40,
      releasedAt: '2026-09-20T10:00:00Z',
      scheduled: [],
    },
    {
      uuid: 'media-1',
      type: 'MEDIA',
      uid: 'hero',
      displayName: 'Hero',
      folderPath: '/media_root/photos/',
      locale: '',
      status: 'NEW',
      changedBy: 2,
      changedAt: '2026-09-24T10:00:00Z',
      scheduled: [],
    },
  ],
  page: 0,
  size: 50,
  totalElements: 2,
  totalPages: 1,
};

describe('changes query util', () => {
  it('maps URL parameters to the state and back', () => {
    const state = stateFromParams({ type: ['PAGE', 'MEDIA'], status: 'CHANGED', locale: 'de', changedBy: '7', q: 'home', page: '2' });
    expect(state).toEqual({
      type: ['PAGE', 'MEDIA'],
      status: ['CHANGED'],
      locale: ['de'],
      changedBy: 7,
      folder: null,
      q: 'home',
      sort: 'changedAt,desc',
      page: 2,
    });
    expect(paramsFromState(state)).toEqual({
      type: ['PAGE', 'MEDIA'],
      status: ['CHANGED'],
      locale: ['de'],
      changedBy: '7',
      folder: null,
      q: 'home',
      sort: null,
      page: '2',
    });
    expect(queryFromState({ ...state, sort: 'displayName,asc' })).toMatchObject({
      type: ['PAGE', 'MEDIA'],
      changedBy: 7,
      sort: 'displayName,asc',
      page: 2,
      size: 50,
    });
    // Garbage falls back to the defaults.
    expect(stateFromParams({ sort: 'size', page: '-3', changedBy: 'x' })).toMatchObject({ sort: 'changedAt,desc', page: 0, changedBy: null });
  });

  it('counts new, changed and deletion-pending pairs for the nav rail', () => {
    expect(pendingCount({ NEW: 2, CHANGED: 3, DELETION_PENDING: 1, UNPUBLISHED: 4, total: 10 })).toBe(6);
    expect(pendingCount(null)).toBe(0);
  });
});

describe('ChangesComponent', () => {
  let fixture: ComponentFixture<ChangesComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [ChangesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
    TestBed.inject(ProjectContextStore).project.set(projectDetail(ALL_PUBLISH_PERMISSIONS));
    TestBed.inject(AuthStore).setUser({ id: 1, username: 'me', projectRoles: { proj: 'DEVELOPER' } });
    fixture = TestBed.createComponent(ChangesComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('type', ['PAGE', 'MEDIA']);
    fixture.componentRef.setInput('status', 'CHANGED');
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush([{ userId: 2, username: 'ana', displayName: 'Ana Lopez' }]);
    const list = http.expectOne((r) => r.url === `${BASE}/changes`);
    expect(list.request.params.getAll('type')).toEqual(['PAGE', 'MEDIA']);
    expect(list.request.params.getAll('status')).toEqual(['CHANGED']);
    list.flush(PAGE);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('shows the filters as chips and writes a toggled filter to the URL', () => {
    const chips = Array.from(fixture.nativeElement.querySelectorAll('.changes__chip') as NodeListOf<HTMLElement>).map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toEqual(['Page close', 'Media close', 'Changed close']);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    (fixture.nativeElement.querySelector('.changes__chip') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ type: ['MEDIA'], status: ['CHANGED'], page: null }) }));
  });

  it('selects rows with the keyboard and releases exactly the selection', () => {
    const rows = fixture.nativeElement.querySelectorAll('.changes__row') as NodeListOf<HTMLElement>;
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.changes__selected')?.textContent).toContain('2 selected');

    const release = Array.from(fixture.nativeElement.querySelectorAll('.changes__actions button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Release…',
    )!;
    release.click();
    fixture.detectChanges();
    fixture.detectChanges();
    vi.advanceTimersByTime(300);
    const plan = http.expectOne(`${BASE}/releases/plan`);
    // The shared key ("every language") travels as an item without a locale.
    expect(plan.request.body).toEqual({ items: [{ assetUuid: 'page-1', locale: 'en' }, { assetUuid: 'media-1' }] });
    plan.flush({ items: [], dependencies: [], incomplete: [], warnings: [] });
  });

  it('opens the diff of a row with Enter', () => {
    const row = fixture.nativeElement.querySelector('.changes__row') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    const diff = http.expectOne((r) => r.url === `${BASE}/changes/page-1/diff`);
    expect(diff.request.params.get('locale')).toBe('en');
    diff.flush({ uuid: 'page-1', locale: 'en', status: 'CHANGED', changes: [{ path: 'content.title.values.en', before: 'Old', after: 'New' }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.changes__diff')?.textContent).toContain('Open in editor');
    expect(fixture.nativeElement.querySelector('.changes__diff')?.textContent).toContain('New');
  });
});

describe('NavRailComponent changes count', () => {
  it('re-reads the count after a release action', () => {
    TestBed.configureTestingModule({
      imports: [NavRailComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProjectContextStore).activeProjectKey.set('proj');
    const fixture = TestBed.createComponent(NavRailComponent);
    fixture.detectChanges();
    http.expectOne(`${BASE}/changes/count`).flush({ NEW: 1, CHANGED: 2, total: 3 });
    fixture.detectChanges();
    const link = () => fixture.nativeElement.querySelector('a[href="/p/proj/changes"]') as HTMLElement;
    expect(link().getAttribute('aria-label')).toBe('Changes, 3 unreleased changes');

    TestBed.inject(ReleaseEventsStore).changed();
    fixture.detectChanges();
    http.expectOne(`${BASE}/changes/count`).flush({ NEW: 1, total: 1 });
    fixture.detectChanges();
    expect(link().getAttribute('aria-label')).toBe('Changes, 1 unreleased change');
    http.verify();
  });
});
