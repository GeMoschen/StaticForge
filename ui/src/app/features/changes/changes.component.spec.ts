import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ALL_PUBLISH_PERMISSIONS, projectDetail } from '../../core/project/testing/project-detail.fixture';
import { ToastService } from '../../core/ui/toast.service';
import { ReleaseEventsStore } from '../release/release-events.store';
import { ChangesComponent } from './changes.component';
import { SORT_KEYS, paramsFromState, pendingCount, queryFromState, stateFromParams } from './changes-query.util';

type ChangesPageView = components['schemas']['ChangesPageView'];

const BASE = '/api/v1/projects/proj';
const HOME = '3f1c2a90-6d4e-4c1b-9a57-0e1b7c2d5a11';
const HERO = '8a2d7f44-1b9c-4e6a-b3d0-5c7e9f1a2b33';

// Rows as ChangesController#list sends them: one per (asset, locale) in the server's order (newest first, the
// locale of a tie alphabetical), stored folder paths, the shared key as an empty locale.
const PAGE: ChangesPageView = {
  rows: [
    {
      uuid: HOME,
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
      uuid: HERO,
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
    {
      uuid: HOME,
      type: 'PAGE',
      uid: 'home',
      displayName: 'Home',
      folderPath: '/pages_root/',
      locale: 'de',
      status: 'NEW',
      changedBy: 2,
      changedAt: '2026-09-23T10:00:00Z',
      scheduled: [{ actionId: 7, type: 'RELEASE', locale: 'de', runAt: '2026-10-20T09:00:00Z', ownerUserId: 2 }],
    },
  ],
  page: 0,
  size: 50,
  totalElements: 3,
  totalPages: 1,
};

const MEMBERS = [{ userId: 2, username: 'ana', displayName: 'Ana Lopez' }];

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

  it('keeps the shared language key (an empty locale) through the URL', () => {
    expect(stateFromParams({ locale: ['', 'de'] }).locale).toEqual(['de']);
    expect(queryFromState(stateFromParams({ locale: 'de' })).locale).toEqual(['de']);
  });

  it('names a translation key for every sort', () => {
    expect(Object.values(SORT_KEYS)).toEqual(['newest', 'oldest', 'az', 'za']);
  });

  it('counts new, changed and deletion-pending pairs for the nav rail', () => {
    expect(pendingCount({ NEW: 2, CHANGED: 3, DELETION_PENDING: 1, UNPUBLISHED: 4, total: 10 })).toBe(6);
    expect(pendingCount(null)).toBe(0);
  });
});

interface Setup {
  role?: string;
  inputs?: Record<string, unknown>;
  page?: ChangesPageView;
  /** Flush the list with this failure instead. */
  fail?: boolean;
  localized?: boolean;
}

async function setup({ role = 'DEVELOPER', inputs = {}, page = PAGE, fail = false, localized = true }: Setup = {}) {
  const view = await render(ChangesComponent, {
    componentInputs: { projectKey: 'proj', ...inputs },
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    configureTestBed: (testBed) => {
      testBed.inject(ProjectContextStore).activeProjectKey.set('proj');
      testBed.inject(ProjectContextStore).project.set(projectDetail(ALL_PUBLISH_PERMISSIONS));
      testBed.inject(AuthStore).setUser({ id: 1, username: 'me', projectRoles: { proj: role } });
      if (localized) {
        testBed.inject(LocalesStore).config.set({
          defaultLocale: 'de',
          locales: [
            { code: 'de', label: 'Deutsch' },
            { code: 'en', label: 'English' },
          ],
        });
      }
    },
  });
  const http = TestBed.inject(HttpTestingController);
  current = http;
  const list = await waitForList(http);
  if (fail) {
    list.flush({ title: 'Boom', detail: 'The server fell over.' }, { status: 500, statusText: 'Server Error' });
  } else {
    list.flush(page);
  }
  http.match(`${BASE}/members`).forEach((r) => r.flush(MEMBERS));
  view.fixture.detectChanges();
  return { ...view, http, list };
}

async function waitForList(http: HttpTestingController): Promise<TestRequest> {
  let found: TestRequest[] = [];
  await waitFor(() => {
    found = http.match((r) => r.url === `${BASE}/changes`);
    expect(found.length).toBeGreaterThan(0);
  });
  return found[found.length - 1];
}

const dataRows = () => screen.getAllByRole('row').filter((row) => row.getAttribute('aria-rowindex') !== '1' && !row.querySelector('th'));

let current: HttpTestingController | null = null;
afterEach(() => {
  // The project detail some stores read on their own: not what these specs are about.
  current?.match((r) => r.url === BASE);
  current?.verify();
  current = null;
});

