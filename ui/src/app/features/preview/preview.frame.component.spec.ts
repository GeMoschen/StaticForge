import '@angular/compiler';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { LocalesStore } from '../../core/project/locales.store';
import { SfPreviewFrameComponent } from './preview.frame.component';
import { PREVIEW_VIEW_STORAGE_KEY } from './preview-view.util';

type ProjectLocalesView = components['schemas']['ProjectLocalesView'];
type PreviewShareLink = components['schemas']['PreviewShareLink'];

const PREVIEW_URL = '/api/v1/projects/proj1/preview/pages/page-1';
const SHARE_URL = '/api/v1/projects/proj1/preview/pages/page-1/share';

/** The locale configuration as `GET /projects/{key}/locales` answers it. */
const LOCALES: ProjectLocalesView = {
  locales: [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
  ],
  defaultLocale: 'de',
  fallbacks: {},
};

describe('SfPreviewFrameComponent (draft/published view)', () => {
  let fixture: ComponentFixture<SfPreviewFrameComponent>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(PREVIEW_VIEW_STORAGE_KEY);
    TestBed.configureTestingModule({
      imports: [SfPreviewFrameComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(LocalesStore).set('proj1', LOCALES);
    fixture = TestBed.createComponent(SfPreviewFrameComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('pageUuid', 'page-1');
    fixture.componentRef.setInput('refreshKey', 1);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
    localStorage.removeItem(PREVIEW_VIEW_STORAGE_KEY);
  });

  /** Lets the debounce fire and returns the one preview request it made. */
  function nextPreview(): TestRequest {
    vi.advanceTimersByTime(500);
    return httpMock.expectOne((req) => req.url === PREVIEW_URL);
  }

  function flushHtml(req: TestRequest, headers: Record<string, string> = {}): void {
    req.flush('<html><body>page</body></html>', {
      headers: new HttpHeaders({ 'X-SF-Total-Pages': '1', 'X-SF-Page': '1', ...headers }),
    });
    fixture.detectChanges();
  }

  function button(name: string): HTMLButtonElement {
    const found = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === name,
    );
    if (!found) {
      throw new Error(`No button "${name}"`);
    }
    return found;
  }

  it('renders the draft view by default and shows the release status line', () => {
    const req = nextPreview();
    expect(req.request.params.get('view')).toBe('draft');
    expect(req.request.params.get('locale')).toBe('de');
    flushHtml(req, { 'X-SF-View': 'draft', 'X-SF-Release-Status': 'CHANGED' });

    expect(fixture.nativeElement.querySelector('.preview-status')?.textContent).toContain('Draft — Changed');
    expect(button('Draft').getAttribute('aria-checked')).toBe('true');
  });

  it('switching to Published sends view=published, remembers it and hides the status line', () => {
    flushHtml(nextPreview(), { 'X-SF-View': 'draft', 'X-SF-Release-Status': 'CHANGED' });

    button('Published').click();
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url === PREVIEW_URL);
    expect(req.request.params.get('view')).toBe('published');
    flushHtml(req, { 'X-SF-View': 'published' });

    expect(localStorage.getItem(PREVIEW_VIEW_STORAGE_KEY)).toBe('published');
    expect(button('Published').getAttribute('aria-checked')).toBe('true');
    expect(fixture.nativeElement.querySelector('.preview-status')).toBeNull();
  });

  it('shows "Not published in {language}" for SF-DOM-0155 instead of an error', () => {
    flushHtml(nextPreview());
    button('Published').click();
    fixture.detectChanges();

    httpMock.expectOne((r) => r.url === PREVIEW_URL).flush(
      JSON.stringify({
        type: 'https://cms.example.com/problems/sf-dom-0155',
        title: 'Not Found',
        status: 404,
        detail: "The page isn't published in 'de'.",
        code: 'SF-DOM-0155',
      }),
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.preview-empty') as HTMLElement | null;
    expect(empty?.textContent).toContain('Not published in Deutsch');
    expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
  });

  it('refetches on a save only in the draft view', () => {
    flushHtml(nextPreview());

    fixture.componentRef.setInput('refreshKey', 2);
    fixture.detectChanges();
    flushHtml(nextPreview());

    button('Published').click();
    fixture.detectChanges();
    flushHtml(httpMock.expectOne((r) => r.url === PREVIEW_URL), { 'X-SF-View': 'published' });

    fixture.componentRef.setInput('refreshKey', 3);
    fixture.detectChanges();
    vi.advanceTimersByTime(500);
    httpMock.expectNone((r) => r.url === PREVIEW_URL);
  });

  it('share link carries the chosen view, preselected from the toggle, and says which it is', () => {
    flushHtml(nextPreview());
    button('Published').click();
    fixture.detectChanges();
    flushHtml(httpMock.expectOne((r) => r.url === PREVIEW_URL), { 'X-SF-View': 'published' });

    button('Share').click();
    fixture.detectChanges();
    const published = fixture.nativeElement.querySelector('input[name="preview-share-view"][value="published"]') as HTMLInputElement;
    expect(published.checked).toBe(true);

    button('Create link').click();
    const req = httpMock.expectOne((r) => r.url === SHARE_URL);
    expect(req.request.params.get('view')).toBe('published');
    const link: PreviewShareLink = { token: 'tok', url: '/api/v1/projects/proj1/preview/share?t=tok' };
    req.flush(link);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.preview-share__label')?.textContent).toContain('Published link');
    expect((fixture.nativeElement.querySelector('.preview-share__input') as HTMLInputElement).value).toBe(link.url);
  });

  it('share can pick the draft while the published view is shown', () => {
    flushHtml(nextPreview());
    button('Published').click();
    fixture.detectChanges();
    flushHtml(httpMock.expectOne((r) => r.url === PREVIEW_URL));

    button('Share').click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('input[name="preview-share-view"][value="draft"]') as HTMLInputElement).click();
    button('Create link').click();
    const req = httpMock.expectOne((r) => r.url === SHARE_URL);
    expect(req.request.params.get('view')).toBe('draft');
    req.flush({ token: 't', url: '/x' } satisfies PreviewShareLink);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.preview-share__label')?.textContent).toContain('Draft link');
  });
});
