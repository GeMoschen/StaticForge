import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../../core/project/testing/project-detail.fixture';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { SchedulesComponent } from './schedules.component';

type SchedulePageView = components['schemas']['SchedulePageView'];
type ScheduleView = components['schemas']['ScheduleView'];

const BASE = '/api/v1/projects/proj';
const HOME = '3f1c2a90-6d4e-4c1b-9a57-0e1b7c2d5a11';

/** A list row as ScheduleController#list sends it: no items (withItems=false), but itemCount and driftCount. */
function row(id: number, type: string, ownerUserId: number, extra: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id,
    uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    type,
    status: 'PENDING',
    runAt: '2026-09-29T07:00:00Z',
    nextRunAt: '2026-09-29T07:00:00Z',
    zoneId: 'Europe/Berlin',
    pinPolicy: type === 'RELEASE' ? 'PINNED' : undefined,
    missedPolicy: 'RUN_LATE',
    ownerUserId,
    createdBy: ownerUserId,
    version: 1,
    itemCount: type === 'GENERATION' || type === 'RECURRING_GENERATION' ? 0 : 3,
    driftCount: 0,
    ...extra,
  };
}

function page(rows: ScheduleView[], totalPages = 1): SchedulePageView {
  return { rows, page: 0, size: 50, totalElements: rows.length, totalPages };
}

/** The project's targets as `GET /targets` sends them: 7 is the default. */
const TARGETS = [
  { id: 7, name: 'Live', type: 'FILESYSTEM', isDefault: true, outputPath: 'proj/live' },
  { id: 8, name: 'Staging', type: 'FILESYSTEM', isDefault: false, outputPath: 'proj/staging' },
];
const MEMBERS = [
  { userId: 1, username: 'erin', displayName: 'Erin' },
  { userId: 2, username: 'ana', displayName: 'Ana Lopez' },
];

interface Setup {
  role?: string;
  /** `[all, own]` publish permissions of the project detail (the second is the caller's). */
  permissions?: string[];
  inputs?: Record<string, unknown>;
  rows?: ScheduleView[];
  /** Flush the list with this failure instead. */
  fail?: boolean;
  confirm?: boolean;
}

let current: HttpTestingController | null = null;
afterEach(() => {
  // The project detail some stores read on their own: not what these specs are about.
  current?.match((r) => r.url === BASE);
  // The generation options of an open schedule dialog read the targets and channels.
  current?.match((r) => r.url === `${BASE}/targets` || r.url === `${BASE}/channels`);
  current?.verify();
  current = null;
});

async function setup({ role = 'DEVELOPER', permissions, inputs = {}, rows = [row(12, 'RELEASE', 2, { driftCount: 1 })], fail = false, confirm = true }: Setup = {}) {
  const confirmFn = vi.fn().mockResolvedValue(confirm);
  const view = await render(SchedulesComponent, {
    componentInputs: { projectKey: 'proj', ...inputs },
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ConfirmService, useValue: { confirm: confirmFn } }],
    configureTestBed: (testBed) => {
      testBed.inject(ProjectContextStore).activeProjectKey.set('proj');
      testBed.inject(ProjectContextStore).project.set(
        permissions ? projectDetail(permissions as never, permissions as never) : projectDetail(ALL_PUBLISH_PERMISSIONS),
      );
      testBed.inject(AuthStore).setUser({ id: 1, username: 'erin', projectRoles: { proj: role } });
    },
  });
  const http = TestBed.inject(HttpTestingController);
  current = http;
  const list = await waitForList(http);
  if (fail) {
    list.flush({ title: 'Boom', detail: 'The server fell over.' }, { status: 500, statusText: 'Server Error' });
  } else {
    list.flush(page(rows));
  }
  http.match(`${BASE}/members`).forEach((r) => r.flush(MEMBERS));
  http.match(`${BASE}/targets`).forEach((r) => r.flush(TARGETS));
  view.fixture.detectChanges();
  return { ...view, http, list, confirm: confirmFn };
}

async function waitForList(http: HttpTestingController): Promise<TestRequest> {
  let found: TestRequest[] = [];
  await waitFor(() => {
    found = http.match((r) => r.url === `${BASE}/schedules`);
    expect(found.length).toBeGreaterThan(0);
  });
  return found[found.length - 1];
}

const dataRows = () => screen.getAllByRole('row').filter((r) => r.getAttribute('aria-rowindex') !== '1' && !r.querySelector('th'));

/** The labels of the ⋮ menu of data row `index`; closes the menu again. */
async function actionsOf(index: number): Promise<string[]> {
  fireEvent.click(within(dataRows()[index]).getByRole('button', { name: /^Actions for/ }));
  const labels = (await screen.findAllByRole('menuitem')).map((item) => item.querySelector('.sf-menu__label')!.textContent!.trim());
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
  return labels;
}

