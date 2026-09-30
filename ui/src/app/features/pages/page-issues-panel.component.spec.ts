import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { CHECK_DEBOUNCE_MS, PageIssuesPanelComponent } from './page-issues-panel.component';
import type { IssueTarget } from './page-issues.util';

type S = components['schemas'];

const CHECK_URL = '/api/v1/projects/proj1/preview/pages/page-1/checks';

/** The locale configuration as `GET /projects/{key}/locales` answers it. */
const LOCALES: S['ProjectLocalesView'] = {
  locales: [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
  ],
  defaultLocale: 'de',
  fallbacks: {},
};

/** `PageView.issues` as the page endpoints send them. */
const COMPLETENESS: S['ContentIssue'][] = [
  { path: 'content.title', code: 'required', severity: 'ERROR', message: 'Title is required.', kind: 'COMPLETENESS' },
];

/** A draft check response shaped like `DraftCheckView` (M30.3.1). */
const RESULT: S['DraftCheckView'] = {
  completeness: COMPLETENESS,
  findings: [
    {
      code: 'SF-CHK-0301',
      name: 'Image without alt attribute',
      category: 'ACCESSIBILITY',
      severity: 'WARNING',
      fixHint: 'CONTENT_OR_TEMPLATE',
      message: 'Image without alt attribute: media "Logo" (media/logo.png).',
      selector: 'body > main > figure > img',
      sectionInstanceId: 'sec-2',
      editorPath: 'bodies.main[1].content.image',
    },
    {
      code: 'SF-CHK-0101',
      name: 'Link to a missing page or file',
      category: 'LINKS',
      severity: 'ERROR',
      fixHint: 'CONTENT_OR_TEMPLATE',
      message: "Link to 'gone.html' (gone.html): no page or file of this build is there.",
      selector: 'body > main > figure > a:nth-of-type(1)',
      sectionInstanceId: 'sec-2',
    },
    {
      code: 'SF-CHK-0201',
      name: 'Missing or empty <title>',
      category: 'SEO',
      severity: 'WARNING',
      fixHint: 'TEMPLATE',
      message: 'The page has no <title>.',
    },
  ],
  checkedChannel: 'html',
  checkedLocale: 'de',
  checkedPage: 1,
  skippedRules: ['SF-CHK-0205', 'SF-CHK-0107'],
};

