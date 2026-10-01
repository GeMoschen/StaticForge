import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../auth/auth.store';
import { providePreferencesSync } from './preferences-sync';
import { REMOVE_LEGACY_KEYS, PreferencesService } from './preferences.service';

const URL = '/api/v1/me/preferences';

function setup(removeLegacy = false): { prefs: PreferencesService; http: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: REMOVE_LEGACY_KEYS, useValue: removeLegacy }],
  });
  return { prefs: TestBed.inject(PreferencesService), http: TestBed.inject(HttpTestingController) };
}

/** The server applies the merge patch to `base` and answers with the merged document. */
function mergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete out[k];
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeInto((out[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function answer(req: TestRequest, server: Record<string, unknown> = { schemaVersion: 1 }): Record<string, unknown> {
  const merged = mergeInto(server, req.request.body as Record<string, unknown>);
  req.flush(merged);
  return merged;
}

describe('PreferencesService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('serves the defaults before anything is loaded', () => {
    const { prefs } = setup();
    expect(prefs.theme()).toBe('system');
    expect(prefs.density()).toBe('compact');
    expect(prefs.developerMode()).toBe(false);
    expect(prefs.railCollapsed()).toBe(false);
    expect(prefs.previewView()).toBe('draft');
    expect(prefs.issueScopes()).toEqual([]);
    expect(prefs.recents('acme')).toEqual([]);
    expect(prefs.editingLocale('acme')).toBeNull();
  });

  it('keeps the defaults when the load fails, and still takes edits', () => {
    const { prefs, http } = setup();
    prefs.load();
    http.expectOne(URL).error(new ProgressEvent('error'));
    expect(prefs.loaded()).toBe(false);
    expect(prefs.loadFailed()).toBe(true);
    expect(prefs.theme()).toBe('system');
    prefs.setTheme('dark');
    expect(prefs.theme()).toBe('dark');
    http.verify();
  });

  it('updates locally at once and coalesces many edits into one merge-patch', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark');
    prefs.setDensity('compact');
    prefs.setPaneSize('a', 10);
    prefs.setPaneSize('b', 20);
    prefs.setPaneSize('a', 30);
    prefs.setEditingLocale('acme', 'de');
    prefs.setGridColumns('acme', 'ds-1', ['x']);
    expect(prefs.theme()).toBe('dark');
    expect(prefs.paneSize('a')).toBe(30);
    http.expectNone(URL);

    vi.advanceTimersByTime(499);
    http.expectNone(URL);
    vi.advanceTimersByTime(1);
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.headers.get('Content-Type')).toBe('application/merge-patch+json');
    expect(req.request.body).toEqual({
      theme: 'dark',
      density: 'compact',
      paneSizes: { a: 30, b: 20 },
      projects: { acme: { editingLocale: 'de', gridColumns: { 'ds-1': ['x'] } } },
    });
    answer(req);
    http.verify();
  });

  it('debounces: an edit inside the window postpones the send', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark');
    vi.advanceTimersByTime(400);
    prefs.setDensity('compact');
    vi.advanceTimersByTime(400);
    http.expectNone(URL);
    vi.advanceTimersByTime(100);
    expect(http.expectOne(URL).request.body).toEqual({ theme: 'dark', density: 'compact' });
  });

  it('sends a removed key as null', () => {
    const { prefs, http } = setup();
    prefs.setEditingLocale('acme', 'de');
    prefs.setEditingLocale('acme', null);
    expect(prefs.editingLocale('acme')).toBeNull();
    vi.advanceTimersByTime(500);
    expect(http.expectOne(URL).request.body).toEqual({ projects: { acme: { editingLocale: null } } });
  });

  it('stores a table column layout: order and hidden replace, widths merge per column', () => {
    const { prefs, http } = setup();
    expect(prefs.tableColumns('pages')).toEqual({});

    prefs.setTableColumns('pages', { order: ['name', 'status'], hidden: ['status'], widths: { name: 240 } });
    prefs.setTableColumns('pages', { hidden: [], widths: { status: 96 } });

    expect(prefs.tableColumns('pages')).toEqual({ order: ['name', 'status'], hidden: [], widths: { name: 240, status: 96 } });
    vi.advanceTimersByTime(500);
    expect(http.expectOne(URL).request.body).toEqual({
      tableColumns: { pages: { order: ['name', 'status'], hidden: [], widths: { name: 240, status: 96 } } },
    });
  });

  it('forgets a table column layout with null', () => {
    const { prefs, http } = setup();
    prefs.setTableColumns('pages', { hidden: ['status'] });
    vi.advanceTimersByTime(500);
    answer(http.expectOne(URL));

    prefs.setTableColumns('pages', null);
    expect(prefs.tableColumns('pages')).toEqual({});
    vi.advanceTimersByTime(500);
    expect(http.expectOne(URL).request.body).toEqual({ tableColumns: { pages: null } });
  });

  it('caps recents at 20, newest first, without duplicates', () => {
    const { prefs } = setup();
    for (let i = 0; i < 25; i++) {
      prefs.addRecent('acme', { kind: 'page', uuid: `u${i}`, at: 't' });
    }
    prefs.addRecent('acme', { kind: 'page', uuid: 'u10', at: 't2' });
    const recents = prefs.recents('acme');
    expect(recents).toHaveLength(20);
    expect(recents[0]).toMatchObject({ uuid: 'u10', at: 't2' });
    expect(recents.filter((r) => r.uuid === 'u10')).toHaveLength(1);
  });

  it('sends an edit made during a request in a follow-up request, and keeps it locally meanwhile', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark');
    vi.advanceTimersByTime(500);
    const first = http.expectOne(URL);

    prefs.setDensity('compact');
    vi.advanceTimersByTime(5000);
    http.expectNone(URL); // one request in flight
    answer(first); // the server's answer does not know about density yet
    expect(prefs.density()).toBe('compact');

    const second = http.expectOne(URL);
    expect(second.request.body).toEqual({ density: 'compact' });
    answer(second, { schemaVersion: 1, theme: 'dark' });
    expect(prefs.theme()).toBe('dark');
    http.verify();
  });

  it('retries a failed patch with backoff and never loses keys, including ones set meanwhile', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark');
    vi.advanceTimersByTime(500);
    const first = http.expectOne(URL);
    prefs.setDensity('compact'); // during the request
    first.flush('boom', { status: 500, statusText: 'Server Error' });

    prefs.setPaneSize('p', 5); // during the backoff
    vi.advanceTimersByTime(999);
    http.expectNone(URL);
    vi.advanceTimersByTime(1);
    const retry = http.expectOne(URL);
    expect(retry.request.body).toEqual({ theme: 'dark', density: 'compact', paneSizes: { p: 5 } });

    // a second failure backs off longer, and a newer value of the same key wins
    prefs.setTheme('light');
    retry.error(new ProgressEvent('error'));
    vi.advanceTimersByTime(1999);
    http.expectNone(URL);
    vi.advanceTimersByTime(1);
    const again = http.expectOne(URL);
    expect(again.request.body).toEqual({ theme: 'light', density: 'compact', paneSizes: { p: 5 } });
    answer(again);
    expect(prefs.theme()).toBe('light');
    http.verify();
  });

  it('drops a patch the server refuses for good (422) instead of retrying it forever', () => {
    const { prefs, http } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    prefs.setTheme('dark');
    vi.advanceTimersByTime(500);
    http.expectOne(URL).flush({ code: 'SF-DOM-0134' }, { status: 422, statusText: 'Unprocessable' });
    vi.advanceTimersByTime(60000);
    http.expectNone(URL);
    prefs.setDensity('compact');
    vi.advanceTimersByTime(500);
    expect(http.expectOne(URL).request.body).toEqual({ density: 'compact' });
    warn.mockRestore();
  });

  it('merges the server document under edits that are not flushed yet', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark'); // pending
    prefs.load();
    http.expectOne(`${URL}`).flush({ schemaVersion: 1, theme: 'light', density: 'compact', railCollapsed: true });
    expect(prefs.theme()).toBe('dark');
    expect(prefs.density()).toBe('compact');
    expect(prefs.railCollapsed()).toBe(true);
    expect(prefs.loaded()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(http.expectOne(URL).request.body).toEqual({ theme: 'dark' });
  });

  it('merges the server document under a patch that is in flight', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark');
    vi.advanceTimersByTime(500);
    const patch = http.expectOne(URL);
    prefs.load();
    http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1, theme: 'light' });
    expect(prefs.theme()).toBe('dark');
    answer(patch);
  });

  it('resets to the defaults and ignores answers of the old session', () => {
    const { prefs, http } = setup();
    prefs.setTheme('dark');
    vi.advanceTimersByTime(500);
    const inFlight = http.expectOne(URL);
    prefs.setDensity('comfortable');
    prefs.reset();
    expect(prefs.theme()).toBe('system');
    expect(prefs.density()).toBe('compact');
    inFlight.flush({ schemaVersion: 1, theme: 'dark' });
    vi.advanceTimersByTime(60000);
    http.expectNone(URL);
    expect(prefs.theme()).toBe('system');
  });

  describe('localStorage migration', () => {
    function seedLegacy(): void {
      localStorage.setItem('sf-nav-rail-expanded', '0');
      localStorage.setItem('sf-theme', 'dark');
      localStorage.setItem('sf-editor-split-ratio', '0.35');
      localStorage.setItem('sf-record-grid-hidden:acme:ds-1', JSON.stringify(['a', 'b']));
      localStorage.setItem('sf-issues-scopes', JSON.stringify(['page', 'media']));
      localStorage.setItem('sf-preview-view', 'published');
      localStorage.setItem('sf.editingLocale.acme', 'de');
      localStorage.setItem('sf-section-collapsed-x-y', '1'); // out of scope: untouched
      localStorage.setItem('unrelated', 'keep');
    }

    const migrated = {
      railCollapsed: true,
      theme: 'dark',
      paneSizes: { 'page-editor-split': 0.35 },
      issueScopes: ['page', 'media'],
      previewView: 'published',
      projects: { acme: { gridColumns: { 'ds-1': ['a', 'b'] }, editingLocale: 'de' } },
    };

    it('sends one patch for the keys the server lacks and leaves the localStorage keys in place by default', () => {
      seedLegacy();
      const { prefs, http } = setup(false);
      prefs.load();
      http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1, density: 'compact' });
      const req = http.expectOne({ method: 'PATCH', url: URL });
      expect(req.request.body).toEqual(migrated);
      expect(prefs.railCollapsed()).toBe(true);
      expect(prefs.gridColumns('acme', 'ds-1')).toEqual(['a', 'b']);
      expect(prefs.editingLocale('acme')).toBe('de');
      answer(req, { schemaVersion: 1, density: 'compact' });
      expect(localStorage.getItem('sf-theme')).toBe('dark');
      expect(localStorage.getItem('sf-nav-rail-expanded')).toBe('0');

      // second run: the server has everything now, nothing is sent
      prefs.reset();
      prefs.load();
      http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1, density: 'compact', ...migrated });
      vi.advanceTimersByTime(60000);
      http.expectNone(URL);
    });

    it('never overrides what the server already has', () => {
      seedLegacy();
      const { prefs, http } = setup(false);
      prefs.load();
      http
        .expectOne({ method: 'GET', url: URL })
        .flush({ schemaVersion: 1, theme: 'light', projects: { acme: { editingLocale: 'fr' } } });
      const body = http.expectOne({ method: 'PATCH', url: URL }).request.body as Record<string, unknown>;
      expect(body['theme']).toBeUndefined();
      expect(body['projects']).toEqual({ acme: { gridColumns: { 'ds-1': ['a', 'b'] } } });
      expect(prefs.theme()).toBe('light');
      expect(prefs.editingLocale('acme')).toBe('fr');
    });

    it('removes the migrated keys only after the PATCH succeeded, when removal is on, and is a no-op afterwards', () => {
      seedLegacy();
      const { prefs, http } = setup(true);
      prefs.load();
      http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1 });
      const req = http.expectOne({ method: 'PATCH', url: URL });
      expect(localStorage.getItem('sf-theme')).toBe('dark'); // not yet

      req.flush('boom', { status: 500, statusText: 'Server Error' });
      expect(localStorage.getItem('sf-theme')).toBe('dark'); // a failure keeps them
      vi.advanceTimersByTime(1000);
      answer(http.expectOne({ method: 'PATCH', url: URL }));

      for (const key of [
        'sf-nav-rail-expanded',
        'sf-theme',
        'sf-editor-split-ratio',
        'sf-record-grid-hidden:acme:ds-1',
        'sf-issues-scopes',
        'sf-preview-view',
        'sf.editingLocale.acme',
      ]) {
        expect(localStorage.getItem(key), key).toBeNull();
      }
      expect(localStorage.getItem('sf-section-collapsed-x-y')).toBe('1');
      expect(localStorage.getItem('unrelated')).toBe('keep');

      prefs.reset();
      prefs.load();
      http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1, ...migrated });
      vi.advanceTimersByTime(60000);
      http.expectNone(URL);
    });

    it('removes keys whose values the server already holds, when removal is on', () => {
      localStorage.setItem('sf-theme', 'dark');
      const { prefs, http } = setup(true);
      prefs.load();
      http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1, theme: 'light' });
      expect(localStorage.getItem('sf-theme')).toBeNull();
      http.expectNone(URL);
    });

    it('ignores malformed legacy values', () => {
      localStorage.setItem('sf-theme', 'purple');
      localStorage.setItem('sf-issues-scopes', '{not json');
      localStorage.setItem('sf-editor-split-ratio', 'abc');
      localStorage.setItem('sf-nav-rail-expanded', 'maybe');
      const { prefs, http } = setup(true);
      prefs.load();
      http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1 });
      http.expectNone(URL);
      expect(localStorage.getItem('sf-theme')).toBe('purple');
    });
  });
});

