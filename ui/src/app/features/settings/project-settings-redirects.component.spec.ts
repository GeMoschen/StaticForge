import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ProjectSettingsRedirectsComponent } from './project-settings-redirects.component';

type RedirectPageView = components['schemas']['RedirectPageView'];
type ChannelView = components['schemas']['ChannelView'];
type ProjectLocalesView = components['schemas']['ProjectLocalesView'];

const BASE = '/api/v1/projects/proj';

const CHANNELS: ChannelView[] = [{ key: 'html', name: 'Website', fileExtension: 'html', isDefault: true, enabled: true }];
const LOCALES: ProjectLocalesView = {
  locales: [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
  ],
  defaultLocale: 'de',
};

// Rows as RedirectController#listRedirects sends them (RedirectView): states against the default target's run 9.
const PAGE: RedirectPageView = {
  rows: [
    {
      id: 1,
      channel: 'html',
      locale: 'de',
      fromPath: 'produkte/hammer.html',
      toAssetUuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01',
      toPageNumber: 1,
      toAssetName: 'Hammer',
      kind: 'AUTO',
      state: 'ACTIVE',
      resolvedTarget: 'werkzeug/hammer.html',
      createdAt: '2026-09-20T08:00:00Z',
      sourceRunId: 5,
      updatedAt: '2026-09-20T08:00:00Z',
      version: 0,
    },
    {
      id: 2,
      channel: 'html',
      locale: 'de',
      fromPath: 'alt/index.html',
      toPath: 'https://example.org/neu',
      kind: 'MANUAL',
      state: 'SHADOWED',
      resolvedTarget: 'https://example.org/neu',
      createdAt: '2026-09-21T08:00:00Z',
      createdBy: 2,
      updatedAt: '2026-09-21T08:00:00Z',
      updatedBy: 2,
      version: 3,
    },
    {
      id: 3,
      channel: 'html',
      locale: 'en',
      fromPath: 'gone.html',
      toAssetUuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a02',
      toPageNumber: 2,
      kind: 'MANUAL',
      state: 'DANGLING',
      createdAt: '2026-09-22T08:00:00Z',
      createdBy: 2,
      version: 0,
    },
    {
      id: 4,
      channel: 'html',
      locale: 'en',
      fromPath: 'loop.html',
      toPath: 'loop2.html',
      kind: 'MANUAL',
      state: 'LOOP',
      resolvedTarget: 'loop2.html',
      createdAt: '2026-09-23T08:00:00Z',
      createdBy: 2,
      version: 1,
    },
  ],
  page: 0,
  size: 50,
  totalElements: 4,
  totalPages: 1,
  basisRunId: 9,
};

interface Setup {
  role?: string;
  readOnly?: boolean;
  query?: Record<string, string>;
}

