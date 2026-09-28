import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditingLocaleStore } from '../../../core/project/editing-locale.store';
import { LocalesStore } from '../../../core/project/locales.store';
import { SfRunFindingsComponent } from './sf-run-findings.component';
import { ABOUT, ALPHA, FINDINGS_PAGE, RULES, RUN_WITH_FINDINGS } from './testing/findings.fixtures';

const FINDINGS_URL = '/api/v1/projects/proj/generations/2/findings';

@Component({ standalone: true, template: '' })
class StubPageComponent {}

describe('SfRunFindingsComponent', () => {
  let fixture: ComponentFixture<SfRunFindingsComponent>;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SfRunFindingsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: '**', component: StubPageComponent }])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(LocalesStore).set('proj', {
      locales: [
        { code: 'de', label: 'Deutsch' },
        { code: 'en', label: 'English' },
      ],
      defaultLocale: 'de',
      fallbacks: {},
      defaultWithoutPrefix: true,
    });
  });

  afterEach(() => http.verify());

  /** Opens the findings at `url` (the Generation screen's query) and answers the first findings request. */
  async function render(url = '/', run = RUN_WITH_FINDINGS): Promise<TestRequest> {
    await router.navigateByUrl(url);
    fixture = TestBed.createComponent(SfRunFindingsComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('run', run);
    fixture.detectChanges();
    http.expectOne('/api/v1/projects/proj/quality-rules').flush({ rules: RULES });
    const request = findingsRequest();
    request.flush(FINDINGS_PAGE);
    fixture.detectChanges();
    return request;
  }

  function findingsRequest(): TestRequest {
    return http.expectOne((req) => req.url === FINDINGS_URL);
  }

  /** Lets the router finish a navigation, then answers the findings request it caused. */
  async function settle(): Promise<TestRequest> {
    await fixture.whenStable();
    fixture.detectChanges();
    const request = findingsRequest();
    request.flush(FINDINGS_PAGE);
    fixture.detectChanges();
    return request;
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (name: string): HTMLButtonElement =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name)!;
  const query = (): Record<string, unknown> => router.parseUrl(router.url).queryParams;

  it('shows the counts by severity and category as filter chips', async () => {
    await render();
    const facets = Array.from(el().querySelectorAll('.findings__facets button')).map((b) =>
      b.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(facets).toEqual(['4 errors', '42 warnings', 'Links 10', 'SEO 22', 'Accessibility 14']);
  });

  it('keeps the chip filters in the URL and sends them as query parameters', async () => {
    await render();
    button('4 errors').click();
    const bySeverity = await settle();
    expect(query()).toEqual({ fSeverity: 'ERROR' });
    expect(bySeverity.request.params.get('severity')).toBe('ERROR');
    expect(button('4 errors').getAttribute('aria-pressed')).toBe('true');

    button('Accessibility 14').click();
    const both = await settle();
    expect(query()).toEqual({ fSeverity: 'ERROR', fCategory: 'ACCESSIBILITY' });
    expect(both.request.params.get('category')).toBe('ACCESSIBILITY');

    // A pressed chip clears its filter again.
    button('4 errors').click();
    await settle();
    expect(query()).toEqual({ fCategory: 'ACCESSIBILITY' });
  });

  it('opens a shared findings view from the URL with every filter applied', async () => {
    const request = await render(
      `/?run=2&tab=findings&fCode=SF-CHK-0101&fCode=SF-CHK-0201&fChannel=html&fLocale=en&fPath=en%2F&fAsset=${ALPHA}&fPage=1`,
    );
    const params = request.request.params;
    expect(params.getAll('code')).toEqual(['SF-CHK-0101', 'SF-CHK-0201']);
    expect(params.get('channel')).toBe('html');
    expect(params.get('locale')).toBe('en');
    expect(params.get('pathPrefix')).toBe('en/');
    expect(params.get('assetUuid')).toBe(ALPHA);
    expect(params.get('page')).toBe('1');
    expect(params.get('size')).toBe('25');

    // Every chosen filter is visible as a chip, the rules with their names, the page with its name.
    const chips = Array.from(el().querySelectorAll('.findings__chosen .chip')).map((c) =>
      c.firstChild?.textContent?.trim(),
    );
    expect(chips).toEqual([
      'SF-CHK-0101 Link to a missing page or file',
      'SF-CHK-0201 Missing or empty title',
      'Page: Alpha',
      'Channel: html',
      'Language: English',
      'Path: en/*',
    ]);
  });

  it('adds a rule filter, removes a chip and clears all filters', async () => {
    await render('/?run=2&tab=findings&fLocale=en');
    const rule = el().querySelector('select[aria-label="Filter by rule"]') as HTMLSelectElement;
    rule.value = 'SF-CHK-0301';
    rule.dispatchEvent(new Event('change'));
    const byRule = await settle();
    expect(byRule.request.params.getAll('code')).toEqual(['SF-CHK-0301']);
    expect(query()).toEqual({ run: '2', tab: 'findings', fLocale: 'en', fCode: 'SF-CHK-0301' });

    (el().querySelector('button[aria-label="Remove filter Language: English"]') as HTMLButtonElement).click();
    await settle();
    expect(query()).toEqual({ run: '2', tab: 'findings', fCode: 'SF-CHK-0301' });

    button('Clear filters').click();
    await settle();
    // The view itself (run and tab) stays open.
    expect(query()).toEqual({ run: '2', tab: 'findings' });
  });

  it('filters by channel, language and output path prefix', async () => {
    const run = { ...RUN_WITH_FINDINGS, planSummary: { ...RUN_WITH_FINDINGS.planSummary, channels: ['html', 'md'] } };
    await render('/', run);
    const channel = el().querySelector('select[aria-label="Filter by channel"]') as HTMLSelectElement;
    channel.value = 'md';
    channel.dispatchEvent(new Event('change'));
    expect((await settle()).request.params.get('channel')).toBe('md');

    const locale = el().querySelector('select[aria-label="Filter by language"]') as HTMLSelectElement;
    locale.value = 'de';
    locale.dispatchEvent(new Event('change'));
    expect((await settle()).request.params.get('locale')).toBe('de');

    const path = el().querySelector('input[aria-label="Filter by output path prefix"]') as HTMLInputElement;
    path.value = 'en/blog/';
    path.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await settle()).request.params.get('pathPrefix')).toBe('en/blog/');
    expect(query()).toEqual({ fChannel: 'md', fLocale: 'de', fPath: 'en/blog/' });
  });

  it('pages through the findings, keeping the page in the URL', async () => {
    await render();
    expect(el().querySelector('.findings__pager')?.textContent?.replace(/\s+/g, ' ')).toContain('Page 1 of 2 · 46 findings');
    button('Next').click();
    const next = await settle();
    expect(next.request.params.get('page')).toBe('1');
    expect(query()).toEqual({ fPage: '1' });
    expect(el().querySelector('.findings__pager')?.textContent?.replace(/\s+/g, ' ')).toContain('Page 2 of 2');
    // A filter change starts again on the first page.
    button('SEO 22').click();
    expect((await settle()).request.params.get('page')).toBe('0');
  });

  it('lists each finding with its output, page, rule, severity, message and selector', async () => {
    await render();
    const rows = Array.from(el().querySelectorAll('.findings__table tbody tr'));
    expect(rows).toHaveLength(4);
    const [carried, link, , alt] = rows;
    expect(carried.querySelector('.findings__path')?.textContent?.trim()).toBe('about.html');
    expect(carried.querySelector('.findings__carried')?.textContent?.trim()).toBe('carried');
    expect(link.querySelector('.findings__carried')).toBeNull();
    expect(link.querySelector('.findings__rule')?.textContent?.trim()).toBe('Link to a missing page or file');
    expect(link.querySelector('.findings__code')?.textContent?.trim()).toBe('SF-CHK-0101');
    expect(link.querySelector('.findings__meta')?.textContent?.trim()).toBe('html · en');
    expect(alt.querySelector('.severity--error')?.textContent?.trim()).toBe('Error');
    expect(alt.querySelector('.findings__message')?.textContent).toContain('Image without alt attribute: pic.png.');
    const tip = alt.querySelector('[role="tooltip"]') as HTMLElement;
    expect(tip.textContent?.trim()).toBe('body > img');
    expect(alt.querySelector('.selector__trigger')?.getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('links each finding to the page editor in the finding’s language', async () => {
    await render();
    const links = Array.from(el().querySelectorAll('.findings__table tbody a')) as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/p/proj/pages/${ABOUT}`,
      `/p/proj/pages/${ALPHA}`,
      `/p/proj/pages/${ALPHA}`,
      `/p/proj/pages/${ALPHA}`,
    ]);
    expect(links[1].textContent?.trim()).toBe('Alpha');
    const editing = TestBed.inject(EditingLocaleStore);
    expect(editing.locale()).toBe('de');
    links[1].click();
    expect(editing.locale()).toBe('en');
    await fixture.whenStable();
    expect(router.url).toBe(`/p/proj/pages/${ALPHA}`);
  });

  it('says how many findings were not stored', async () => {
    const truncated = {
      ...RUN_WITH_FINDINGS,
      findingCounts: { ...RUN_WITH_FINDINGS.findingCounts, truncated: 1250 },
    };
    await render('/', truncated);
    expect(el().querySelector('.findings__notice')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "1250 more findings were not stored: the run reached the findings limit. The counts include them; the table doesn't.",
    );
  });

  it('shows no notice when nothing was truncated, and an empty result per filter', async () => {
    await render('/?fSeverity=ERROR');
    expect(el().querySelector('.findings__notice')).toBeNull();
    button('42 warnings').click();
    await fixture.whenStable();
    fixture.detectChanges();
    findingsRequest().flush({ content: [], page: { size: 25, number: 0, totalElements: 0, totalPages: 0 } });
    fixture.detectChanges();
    expect(el().textContent).toContain('No findings match these filters.');
  });
});
