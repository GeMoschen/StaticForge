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
  let summaries: { count: number; errors: number }[];

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
    fixture.componentRef.setInput('open', true);
    selected = [];
    summaries = [];
    fixture.componentInstance.issueSelect.subscribe((target) => selected.push(target));
    fixture.componentInstance.summaryChange.subscribe((summary) => summaries.push(summary));
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

  /** The drawer moves itself into `<body>`. */
  function drawer(): HTMLElement {
    return document.body.querySelector<HTMLElement>('.sf-drawer')!;
  }

  function text(): string {
    return drawer()?.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('.issues__row'));
  }

  /** The group headings, without the level icon's ligature text. */
  function headings(): string[] {
    return Array.from(document.body.querySelectorAll('.issues__group-heading')).map((h) =>
      (h.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/^[a-z_]+ /, ''),
    );
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

  it('groups content and output issues by level, errors first, with a summary and the count of each group', () => {
    checked();

    const found = headings();
    expect(found).toEqual(['Errors 2', 'Warnings 2']);
    expect(text()).toContain('2 errors');
    expect(text()).toContain('2 warnings');
    const messages = rows().map((row) => row.querySelector('.issues__message')?.textContent?.replace(/\s+/g, ' ').trim());
    expect(messages[0]).toContain('Title is required.');
    expect(messages[1]).toContain('Link to a missing page or file');
    expect(messages[2]).toContain('Image without alt attribute');
    expect(messages[3]).toContain('Missing or empty <title>');
    expect(text()).toContain('Fix in the content or the template');
    expect(text()).toContain('Fix in the template');
    expect(text()).toContain('Content rule');
    expect(text()).toContain('Output check');
    expect(text()).toContain('SF-CHK-0205, SF-CHK-0107');
    // The Issues button's count.
    expect(summaries.at(-1)).toEqual({ count: 4, errors: 2 });
  });

  it('says where an issue points, in words, and shows the check code in developer mode only', () => {
    fixture.componentRef.setInput('describe', (target: IssueTarget) =>
      target.editorPath === 'content.title' ? 'Page fields › Title' : target.sectionInstanceId === 'sec-2' ? 'Hero › Image' : null,
    );
    checked();

    expect(text()).toContain('Page fields › Title');
    expect(text()).toContain('Hero › Image');
    expect(document.body.querySelector('.issues__code')).toBeNull();

    fixture.componentRef.setInput('devMode', true);
    render();
    expect(Array.from(document.body.querySelectorAll('.issues__code')).map((code) => code.textContent)).toEqual([
      'required',
      'SF-CHK-0101',
      'SF-CHK-0301',
      'SF-CHK-0201',
    ]);
  });

  it('reports the count while the drawer is closed, and shows no drawer', () => {
    fixture.componentRef.setInput('open', false);
    render();
    expect(document.body.querySelector('.sf-drawer')).toBeNull();

    checked();

    expect(summaries.at(-1)).toEqual({ count: 4, errors: 2 });
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
    // Only the content finding is left.
    expect(summaries.at(-1)).toEqual({ count: 1, errors: 1 });
  });

  it('shows the empty state when nothing is wrong', () => {
    fixture.componentRef.setInput('completeness', []);
    render();
    nextCheck().flush({ ...RESULT, completeness: [], findings: [] });
    render();

    expect(text()).toContain('No issues');
    expect(summaries.at(-1)).toEqual({ count: 0, errors: 0 });
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
    expect(text()).toContain('Title is required.'); // the content issues stay
    const retry = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Check again');
    retry?.click();
    nextCheck().flush(RESULT);
    render();
    expect(text()).not.toContain('Checks unavailable');
  });

  it('sends the editor to the field, the section or the element an issue points at (Go to it)', () => {
    checked();
    const [content, missingLink, missingAlt, noTitle] = rows();

    content.click();
    missingAlt.click();
    missingLink.click();
    // A finding about the whole page points nowhere: nothing to click.
    expect(noTitle.disabled).toBe(true);
    noTitle.click();

    expect(selected).toEqual([
      { editorPath: 'content.title', sectionInstanceId: null, selector: null },
      { editorPath: 'bodies.main[1].content.image', sectionInstanceId: 'sec-2', selector: 'body > main > figure > img' },
      { editorPath: null, sectionInstanceId: 'sec-2', selector: 'body > main > figure > a:nth-of-type(1)' },
    ]);
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

    const found = headings();
    expect(found).toEqual(['Errors 1', 'Warnings 1', 'Info 1']);
    expect(text()).not.toContain('Keep slugs short.');
    expect(summaries.at(-1)).toEqual({ count: 2, errors: 1 });
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
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('.issues__chip')).find((button) => button.textContent?.trim() === label)!;
    expect(text()).toContain('Slug taken.');
    expect(text()).toContain('Image without alt attribute');

    chip('Saving').click();
    chip('Building').click();
    render();
    expect(chip('Saving').getAttribute('aria-pressed')).toBe('false');
    expect(text()).not.toContain('Slug taken.');
    expect(text()).toContain('Title is required.');
    // Output findings are what a build reports: hidden with the generation scope.
    expect(text()).not.toContain('Image without alt attribute');
    expect(JSON.parse(localStorage.getItem('sf-issues-scopes')!)).toEqual(['EDIT', 'RELEASE']);

    chip('Editing').click();
    chip('Releasing').click();
    render();
    expect(chip('Releasing').getAttribute('aria-pressed')).toBe('true');
  });
});
