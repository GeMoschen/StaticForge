import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { GenerationComponent } from './generation.component';
import { GenerationService } from './generation.service';
import type { GenerationRunEvent } from './generation-sse';
import { ALPHA, FINDINGS_PAGE, RULES, RUN_WITH_FINDINGS } from './findings/testing/findings.fixtures';

type GenerationRunView = components['schemas']['GenerationRunView'];

/** The Generation settings screen as far as the runs are concerned: `?run=` and `?tab=` bound to the inputs. */
@Component({
  standalone: true,
  imports: [GenerationComponent],
  template: `<sf-generation projectKey="proj" [openRun]="run() ? +run()! : null" [openTab]="tab() ?? null" />`,
})
class GenerationScreenComponent {
  readonly run = input<string | undefined>();
  readonly tab = input<string | undefined>();
}

@Component({ standalone: true, template: '' })
class ElsewhereComponent {}

/** A clean run: checks ran, found warnings only. */
const CLEAN_RUN: GenerationRunView = {
  id: 1,
  mode: 'FULL',
  status: 'SUCCESS',
  channels: [],
  filesWritten: 10,
  errorCount: 0,
  warningCount: 0,
  diagnostics: { errors: [], warnings: [] } as unknown as GenerationRunView['diagnostics'],
  planSummary: { ...RUN_WITH_FINDINGS.planSummary, redirectsAdded: 0, redirectsActive: 0 },
  findingCounts: { errors: 0, warnings: 3, byCategory: { links: 0, seo: 3, accessibility: 0 }, truncated: 0 },
};

/** A run from before the checks: no counts. */
const OLD_RUN: GenerationRunView = { id: 0, mode: 'FULL', status: 'SUCCESS', channels: [], filesWritten: 10 };

const RUNS = [RUN_WITH_FINDINGS, CLEAN_RUN, OLD_RUN];