async function chooseAction(index: number, name: RegExp | string): Promise<void> {
  fireEvent.click(within(dataRows()[index]).getByRole('button', { name: /^Actions for/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('SchedulesComponent', () => {
  it('asks the server for the page the URL names, with the filters', async () => {
    const { list } = await setup({ inputs: { type: 'RELEASE', status: 'PENDING', owner: '2', page: '1' } });
    expect(list.request.params.getAll('type')).toEqual(['RELEASE']);
    expect(list.request.params.getAll('status')).toEqual(['PENDING']);
    expect(list.request.params.get('owner')).toBe('2');
    expect(list.request.params.get('page')).toBe('1');
    expect(list.request.params.get('size')).toBe('50');
  });

  it('filters on the three kinds; Generation asks for the one-off and the recurring type', async () => {
    const { list } = await setup({ inputs: { type: 'GENERATION' } });
    expect(list.request.params.getAll('type')).toEqual(['GENERATION', 'RECURRING_GENERATION']);
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const type = await screen.findByRole('group', { name: 'Type' });
    expect(within(type).getByRole('button', { name: 'Release', pressed: false })).toBeInTheDocument();
    expect(within(type).getByRole('button', { name: 'Unpublish', pressed: false })).toBeInTheDocument();
    expect(within(type).getByRole('button', { name: 'Generation', pressed: true })).toBeInTheDocument();
    expect(within(type).queryByRole('button', { name: 'Recurring generation' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
  });

  it('lists kind, what, next run, owner by name and status, with the drift warning', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Schedules' })).toBeInTheDocument();
    const grid = await screen.findByRole('grid', { name: 'Schedules, next due first' });
    const [first] = dataRows();
    expect(within(first).getByText('Release')).toBeInTheDocument();
    expect(within(first).getByText('3 items')).toBeInTheDocument();
    expect(within(first).getByText('Draft changed since scheduled')).toBeInTheDocument();
    expect(within(first).getByText('Ana Lopez')).toBeInTheDocument();
    expect(within(first).getByText('Pending')).toBeInTheDocument();
    expect(grid.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('drops the drift warning once the schedule has run', async () => {
    await setup({ rows: [row(12, 'RELEASE', 2, { status: 'SUCCEEDED', nextRunAt: undefined, driftCount: 1 })] });
    expect(screen.queryByText('Draft changed since scheduled')).toBeNull();
  });

  it('names a paused recurring schedule and its last outcome', async () => {
    await setup({
      rows: [
        row(30, 'RECURRING_GENERATION', 1, {
          status: 'FAILED',
          nextRunAt: undefined,
          cron: '0 9 * * *',
          params: { mode: 'INCREMENTAL' } as unknown as ScheduleView['params'],
          lastExecution: { id: 4, scheduledFor: '2026-09-28T07:00:00Z', outcome: 'FAILED', message: 'Owner no longer permitted' },
        }),
      ],
    });
    const [first] = dataRows();
    expect(within(first).getByText('Generation')).toBeInTheDocument();
    expect(within(first).getByText('Incremental build · all channels')).toBeInTheDocument();
    expect(within(first).getByText('Every day at 09:00')).toBeInTheDocument();
    expect(within(first).getByText('Paused')).toBeInTheDocument();
    expect(within(first).getByText('Last: Failed')).toBeInTheDocument();
  });

  it('offers re-pin, edit, run now, take over and cancel in the ⋮ menu of another owner’s drifted release', async () => {
    await setup();
    expect(await actionsOf(0)).toEqual(['History', 'Re-pin to current drafts', 'Edit…', 'Run now', 'Take over', 'Cancel schedule…']);
  });

  it('re-pins from the menu and re-reads the list', async () => {
    const { http } = await setup();
    await chooseAction(0, /Re-pin/);
    http.expectOne({ method: 'POST', url: `${BASE}/schedules/12/repin` }).flush(row(12, 'RELEASE', 2));
    // The action re-reads the list (release events).
    const list = await waitForList(http);
    list.flush(page([row(12, 'RELEASE', 2, { driftCount: 0 })]));
    await waitFor(() => expect(screen.queryByText('Draft changed since scheduled')).toBeNull());
    expect(TestBed.inject(ToastService).toasts().map((t) => t.message)).toContain('Pinned to the current drafts.');
  });

  it('asks before cancelling and cancels only when confirmed', async () => {
    const declined = await setup({ confirm: false });
    await chooseAction(0, /Cancel schedule/);
    await waitFor(() => expect(declined.confirm).toHaveBeenCalled());
    const options = declined.confirm.mock.calls[0][0];
    expect(options).toMatchObject({ title: 'Cancel this release schedule?', confirmLabel: 'Cancel schedule', cancelLabel: 'Keep it', tone: 'danger' });
    declined.http.expectNone({ method: 'POST', url: `${BASE}/schedules/12/cancel` });
    declined.fixture.destroy();
  });

  it('cancels a confirmed schedule', async () => {
    const { http } = await setup();
    await chooseAction(0, /Cancel schedule/);
    const cancel = await waitFor(() => http.expectOne({ method: 'POST', url: `${BASE}/schedules/12/cancel` }));
    cancel.flush(row(12, 'RELEASE', 2, { status: 'CANCELLED' }));
    (await waitForList(http)).flush(page([row(12, 'RELEASE', 2, { status: 'CANCELLED', nextRunAt: undefined })]));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it('takes over and runs now', async () => {
    const { http } = await setup();
    await chooseAction(0, 'Run now');
    http.expectOne({ method: 'POST', url: `${BASE}/schedules/12/run-now` }).flush(row(12, 'RELEASE', 2));
    (await waitForList(http)).flush(page([row(12, 'RELEASE', 2)]));
    await chooseAction(0, 'Take over');
    http.expectOne({ method: 'POST', url: `${BASE}/schedules/12/take-over` }).flush(row(12, 'RELEASE', 1));
    (await waitForList(http)).flush(page([row(12, 'RELEASE', 1)]));
  });

  it('opens the schedule dialog on the detail when editing', async () => {
    const { http } = await setup();
    await chooseAction(0, /Edit/);
    http
      .expectOne(`${BASE}/schedules/12`)
      .flush(row(12, 'RELEASE', 2, { items: [{ assetUuid: HOME, assetType: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en' }] }));
    const dialog = await screen.findByRole('dialog', { name: /Edit release schedule/i });
    expect(within(dialog).getByText(/Home/)).toBeInTheDocument();
  });

  it('opens a row’s history through the URL, and highlights the open row', async () => {
    await setup({ inputs: { id: '12' }, rows: [row(12, 'RELEASE', 2), row(13, 'RELEASE', 2)] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(dataRows()[1]);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { id: 13 } }));
    expect(dataRows()[0]).toHaveAttribute('aria-current', 'true');
    // The history drawer asks for the schedule and its executions.
    current!.expectOne(`${BASE}/schedules/12`);
    current!.expectOne((r) => r.url === `${BASE}/schedules/12/executions`);
  });

  it('shows the filters as chips and writes a removed one to the URL', async () => {
    await setup({ inputs: { type: 'RELEASE', owner: '2' } });
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual(
      expect.arrayContaining([expect.stringContaining('Type: Release'), expect.stringContaining('Owner: Ana Lopez')]),
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(within(chips).getByRole('button', { name: /Type: Release/ }));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { type: null, page: null } }));
    fireEvent.click(within(chips).getByRole('button', { name: 'Clear all' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { type: null, status: null, owner: null, page: null } }));
  });

  it('picks a filter in the popover and goes back to the first page', async () => {
    await setup({ inputs: { page: '3' } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const status = await screen.findByRole('group', { name: 'Status' });
    fireEvent.click(within(status).getByRole('button', { name: 'Failed or paused' }));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { status: 'FAILED', page: null } }));
  });

  it('pages through the list', async () => {
    const view = await render(SchedulesComponent, {
      componentInputs: { projectKey: 'proj', page: '1' },
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      configureTestBed: (testBed) => {
        testBed.inject(ProjectContextStore).activeProjectKey.set('proj');
        testBed.inject(ProjectContextStore).project.set(projectDetail(ALL_PUBLISH_PERMISSIONS));
        testBed.inject(AuthStore).setUser({ id: 1, username: 'erin', projectRoles: { proj: 'DEVELOPER' } });
      },
    });
    const http = TestBed.inject(HttpTestingController);
    current = http;
    (await waitForList(http)).flush({ ...page([row(12, 'RELEASE', 2)], 3), page: 1, totalElements: 120 });
    http.match(`${BASE}/members`).forEach((r) => r.flush(MEMBERS));
    http.match(`${BASE}/targets`).forEach((r) => r.flush(TARGETS));
    view.fixture.detectChanges();
    expect(screen.getByText('Page 2 of 3 · 120 schedules')).toBeInTheDocument();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { page: 2 } }));
  });

  it('says so when there are no schedules', async () => {
    await setup({ rows: [] });
    expect(await screen.findByText('No schedules yet')).toBeInTheDocument();
  });

  it('says so when the filters match no schedule', async () => {
    await setup({ rows: [], inputs: { status: 'FAILED' } });
    expect(await screen.findByText('No schedules match')).toBeInTheDocument();
  });

  it('shows the error with a retry that reads the list again', async () => {
    const { http } = await setup({ fail: true });
    expect(await screen.findByText('The server fell over.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    (await waitForList(http)).flush(page([row(12, 'RELEASE', 2)]));
    expect(await screen.findByText('3 items')).toBeInTheDocument();
  });
});

describe('SchedulesComponent: New schedule', () => {
  const CHANGES = {
    rows: [
      { uuid: HOME, type: 'PAGE', uid: 'home', displayName: 'Home', folderPath: '/pages_root/', locale: 'en', status: 'CHANGED', changedBy: 2, changedAt: '2026-09-25T10:00:00Z', scheduled: [] },
      { uuid: '8a2d7f44-1b9c-4e6a-b3d0-5c7e9f1a2b33', type: 'MEDIA', uid: 'hero', displayName: 'Hero', folderPath: '/media_root/', locale: '', status: 'NEW', changedAt: '2026-09-24T10:00:00Z', scheduled: [] },
    ],
    page: 0,
    size: 200,
    totalElements: 2,
    totalPages: 1,
  };
  /** `GET /search` as SearchController sends it: assets, no locale. */
  const ONLINE = {
    content: [{ uuid: HOME, type: 'PAGE', uid: 'home', displayName: 'Home', folderPath: '/pages_root/', score: 1 }],
    page: { size: 100, number: 0, totalElements: 1, totalPages: 1 },
    facets: { types: { PAGE: 1 } },
  };

  it('offers release, unpublish and generation to a developer', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    const labels = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(labels).toEqual([expect.stringContaining('Release'), expect.stringContaining('Unpublish'), expect.stringContaining('Generation')]);
  });

  it('offers an editor with the schedule permission release and unpublish, not generation', async () => {
    await setup({ role: 'EDITOR', permissions: ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD'] });
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    const labels = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
    expect(labels).toHaveLength(2);
    expect(labels.join()).not.toContain('Generation');
  });

  it('offers an editor without the schedule permission no New schedule', async () => {
    await setup({ role: 'EDITOR', permissions: ['RELEASE'] });
    expect(screen.queryByRole('button', { name: 'New schedule' })).toBeNull();
  });

  it('reads the releasable changes and the online content, then picks by name in a release dialog', async () => {
    const { http } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Release/ }));
    const changes = await waitFor(() => http.expectOne((r) => r.url === `${BASE}/changes`));
    expect(changes.request.params.getAll('status')).toEqual(['NEW', 'CHANGED', 'UNPUBLISHED', 'DELETION_PENDING']);
    expect(changes.request.params.get('size')).toBe('200');
    const search = http.expectOne((r) => r.url === `${BASE}/search`);
    expect(search.request.params.getAll('releaseStatus')).toEqual(['PUBLISHED', 'CHANGED', 'DELETION_PENDING']);
    changes.flush(CHANGES);
    search.flush(ONLINE);
    const dialog = await screen.findByRole('dialog', { name: 'Schedule release' });
    // The kind switch spans every kind the viewer may create.
    expect(within(dialog).getByRole('radio', { name: 'Unpublish' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Generation' })).toBeInTheDocument();
    // The items are picked by name, nothing is ticked yet.
    expect(within(dialog).getByRole('button', { name: 'Schedule release' })).toHaveAttribute('aria-disabled', 'true');
    const items = within(dialog).getByRole('combobox', { name: /Items/ });
    fireEvent.focus(items);
    fireEvent.keyDown(items, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Home · EN — Changed' }));
    expect(within(dialog).getByText('Home · EN — Changed')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('opens a generation dialog without reading any content when the viewer may only schedule generations', async () => {
    const { http } = await setup({ role: 'DEVELOPER', permissions: ['INCREMENTAL_BUILD', 'FULL_BUILD'] });
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Generation/ }));
    expect(await screen.findByRole('dialog', { name: /Schedule generation/ })).toBeInTheDocument();
    http.expectNone((r) => r.url === `${BASE}/changes`);
  });

  it('tells the user when the changes can’t be read, and opens nothing', async () => {
    const { http } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'New schedule' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Release/ }));
    const changes = await waitFor(() => http.expectOne((r) => r.url === `${BASE}/changes`));
    http.expectOne((r) => r.url === `${BASE}/search`).flush(ONLINE);
    changes.flush({ title: 'Boom', detail: 'x' }, { status: 500, statusText: 'Server Error' });
    await waitFor(() =>
      expect(TestBed.inject(ToastService).toasts().map((t) => t.message)).toContain('Could not load the content to schedule — try again in a moment.'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