describe('providePreferencesSync', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferencesSync()],
    });
  });

  it('loads when the auth store gets a user and resets on logout', () => {
    const auth = TestBed.inject(AuthStore);
    const prefs = TestBed.inject(PreferencesService);
    const http = TestBed.inject(HttpTestingController);
    TestBed.flushEffects();
    http.expectNone(URL);

    auth.setUser({ id: 7, username: 'ada' });
    TestBed.flushEffects();
    http.expectOne({ method: 'GET', url: URL }).flush({ schemaVersion: 1, theme: 'dark' });
    expect(prefs.theme()).toBe('dark');

    auth.clear();
    TestBed.flushEffects();
    expect(prefs.theme()).toBe('system');
    expect(prefs.loaded()).toBe(false);
  });

  it('reloads for a different user', () => {
    const auth = TestBed.inject(AuthStore);
    const prefs = TestBed.inject(PreferencesService);
    const http = TestBed.inject(HttpTestingController);
    auth.setUser({ id: 1, username: 'a' });
    TestBed.flushEffects();
    http.expectOne(URL).flush({ schemaVersion: 1, theme: 'dark' });
    auth.setUser({ id: 2, username: 'b' });
    TestBed.flushEffects();
    expect(prefs.theme()).toBe('system');
    http.expectOne(URL).flush({ schemaVersion: 1, theme: 'light' });
    expect(prefs.theme()).toBe('light');
  });
});