describe('ChangesComponent', () => {
  it('asks the server for the page the URL names, with the filters as repeated parameters', async () => {
    const { list } = await setup({ inputs: { type: ['PAGE', 'MEDIA'], status: 'CHANGED', sort: 'displayName,asc', page: '1', changedBy: '2', q: 'ho' } });
    expect(list.request.params.getAll('type')).toEqual(['PAGE', 'MEDIA']);
    expect(list.request.params.getAll('status')).toEqual(['CHANGED']);
    expect(list.request.params.get('sort')).toBe('displayName,asc');
    expect(list.request.params.get('page')).toBe('1');
    expect(list.request.params.get('size')).toBe('50');
    expect(list.request.params.get('changedBy')).toBe('2');
    expect(list.request.params.get('q')).toBe('ho');
  });

  it('lists one row per language with the default language first and no ids but names', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Changes' })).toBeInTheDocument();
    expect(screen.getByText('3 changes')).toBeInTheDocument();
    const grid = await screen.findByRole('grid', { name: 'Unreleased changes' });
    const rows = within(grid)
      .getAllByRole('row')
      .filter((r) => r.textContent?.match(/Home|Hero/));
    // The server sent Home/en, Hero, Home/de: an asset's languages sit together, German (default) first.
    expect(rows.map((r) => (r.textContent?.includes('Hero') ? 'Hero' : /DE/.test(r.textContent ?? '') && !/EN/.test(r.textContent ?? '') ? 'Home DE' : 'Home EN'))).toEqual([
      'Home DE',
      'Home EN',
      'Hero',
    ]);
    expect(within(rows[0]).getByText('default')).toBeInTheDocument();
    expect(within(rows[2]).getByText('All languages')).toBeInTheDocument();
    expect(grid.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    // The member's name, not their id.
    expect(within(rows[0]).getByText(/Ana Lopez/)).toBeInTheDocument();
    // A scheduled release shows next to the status.
    expect(within(rows[0]).getByText(/Release scheduled for/)).toBeInTheDocument();
  });

  it('shows the UID in developer mode only, copyable', async () => {
    const dev = await setup();
    expect(within(await screen.findByRole('grid')).getAllByRole('button', { name: 'Copy UID' }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('grid')).getAllByText('home').length).toBeGreaterThan(0);
    dev.fixture.destroy();
  });

  it('hides the UIDs from an editor', async () => {
    await setup({ role: 'EDITOR' });
    const grid = await screen.findByRole('grid');
    expect(within(grid).queryByRole('button', { name: 'Copy UID' })).toBeNull();
    expect(within(grid).queryByText('home')).toBeNull();
  });

  it('shows the filters as chips and writes a removed one to the URL', async () => {
    await setup({ inputs: { type: ['PAGE', 'MEDIA'], status: 'CHANGED' } });
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual(
      expect.arrayContaining([expect.stringContaining('Type: Page'), expect.stringContaining('Type: Media'), expect.stringContaining('Status: Changed')]),
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(within(chips).getByRole('button', { name: /Type: Page/ }));
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ type: ['MEDIA'], status: ['CHANGED'], page: null }) }),
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Clear all' }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ type: null, status: null, q: null, page: null }) }),
    );
  });

  it('shows no chips while no filter is set', async () => {
    await setup();
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('picks a filter from its menu and goes back to the first page', async () => {
    await setup({ inputs: { type: 'PAGE', page: '3' } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Type: Page' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Media/ }));
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ type: ['PAGE', 'MEDIA'], page: null }) }),
    );
  });

  it('offers the language filter only in a localized project', async () => {
    const view = await setup({ localized: false });
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
    view.fixture.destroy();
  });

  it('selects rows and releases exactly the selection, one plan item per language', async () => {
    const { http } = await setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Home (EN)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Hero' }));
    const bar = await screen.findByRole('group', { name: 'Bulk actions' });
    expect(bar.textContent).toContain('2 selected');
    fireEvent.click(within(bar).getByRole('button', { name: 'Release…' }));
    const plan = await waitFor(() => http.expectOne(`${BASE}/releases/plan`));
    // The shared key ("every language") travels as an item without a locale.
    expect(plan.request.body).toEqual({ items: [{ assetUuid: HOME, locale: 'en' }, { assetUuid: HERO }] });
    plan.flush({ items: [], dependencies: [], incomplete: [], warnings: [] });
    expect(await screen.findByRole('dialog', { name: /Release/ })).toBeInTheDocument();
  });

  it('opens the schedule dialog for the selection, only with the schedule permission', async () => {
    await setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Hero' }));
    const bar = await screen.findByRole('group', { name: 'Bulk actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Schedule…' }));
    expect(await screen.findByRole('dialog', { name: 'Schedule release' })).toBeInTheDocument();
  });

  it('says so when none of the selected rows has a released version to discard', async () => {
    await setup();
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Hero' }));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Bulk actions' })).getByRole('button', { name: 'Discard…' }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Nothing to discard'), 'info');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('discards only the changed rows of the selection', async () => {
    const { http } = await setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Home (EN)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Hero' }));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Bulk actions' })).getByRole('button', { name: 'Discard…' }));
    const dialog = await screen.findByRole('dialog', { name: /Discard changes/ });
    await waitFor(() => expect(dialog.textContent).toContain('Home · EN'));
    expect(dialog.textContent).not.toContain('Hero');
    http.match((r) => r.url.includes('/diff')).forEach((r) => r.flush({ uuid: HOME, locale: 'en', status: 'CHANGED', changes: [] }));
  });

  it('opens the diff of a row beside the table, highlights the row and closes it', async () => {
    const { http, fixture } = await setup();
    const row = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Home') && r.textContent.includes('EN'))!;
    fireEvent.click(row);
    const diff = await waitFor(() => http.expectOne((r) => r.url === `${BASE}/changes/${HOME}/diff`));
    expect(diff.request.params.get('locale')).toBe('en');
    diff.flush({ uuid: HOME, locale: 'en', status: 'CHANGED', changes: [{ path: 'content.title.values.en', before: 'Old', after: 'New' }] });
    fixture.detectChanges();
    const pane = await screen.findByRole('region', { name: 'Home' });
    expect(within(pane).getByRole('heading', { level: 2, name: 'Home' })).toBeInTheDocument();
    expect(pane.textContent).toContain('Page · English (EN)');
    expect(pane.textContent).toContain('Left: released');
    expect(pane.textContent).toContain('New');
    expect(within(pane).getByRole('link', { name: 'Open in editor' })).toHaveAttribute('href', `/p/proj/pages/${HOME}`);
    expect(pane.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('Home');

    fireEvent.click(within(pane).getByRole('button', { name: 'Close the diff' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Home' })).toBeNull());
    expect(dataRows().length).toBe(3);
  });

  it('keeps the selection when the diff pane opens (the table is re-created)', async () => {
    const { http, fixture } = await setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Hero' }));
    const hero = screen.getAllByRole('row').find((r) => r.textContent?.includes('Hero'))!;
    fireEvent.click(within(hero).getByText('Hero'));
    http.match((r) => r.url.includes('/diff')).forEach((r) => r.flush({ uuid: HERO, locale: '', status: 'NEW', changes: [] }));
    fixture.detectChanges();
    await screen.findByRole('region', { name: 'Hero' });
    expect(await screen.findByRole('group', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
  });

  it('shows the per-status note above an empty diff', async () => {
    const { http, fixture } = await setup();
    const hero = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Hero'))!;
    fireEvent.click(hero);
    http.match((r) => r.url.includes('/diff')).forEach((r) => r.flush({ uuid: HERO, locale: '', status: 'NEW', changes: [] }));
    fixture.detectChanges();
    expect(await screen.findByText('Never released — everything is new.')).toBeInTheDocument();
  });

  it('pages: Previous and Next write the page to the URL', async () => {
    await setup({ inputs: { page: '1' }, page: { ...PAGE, page: 1, totalElements: 120, totalPages: 3 } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ page: '2' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ page: null }) }));
  });

  it('writes the typed search to the URL once the typing settles', async () => {
    await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'ho' } });
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ q: 'ho', page: null }) })),
    );
  });

  it('reads the list again after a release event', async () => {
    const { http } = await setup();
    TestBed.inject(ReleaseEventsStore).changed();
    const again = await waitForList(http);
    again.flush({ rows: [], page: 0, size: 50, totalElements: 0, totalPages: 0 });
    expect(await screen.findByText('Everything is published')).toBeInTheDocument();
  });

  it('says everything is published when nothing is pending', async () => {
    await setup({ page: { rows: [], page: 0, size: 50, totalElements: 0, totalPages: 0 } });
    expect(await screen.findByText('Everything is published')).toBeInTheDocument();
  });

  it('says no changes match while a filter is set', async () => {
    await setup({ inputs: { q: 'zzz' }, page: { rows: [], page: 0, size: 50, totalElements: 0, totalPages: 0 } });
    expect(await screen.findByText('No changes match')).toBeInTheDocument();
  });

  it('shows the server problem with a Retry that reads the list again', async () => {
    const { http } = await setup({ fail: true });
    expect(await screen.findByText('The server fell over.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const again = await waitForList(http);
    again.flush(PAGE);
    expect(await screen.findByRole('grid', { name: 'Unreleased changes' })).toBeInTheDocument();
  });
});
