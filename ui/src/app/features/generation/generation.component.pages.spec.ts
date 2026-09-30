import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { GenerationComponent } from './generation.component';

type GenerationRunView = components['schemas']['GenerationRunView'];

@Component({
  standalone: true,
  imports: [GenerationComponent],
  template: `<sf-generation projectKey="proj" [openRun]="run() ? +run()! : null" />`,
})
class GenerationScreenComponent {
  readonly run = input<string | undefined>();
}

const ABOUT = '11111111-1111-1111-1111-111111111111';
const GONE = '22222222-2222-2222-2222-222222222222';
const LOST = '33333333-3333-3333-3333-333333333333';

/** A run that failed before rendering: one `SF-GEN-0111` finding about three pages (M35.1). */
const FAILED_RUN: GenerationRunView = {
  id: 7,
  mode: 'FULL',
  status: 'FAILED',
  channels: [],
  filesWritten: 0,
  errorCount: 1,
  warningCount: 0,
  diagnostics: {
    errors: [
      {
        code: 'SF-GEN-0111',
        count: 1,
        messages: ["Output path '{folder}{uid}.{ext}' is not language-distinct (channel html, 3 pages: ...)."],
        pages: [
          { uuid: ABOUT, uid: 'about', displayName: 'About us', path: '/about' },
          { uuid: GONE, uid: 'gone', displayName: 'Deleted since', path: '/docs/gone' },
          { uuid: LOST, uid: null, displayName: null, path: null },
        ],
      },
    ],
    warnings: [],
  } as unknown as GenerationRunView['diagnostics'],
};

/** A run from before M35.1: the same finding without `pages`. */
const OLD_RUN: GenerationRunView = {
  id: 3,
  mode: 'FULL',
  status: 'FAILED',
  channels: [],
  filesWritten: 0,
  errorCount: 1,
  warningCount: 0,
  diagnostics: {
    errors: [{ code: 'SF-GEN-0111', count: 1, messages: ['Output path is not language-distinct.'] }],
    warnings: [],
  } as unknown as GenerationRunView['diagnostics'],
};

describe('GenerationComponent run diagnostics link the pages they name (M35.1)', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'generation', component: GenerationScreenComponent }], withComponentInputBinding()),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  async function open(runs: GenerationRunView[]): Promise<void> {
    await harness.navigateByUrl('/generation');
    http.expectOne('/api/v1/projects/proj/generations').flush(runs);
    http.expectOne('/api/v1/projects/proj/targets').flush([]);
    harness.detectChanges();
  }

  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const row = (id: number): HTMLElement =>
    Array.from(el().querySelectorAll('tbody tr')).find((tr) => tr.querySelector('.num')?.textContent?.trim() === `#${id}`) as HTMLElement;
  const details = (id: number): void => {
    (Array.from(row(id).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Details') as HTMLElement).click();
    harness.detectChanges();
  };
  const pageEntries = (): HTMLElement[] => Array.from(el().querySelectorAll('.diagnostic-pages__page'));

  it('renders each page as a link to its editor, and a page deleted since as plain text', async () => {
    await open([FAILED_RUN]);
    details(7);

    // The pages are read once to see which still exist; until then nothing is a link.
    expect(pageEntries().map((e) => e.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
    http.expectOne('/api/v1/projects/proj/pages').flush([{ uuid: ABOUT, uid: 'about', type: 'PAGE', displayName: 'About us' }]);
    harness.detectChanges();

    const entries = pageEntries();
    expect(entries.map((e) => e.tagName)).toEqual(['A', 'SPAN', 'SPAN']);
    expect(entries.map((e) => e.textContent?.trim())).toEqual(['About us (/about)', 'Deleted since (/docs/gone)', LOST]);
    expect(entries[0].getAttribute('href')).toBe(`/p/proj/pages/${ABOUT}`);
    // The message stays: the structured pages only add the links.
    expect(el().querySelector('.diagnostic')?.textContent).toContain('SF-GEN-0111');
  });

  it('keeps the pages as plain text when the project’s pages cannot be read', async () => {
    await open([FAILED_RUN]);
    details(7);
    http.expectOne('/api/v1/projects/proj/pages').flush('nope', { status: 500, statusText: 'Server Error' });
    harness.detectChanges();

    expect(pageEntries().map((e) => e.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
    expect(pageEntries()[0].textContent?.trim()).toBe('About us (/about)');
  });

  it('shows the message alone, and reads no pages, for a run stored before the pages were recorded', async () => {
    await open([OLD_RUN]);
    details(3);

    expect(el().querySelector('.diagnostic')?.textContent).toContain('SF-GEN-0111');
    expect(pageEntries()).toEqual([]);
    expect(el().querySelector('.diagnostic-pages')).toBeNull();
  });
});