describe('PageIssuesPanelComponent', () => {
  let fixture: ComponentFixture<PageIssuesPanelComponent>;
  let httpMock: HttpTestingController;
  let selected: IssueTarget[];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [PageIssuesPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(LocalesStore).set('proj1', LOCALES);
    fixture = TestBed.createComponent(PageIssuesPanelComponent);
    fixture.componentRef.setInput('projectKey', 'proj1');
    fixture.componentRef.setInput('pageUuid', 'page-1');
    fixture.componentRef.setInput('refreshKey', 1);
    fixture.componentRef.setInput('completeness', COMPLETENESS);
    selected = [];
    fixture.componentInstance.issueSelect.subscribe((target) => selected.push(target));
    render();
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
    localStorage.clear();
  });

  function render(): void {
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
  }

  /** Lets the debounce run out and returns the one check it sent. */
  function nextCheck(): TestRequest {
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS);
    return httpMock.expectOne((req) => req.url === CHECK_URL);
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function items(): HTMLButtonElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.issues__item'));
  }

  function checked(): void {
    const req = nextCheck();
    req.flush(RESULT);
    render();
  }

  it('checks the draft after the debounce, in the editing language, and says so', () => {
    vi.advanceTimersByTime(CHECK_DEBOUNCE_MS - 1);
    httpMock.expectNone(CHECK_URL);
    render();
    expect(text()).toContain('Checking…');

    const req = nextCheck();
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('channel')).toBe('html');
    expect(req.request.params.get('locale')).toBe('de');
    expect(req.request.params.has('revision')).toBe(false);
    req.flush(RESULT);
    render();

    expect(text()).toMatch(/checked at \d{1,2}:\d{2}/);
  });

  it('groups content and output issues, errors first, and counts them all in the header', () => {
    checked();

    const lists = (fixture.nativeElement as HTMLElement).querySelectorAll('.issues__list');
    expect(lists[0].getAttribute('aria-label')).toBe('Content issues');
    expect(lists[0].textContent).toContain('content.title');
    expect(lists[0].textContent).toContain('Title is required.');
    const output = Array.from(lists[1].querySelectorAll('.issues__rule')).map((rule) => rule.textContent?.trim());
    expect(output).toEqual(['Link to a missing page or file', 'Image without alt attribute', 'Missing or empty <title>']);
    expect(lists[1].textContent).toContain('Fix in content or template');
    expect(lists[1].textContent).toContain('Fix in template');
    const count = (fixture.nativeElement as HTMLElement).querySelector('.issues__count');
    expect(count?.textContent?.trim()).toBe('4');
    expect(count?.classList).toContain('issues__count--error');
    expect(text()).toContain('SF-CHK-0205, SF-CHK-0107');
  });

  it('checks again after each completed autosave, once for a burst of saves, and cancels a check that is overtaken', () => {
    checked();

    fixture.componentRef.setInput('refreshKey', 2);
    render();
    const overtaken = nextCheck();
    fixture.componentRef.setInput('refreshKey', 3);
    render();
    vi.advanceTimersByTime(100);
    fixture.componentRef.setInput('refreshKey', 4);
    render();
    const latest = nextCheck();

    expect(overtaken.cancelled).toBe(true);
    latest.flush({ ...RESULT, findings: [] });
    render();
    expect(text()).toContain('No problems found in the draft.');
  });

  it('checks again in the new language when the editing language switches', () => {
    checked();

    TestBed.inject(EditingLocaleStore).set('proj1', 'en');
    render();

    expect(nextCheck().request.params.get('locale')).toBe('en');
  });

  it('checks the drafts at the revision while time travelling', () => {
    checked();

    fixture.componentRef.setInput('revision', 42);
    render();

    expect(nextCheck().request.params.get('revision')).toBe('42');
  });

  it('degrades to "Checks unavailable" on an error and can check again', () => {
    nextCheck().flush({ status: 500 }, { status: 500, statusText: 'Server Error' });
    render();

    expect(text()).toContain('Checks unavailable');
    expect(text()).toContain('content.title'); // the content issues stay
    const retry = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.issues__retry');
    retry?.click();
    nextCheck().flush(RESULT);
    render();
    expect(text()).not.toContain('Checks unavailable');
  });

  it('sends the editor to the field, the section or the element an issue points at', () => {
    checked();
    const [content, missingLink, missingAlt, noTitle] = items();

    content.click();
    missingAlt.click();
    missingLink.click();
    noTitle.click();

    expect(selected).toEqual([
      { editorPath: 'content.title', sectionInstanceId: null, selector: null },
      { editorPath: 'bodies.main[1].content.image', sectionInstanceId: 'sec-2', selector: 'body > main > figure > img' },
      { editorPath: null, sectionInstanceId: 'sec-2', selector: 'body > main > figure > a:nth-of-type(1)' },
    ]);
  });

  it('only expands an issue that points nowhere', () => {
    checked();
    const noTitle = items()[3];

    noTitle.click();
    render();

    expect(selected).toEqual([]);
    expect(noTitle.getAttribute('aria-expanded')).toBe('true');
    expect(noTitle.textContent).toContain('SF-CHK-0201');
  });

  it('notes that the checks cover the draft while the preview shows the published page', () => {
    checked();
    expect(text()).not.toContain('these checks cover the draft');

    fixture.componentRef.setInput('previewView', 'published');
    render();

    expect(text()).toContain('The preview shows the published page; these checks cover the draft.');
  });

  it('orders rule findings by level, lists infos without counting them and leaves hints to the fields (M33.8)', () => {
    fixture.componentRef.setInput('completeness', [
      { path: 'content.teaser', code: 'rule', severity: 'INFO', message: 'No teaser yet.', kind: 'COMPLETENESS', rule: 'teaser' },
      { path: 'content.slug', code: 'rule', severity: 'HINT', message: 'Keep slugs short.', kind: 'COMPLETENESS', rule: 'slug' },
      { path: 'content.title', code: 'rule', severity: 'WARNING', message: 'Long title.', kind: 'COMPLETENESS', rule: 'short' },
      ...COMPLETENESS,
    ]);
    render();
    const req = nextCheck();
    req.flush({ ...RESULT, completeness: undefined, findings: [] });
    render();

    const labels = items().map((item) => item.querySelector('.issues__severity')?.textContent?.trim());
    expect(labels).toEqual(['Error', 'Warning', 'Info']);
    expect(text()).not.toContain('Keep slugs short.');
    const count = (fixture.nativeElement as HTMLElement).querySelector('.issues__count')?.textContent?.trim();
    expect(count).toBe('2');
  });

  it('filters by scope chips, remembers the choice and keeps one chip on (M33)', () => {
    fixture.componentRef.setInput('completeness', [
      { path: 'content.slug', code: 'rule', severity: 'ERROR', message: 'Slug taken.', kind: 'COMPLETENESS', scopes: ['SAVE'] },
      { path: 'content.title', code: 'required', severity: 'ERROR', message: 'Title is required.', kind: 'COMPLETENESS', scopes: ['EDIT', 'RELEASE', 'GENERATION'] },
    ]);
    render();
    nextCheck().flush({ ...RESULT, completeness: undefined });
    render();
    const chip = (label: string) =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.issues__scope')).find(
        (button) => button.textContent?.trim() === label,
      )!;
    expect(text()).toContain('Slug taken.');
    expect(text()).toContain('Image without alt attribute');

    chip('Save').click();
    chip('Generation').click();
    render();
    expect(chip('Save').getAttribute('aria-pressed')).toBe('false');
    expect(text()).not.toContain('Slug taken.');
    expect(text()).toContain('Title is required.');
    // Output findings are what a build reports: hidden with the generation scope.
    expect(text()).not.toContain('Image without alt attribute');
    expect(JSON.parse(localStorage.getItem('sf-issues-scopes')!)).toEqual(['EDIT', 'RELEASE']);

    chip('Edit').click();
    chip('Release').click();
    render();
    expect(chip('Release').getAttribute('aria-pressed')).toBe('true');
  });
});