describe('ProjectSettingsRedirectsComponent', () => {
  let fixture: ComponentFixture<ProjectSettingsRedirectsComponent>;
  let http: HttpTestingController;

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  function setup({ role = 'DEVELOPER', readOnly = false, query = {} }: Setup = {}): void {
    TestBed.configureTestingModule({
      imports: [ProjectSettingsRedirectsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideProjectPermissions({ role: () => role, readOnly: () => readOnly }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectSettingsRedirectsComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    for (const [key, value] of Object.entries(query)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush([{ userId: 2, username: 'ana', displayName: 'Ana Lopez' }]);
    http.expectOne(`${BASE}/locales`).flush(LOCALES);
    http.expectOne(`${BASE}/channels`).flush(CHANNELS);
    fixture.detectChanges();
  }

  function flushList(page: RedirectPageView = PAGE) {
    const request = http.expectOne((r) => r.url === `${BASE}/redirects`);
    const params = request.request.params;
    request.flush(page);
    fixture.detectChanges();
    return params;
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function buttons(label: string): HTMLButtonElement[] {
    return Array.from(el().querySelectorAll('button')).filter((b) => b.textContent?.trim() === label);
  }

  it('lists each redirect with its target, kind, origin and state — the state explained in a tooltip', () => {
    setup();
    flushList();
    const rows = Array.from(el().querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(4);

    const [auto, shadowed, dangling, loop] = rows as HTMLElement[];
    expect(auto.textContent).toContain('produkte/hammer.html');
    expect(auto.textContent).toContain('Hammer');
    expect(auto.textContent).toContain('werkzeug/hammer.html');
    expect(auto.textContent).toContain('Automatic');
    const runLink = auto.querySelector('a') as HTMLAnchorElement;
    expect(runLink.textContent?.trim()).toBe('from run #5');
    expect(runLink.getAttribute('href')).toBe('/p/proj/settings/generation?run=5');

    expect(shadowed.textContent).toContain('https://example.org/neu');
    expect(shadowed.textContent).toContain('Manual');
    expect(shadowed.textContent).toContain('by Ana Lopez');
    // A target page without a current name is gone; page 2 is named.
    expect(dangling.textContent).toContain('Deleted page (page 2)');

    const states = rows.map((row) => row.querySelector('.redirects__state') as HTMLElement);
    expect(states.map((s) => s.textContent?.trim())).toEqual(['Active', 'Shadowed', 'Dangling', 'Loop']);
    expect(states[1].getAttribute('title')).toContain('published at the old path');
    expect(states[3].getAttribute('title')).toContain('leads back to its own path');
    expect(states[2].getAttribute('aria-label')).toMatch(/^Dangling: The target page has no output/);
    expect(loop.textContent).toContain('EN');

    // The run the states belong to.
    expect(el().querySelector('.redirects__hint a')?.getAttribute('href')).toBe('/p/proj/settings/generation?run=9');
  });

  it('shows "Not built" while the default target has no build', () => {
    setup();
    flushList({ ...PAGE, basisRunId: undefined, rows: [{ ...PAGE.rows![1], state: undefined, resolvedTarget: undefined }] });
    expect(el().querySelector('.redirects__state')?.textContent?.trim()).toBe('Not built');
    expect(el().textContent).toContain('Nothing is published on the default target yet');
  });

  it('reads the filters from the URL, sends them, shows them as chips and writes changes back to the URL', () => {
    setup({ query: { channel: 'html', locale: 'en', kind: 'MANUAL', state: 'SHADOWED', q: 'alt', page: '2' } });
    const params = flushList({ ...PAGE, rows: [PAGE.rows![1]], totalElements: 1, page: 2 });
    expect(params.get('channel')).toBe('html');
    expect(params.get('locale')).toBe('en');
    expect(params.get('kind')).toBe('MANUAL');
    expect(params.get('state')).toBe('SHADOWED');
    expect(params.get('q')).toBe('alt');
    expect(params.get('page')).toBe('2');
    expect(params.get('size')).toBe('50');

    const chips = Array.from(el().querySelectorAll('.redirects__chip')).map((chip) => chip.getAttribute('aria-label'));
    expect(chips).toEqual([
      'Remove filter Channel: Website',
      'Remove filter Language: EN',
      'Remove filter Kind: Manual',
      'Remove filter State: Shadowed',
      'Remove filter Path contains “alt”',
    ]);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el().querySelectorAll('.redirects__chip')[3] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
      queryParams: { state: null, page: null },
      queryParamsHandling: 'merge',
    }));

    const stateSelect = Array.from(el().querySelectorAll('select')).find((s) =>
      Array.from(s.options).some((o) => o.value === 'LOOP'),
    ) as HTMLSelectElement;
    stateSelect.value = 'LOOP';
    stateSelect.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { state: 'LOOP', page: null } }));

    const text = el().querySelector('input[type="search"]') as HTMLInputElement;
    text.value = ' hammer ';
    text.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { q: 'hammer', page: null } }));

    // The URL changed (the router binds it to the inputs): the list is read again with the new filter.
    fixture.componentRef.setInput('state', 'LOOP');
    fixture.detectChanges();
    expect(flushList().get('state')).toBe('LOOP');
  });

  it('is read-only for editors, and for developers during time travel or in an archived project', () => {
    setup({ role: 'EDITOR' });
    flushList();
    expect(buttons('Add redirect')).toHaveLength(0);
    expect(buttons('Edit')).toHaveLength(0);
    expect(buttons('Delete')).toHaveLength(0);
    http.verify();

    TestBed.resetTestingModule();
    setup({ role: 'DEVELOPER', readOnly: true });
    flushList();
    expect(buttons('Add redirect')).toHaveLength(0);
    expect(buttons('Edit')).toHaveLength(0);
    expect(buttons('Delete')).toHaveLength(0);
  });

  it('lets developers add, edit and delete', () => {
    setup();
    flushList();
    expect(buttons('Add redirect')).toHaveLength(1);
    expect(buttons('Edit')).toHaveLength(4);
    expect(buttons('Delete')).toHaveLength(4);

    buttons('Add redirect')[0].click();
    fixture.detectChanges();
    expect(el().querySelector('sf-redirect-dialog [role="dialog"]')?.getAttribute('aria-label')).toBe('Add redirect');
  });

  it('deletes with the version it read; a stale version offers to reload the list', () => {
    setup();
    flushList();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    buttons('Delete')[1].click();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('alt/index.html'));
    const request = http.expectOne({ method: 'DELETE', url: `${BASE}/redirects/2` });
    expect(request.request.headers.get('If-Match')).toBe('"v3"');
    request.flush(
      { status: 409, code: 'SF-API-0409', detail: 'The redirect was changed by someone else (version 4); reload it.' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(el().querySelector('.redirects__conflict')?.textContent).toContain('Someone changed the redirect from “alt/index.html”');

    buttons('Reload')[0].click();
    fixture.detectChanges();
    flushList();
    expect(el().querySelector('.redirects__conflict')).toBeNull();

    // A successful delete re-reads the page.
    buttons('Delete')[0].click();
    http.expectOne({ method: 'DELETE', url: `${BASE}/redirects/1` }).flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    flushList();
  });
});
