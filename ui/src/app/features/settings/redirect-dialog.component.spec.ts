import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { RedirectDialogComponent } from './redirect-dialog.component';

/** Chooses a row of the asset picker (it lives in the page body, as a dialog does) by double click. */
function pickRow(name: string): void {
  const row = Array.from(document.querySelectorAll('.picker__row')).find((r) => r.textContent?.includes(name)) as HTMLElement;
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

type ChannelView = components['schemas']['ChannelView'];
type ProjectLocaleView = components['schemas']['ProjectLocaleView'];
type RedirectView = components['schemas']['RedirectView'];
type PageAssetSummaryView = components['schemas']['PageAssetSummaryView'];

const BASE = '/api/v1/projects/proj';

const CHANNELS: ChannelView[] = [
  { key: 'html', name: 'Website', fileExtension: 'html', isDefault: true, enabled: true },
  {
    key: 'web',
    name: 'Pretty',
    fileExtension: 'htm',
    enabled: true,
    settings: { indexFileName: 'default.htm' } as unknown as ChannelView['settings'],
  },
];
const LOCALES: ProjectLocaleView[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
];

// A manual redirect as RedirectController#redirect sends it.
const EXISTING: RedirectView = {
  id: 2,
  channel: 'html',
  locale: 'en',
  fromPath: 'old/index.html',
  toAssetUuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a01',
  toPageNumber: 1,
  toAssetName: 'Hammer',
  kind: 'MANUAL',
  state: 'ACTIVE',
  resolvedTarget: 'tools/hammer.html',
  createdAt: '2026-09-21T08:00:00Z',
  createdBy: 2,
  version: 3,
};

// The page picker's listing (GET /assets?type=PAGE) as AssetController sends it.
const PAGES: PageAssetSummaryView = {
  content: [
    { uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a09', uid: 'saw', type: 'PAGE', displayName: 'Saw', folderPath: '/tools/' },
  ],
  totalElements: 1,
  totalPages: 1,
};

describe('RedirectDialogComponent', () => {
  let fixture: ComponentFixture<RedirectDialogComponent>;
  let http: HttpTestingController;
  let saved: RedirectView[];
  let closed: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RedirectDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function open(redirect: RedirectView | null): void {
    fixture = TestBed.createComponent(RedirectDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('redirect', redirect);
    fixture.componentRef.setInput('channels', CHANNELS);
    fixture.componentRef.setInput('locales', LOCALES);
    fixture.componentRef.setInput('defaultLocale', 'de');
    saved = [];
    closed = 0;
    fixture.componentInstance.saved.subscribe((view) => saved.push(view));
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
    if (!found) {
      throw new Error(`No button "${label}"`);
    }
    return found;
  }

  function type(placeholderStart: string, value: string): void {
    const input = el().querySelector(`input[placeholder^="${placeholderStart}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function select(index: number, value: string): void {
    const control = el().querySelectorAll('select')[index] as HTMLSelectElement;
    control.value = value;
    control.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function pickPage(name: string): void {
    button(el().textContent?.includes('Change page…') ? 'Change page…' : 'Choose page…').click();
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${BASE}/assets` && r.params.get('type') === 'PAGE').flush(PAGES);
    fixture.detectChanges();
    pickRow(name);
    fixture.detectChanges();
  }

  it('adds a redirect: shows the old path as it will be saved and sends the normalized paths', () => {
    open(null);
    expect(button('Save').disabled).toBe(true);
    type('/old/', '/alt/seite/');
    expect(el().querySelector('.redirect__normalized')?.textContent).toContain('alt/seite/index.html');

    // The index file name follows the channel.
    select(0, 'web');
    expect(el().querySelector('.redirect__normalized')?.textContent).toContain('alt/seite/default.htm');
    select(0, 'html');

    // A path the server would refuse is explained before saving.
    type('/old/', '/alt/../x.html');
    expect(el().querySelector('.redirect__invalid')?.textContent).toContain('..');
    expect(button('Save').disabled).toBe(true);
    type('/old/', '/alt/seite/');

    pickPage('Saw');
    expect(el().querySelector('.redirect__page')?.textContent?.trim()).toBe('Saw');
    button('Save').click();
    const request = http.expectOne({ method: 'POST', url: `${BASE}/redirects` });
    expect(request.request.body).toEqual({
      channel: 'html',
      locale: 'de',
      fromPath: 'alt/seite/index.html',
      toAssetUuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a09',
      toPageNumber: 1,
    });
    request.flush({ ...EXISTING, id: 7, fromPath: 'alt/seite/index.html' });
    expect(saved.map((view) => view.id)).toEqual([7]);
    expect(closed).toBe(1);
  });

  it('adds a redirect to a path or URL and shows the server’s refusal', () => {
    open(null);
    type('/old/', 'old.html');
    (el().querySelector('input[type="radio"][value="path"]') as HTMLInputElement).click();
    fixture.detectChanges();
    type('/new/', 'https://example.org/neu#top');
    expect(el().querySelectorAll('.redirect__normalized')[1]?.textContent).toContain('https://example.org/neu#top');
    button('Save').click();
    const request = http.expectOne({ method: 'POST', url: `${BASE}/redirects` });
    expect(request.request.body).toEqual({ channel: 'html', locale: 'de', fromPath: 'old.html', toPath: 'https://example.org/neu#top' });
    request.flush(
      { status: 409, code: 'SF-DOM-0191', detail: "'old.html' already redirects (html, de)." },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(el().querySelector('.redirect__error')?.textContent).toContain('already redirects');
    expect(el().querySelector('.redirect__conflict')).toBeNull();
    expect(closed).toBe(0);
  });

  it('edits with If-Match; Save waits for a change', () => {
    open(EXISTING);
    expect(el().querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Edit redirect');
    expect((el().querySelectorAll('select')[1] as HTMLSelectElement).value).toBe('en');
    expect(el().querySelector('.redirect__page')?.textContent?.trim()).toBe('Hammer');
    expect(button('Save').disabled).toBe(true);

    type('/old/', '/older/');
    button('Save').click();
    const request = http.expectOne({ method: 'PUT', url: `${BASE}/redirects/2` });
    expect(request.request.headers.get('If-Match')).toBe('"v3"');
    expect(request.request.body).toEqual({
      channel: 'html',
      locale: 'en',
      fromPath: 'older/index.html',
      toAssetUuid: EXISTING.toAssetUuid,
      toPageNumber: 1,
    });
    request.flush({ ...EXISTING, fromPath: 'older/index.html', version: 4 });
    expect(saved[0].version).toBe(4);
  });

  it('warns that saving an automatic redirect makes it manual', () => {
    open({ ...EXISTING, kind: 'AUTO', createdBy: undefined, sourceRunId: 5 });
    expect(el().querySelector('.redirect__note')?.textContent).toContain('Saving makes it manual');
  });

  it('offers to reload after a stale version, then saves against the current one', () => {
    open(EXISTING);
    type('/old/', '/older/');
    button('Save').click();
    http
      .expectOne({ method: 'PUT', url: `${BASE}/redirects/2` })
      .flush(
        { status: 409, code: 'SF-API-0409', detail: 'The redirect was changed by someone else (version 4); reload it.' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    expect(el().querySelector('.redirect__conflict')?.textContent).toContain('Someone changed this redirect');
    expect(button('Save').disabled).toBe(true);

    button('Reload').click();
    http
      .expectOne({ method: 'GET', url: `${BASE}/redirects/2` })
      .flush({ ...EXISTING, fromPath: 'elsewhere.html', toPath: 'new.html', toAssetUuid: undefined, toAssetName: undefined, version: 4 });
    fixture.detectChanges();
    expect(el().querySelector('.redirect__conflict')).toBeNull();
    expect(el().textContent).toContain('Reloaded — this is the current version.');
    expect((el().querySelector('input[placeholder^="/old/"]') as HTMLInputElement).value).toBe('elsewhere.html');
    expect((el().querySelector('input[type="radio"][value="path"]') as HTMLInputElement).checked).toBe(true);
    expect(button('Save').disabled).toBe(true);

    type('/new/', 'newer.html');
    button('Save').click();
    const retry = http.expectOne({ method: 'PUT', url: `${BASE}/redirects/2` });
    expect(retry.request.headers.get('If-Match')).toBe('"v4"');
    expect(retry.request.body).toEqual({ channel: 'html', locale: 'en', fromPath: 'elsewhere.html', toPath: 'newer.html' });
    retry.flush({ ...EXISTING, version: 5 });
    expect(closed).toBe(1);
  });
});