describe('GenerationComponent findings (M30.6.2)', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(
          [
            { path: 'generation', component: GenerationScreenComponent },
            { path: '**', component: ElsewhereComponent },
          ],
          withComponentInputBinding(),
        ),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  async function open(url = '/generation'): Promise<void> {
    await harness.navigateByUrl(url);
    http.expectOne('/api/v1/projects/proj/generations').flush(RUNS);
    http.expectOne('/api/v1/projects/proj/targets').flush([]);
    harness.detectChanges();
  }

  /** Answers the requests of the findings view once it shows. */
  async function flushFindings(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
    http.expectOne('/api/v1/projects/proj/quality-rules').flush({ rules: RULES });
    http.expectOne((req) => req.url.endsWith('/generations/2/findings')).flush(FINDINGS_PAGE);
    harness.detectChanges();
  }

  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const row = (id: number): HTMLElement =>
    Array.from(el().querySelectorAll('tbody tr')).find((tr) => tr.querySelector('.num')?.textContent?.trim() === `#${id}`) as HTMLElement;
  const button = (scope: HTMLElement, name: string): HTMLButtonElement =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name)!;
  const query = (): Record<string, unknown> => router.parseUrl(router.url).queryParams;
  const tabs = (): string[] => Array.from(el().querySelectorAll('[role="tab"]')).map((t) => t.textContent!.trim());
  const selectedTab = (): string | undefined =>
    el().querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim();

  it('shows a findings chip per run, the error chip only with errors', async () => {
    await open();
    const chips = (id: number) =>
      Array.from(row(id).querySelectorAll('sf-finding-counts .chip')).map((c) => c.textContent?.trim());
    expect(chips(2)).toEqual(['4 errors', '42 warnings']);
    expect(chips(1)).toEqual(['3 warnings']);
    expect(chips(0)).toEqual([]);
    // Separate from the diagnostics counts (errors and warnings columns).
    expect(row(2).querySelector('.chip')?.closest('[aria-label]')?.getAttribute('aria-label')).toBe(
      'Findings: 4 errors · 42 warnings',
    );
  });

  it('opens a run’s errors from its chip, in the URL', async () => {
    await open();
    button(row(2), '4 errors').click();
    await flushFindings();
    expect(query()).toEqual({ run: '2', tab: 'findings', fSeverity: 'ERROR' });
    expect(tabs()).toEqual(['Summary', 'Rebuilt pages', 'Findings']);
    expect(selectedTab()).toBe('Findings');
    expect(el().querySelector('sf-run-findings')).not.toBeNull();
  });

  it('opens a shared findings link on the findings tab', async () => {
    await open('/generation?run=2&tab=findings&fCategory=SEO');
    await flushFindings();
    expect(selectedTab()).toBe('Findings');
    expect(el().querySelector('.facet[aria-pressed="true"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('SEO 22');
  });

  it('puts the findings tab in the URL and takes it out again when another tab or the details close', async () => {
    await open();
    button(row(2), 'Details').click();
    harness.detectChanges();
    button(el(), 'Findings').click();
    await flushFindings();
    expect(query()).toEqual({ run: '2', tab: 'findings' });

    button(el(), 'Summary').click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(query()).toEqual({});
    expect(selectedTab()).toBe('Summary');

    button(el(), 'Findings').click();
    await flushFindings();
    button(row(2), 'Hide details').click();
    await harness.fixture.whenStable();
    expect(query()).toEqual({});
  });

  it('moves between the three tabs with the arrow keys', async () => {
    await open();
    button(row(2), 'Details').click();
    harness.detectChanges();
    const tab = () => el().querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
    tab().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await flushFindings();
    expect(selectedTab()).toBe('Findings');
    tab().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(selectedTab()).toBe('Summary');
  });

  it('offers no findings tab for a run from before the checks', async () => {
    await open();
    button(row(0), 'Details').click();
    harness.detectChanges();
    expect(tabs()).toEqual(['Summary', 'Rebuilt pages']);
  });

  it('shows the redirect and finding counts in the summary', async () => {
    await open();
    button(row(2), 'Details').click();
    harness.detectChanges();
    const pairs = Array.from(el().querySelectorAll('.details dt')).map((dt) => [
      dt.textContent?.trim(),
      dt.nextElementSibling?.textContent?.trim(),
    ]);
    expect(pairs).toContainEqual(['Redirects', '2 redirects added · 2 redirects active']);
    expect(pairs).toContainEqual(['Findings', '4 errors · 42 warnings']);
  });

  it('links a held-back page to its findings, filtered by that page', async () => {
    await open();
    button(row(2), 'Details').click();
    harness.detectChanges();
    const diagnostics = Array.from(el().querySelectorAll('.diagnostic')) as HTMLElement[];
    expect(diagnostics).toHaveLength(4);
    expect(diagnostics.every((d) => button(d, 'Show findings'))).toBe(true);

    // "alpha (html, en)": the third message, the third heldBack entry — no request needed to find the page.
    button(diagnostics[2], 'Show findings').click();
    await flushFindings();
    expect(query()).toEqual({ run: '2', tab: 'findings', fAsset: ALPHA, fChannel: 'html', fLocale: 'en' });
    expect(selectedTab()).toBe('Findings');
  });

  it('offers no findings link for held-back pages of a run without heldBack', async () => {
    const diagnostics = { ...(RUN_WITH_FINDINGS.diagnostics as unknown as Record<string, unknown>) };
    delete diagnostics['heldBack'];
    const older = { ...RUN_WITH_FINDINGS, diagnostics: diagnostics as unknown as GenerationRunView['diagnostics'] };
    await harness.navigateByUrl('/generation');
    http.expectOne('/api/v1/projects/proj/generations').flush([older]);
    http.expectOne('/api/v1/projects/proj/targets').flush([]);
    harness.detectChanges();
    button(row(2), 'Details').click();
    harness.detectChanges();
    expect(el().querySelectorAll('.diagnostic')).toHaveLength(4);
    expect(el().querySelector('.diagnostic__link')).toBeNull();
  });

  it('labels the CHECK stage in the live log', async () => {
    await open();
    TestBed.inject(AuthStore).accessToken.set('token');
    const events = new Subject<GenerationRunEvent>();
    vi.spyOn(TestBed.inject(GenerationService), 'connectEvents').mockReturnValue(events);
    const running: GenerationRunView = { id: 3, mode: 'FULL', status: 'RUNNING', channels: [] };
    harness.fixture.debugElement.query((d) => d.componentInstance instanceof GenerationComponent)
      .componentInstance.watchLive(running);
    const event = (stage: string, message: string): GenerationRunEvent => ({
      stage,
      message,
      filesWritten: 0,
      errors: 0,
      warnings: 0,
      diagnostics: null,
    });
    events.next(event('ASSETS', 'Copying media'));
    events.next(event('CHECK', 'Checking output'));
    events.next(event('CHECK', 'Checked 10 outputs: 4 errors, 42 warnings; 4 held back'));
    harness.detectChanges();
    const lines = Array.from(el().querySelectorAll('.live__log .log-line')).map((line) => {
      const stage = line.querySelector('.log-line__stage')?.textContent ?? '';
      return [stage, line.textContent?.slice(stage.length).trim()];
    });
    expect(lines).toEqual([
      ['ASSETS', 'Copying media'],
      ['CHECK', 'Checking output'],
      ['CHECK', 'Checked 10 outputs: 4 errors, 42 warnings; 4 held back'],
    ]);
    events.complete();
    http.expectOne('/api/v1/projects/proj/generations/3').flush({ ...running, status: 'SUCCESS' });
  });
});
