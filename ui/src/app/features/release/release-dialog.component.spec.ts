import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { screen } from '@testing-library/angular';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ReleaseDialogComponent } from './release-dialog.component';
import { ReleaseEventsStore } from './release-events.store';
import type { ReleaseChoice } from './release-choice.util';

type ReleasePlanView = components['schemas']['ReleasePlanView'];
type ReleaseResultView = components['schemas']['ReleaseResultView'];

const PLAN_URL = '/api/v1/projects/proj/releases/plan';

// Shapes as ReleaseController sends them: targets carry type, uid, display name, locale, status and version.
const PLAN: ReleasePlanView = {
  items: [{ uuid: 'page-1', type: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en', status: 'CHANGED', versionId: 41 }],
  dependencies: [
    {
      target: { uuid: 'media-1', type: 'MEDIA', uid: 'hero', displayName: 'Hero', locale: 'en', status: 'NEW', versionId: 7 },
      reason: 'REFERENCE',
      via: 'page-1',
      includedByDefault: true,
    },
    {
      target: { uuid: 'folder-1', type: 'FOLDER', uid: 'about', displayName: 'About', locale: 'en', status: 'NEW', versionId: 3 },
      reason: 'CONTAINER',
      via: 'page-1',
      includedByDefault: true,
    },
  ],
  incomplete: [],
  warnings: [],
};

const CHOICES: ReleaseChoice[] = [
  { assetUuid: 'page-1', locale: 'en', label: 'English (EN) — Changed', status: 'CHANGED', checked: true },
  { assetUuid: 'page-1', locale: 'fr', label: 'Français (FR) — New', status: 'NEW', checked: false },
];

describe('ReleaseDialogComponent', () => {
  let fixture: ComponentFixture<ReleaseDialogComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [ReleaseDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Field paths are developer details.
        { provide: DeveloperModeService, useValue: { enabled: signal(true) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  function open(mode: 'release' | 'unpublish' | 'discard', choices: ReleaseChoice[] = CHOICES): void {
    fixture = TestBed.createComponent(ReleaseDialogComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('choices', choices);
    fixture.componentRef.setInput('subjectName', 'Home');
    fixture.detectChanges();
    fixture.detectChanges();
  }

  function flushPlan(plan: ReleasePlanView = PLAN): void {
    vi.advanceTimersByTime(300);
    const request = http.expectOne(PLAN_URL);
    expect(request.request.body).toEqual({ items: [{ assetUuid: 'page-1', locale: 'en' }] });
    request.flush(plan);
    fixture.detectChanges();
  }

  /** The dialog moves itself into `<body>`, so queries run there. */
  const page = () => document.body;

  function button(label: string): HTMLButtonElement {
    return screen.getByRole('button', { name: label }) as HTMLButtonElement;
  }

  /** A button with a reason stays focusable: `aria-disabled` instead of the native attribute. */
  function isDisabled(element: HTMLElement): boolean {
    return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
  }

  it('releases the selection with the ticked dependencies, not the unticked ones', () => {
    open('release');
    flushPlan();

    const boxes = Array.from(page().querySelectorAll('.plan__group input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true]);
    expect(page().textContent).toContain('via Home');

    boxes[1].click();
    fixture.detectChanges();

    const release = button('Release');
    expect(isDisabled(release)).toBe(false);
    release.click();
    const request = http.expectOne('/api/v1/projects/proj/releases');
    expect(request.request.body).toEqual({
      items: [{ assetUuid: 'page-1', locale: 'en' }],
      includeDependencies: [{ assetUuid: 'media-1', locale: 'en' }],
      comment: undefined,
    });
    const events = TestBed.inject(ReleaseEventsStore);
    const before = events.version();
    request.flush({ revision: 1234, applied: [], skipped: [], sharedFieldsKept: [] } satisfies ReleaseResultView);
    expect(events.version()).toBe(before + 1);
  });

  it('blocks Release while an item has blocking completeness findings', () => {
    open('release');
    flushPlan({
      ...PLAN,
      incomplete: [
        {
          uuid: 'page-1',
          locale: 'en',
          issues: [{ path: 'content.title', code: 'SF-CNT-0101', severity: 'ERROR', message: 'Title is required.', kind: 'COMPLETENESS' }],
        },
      ],
    });

    expect(page().textContent).toContain('1 blocking error');
    expect(page().textContent).toContain('Title is required.');
    expect(page().textContent).toContain('content.title');
    // Each blocking error names where to fix it.
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toContain('page-1');
    expect(isDisabled(button('Release'))).toBe(true);
    expect(button('Release').getAttribute('aria-disabled')).toBe('true');
  });

  it('needs "Release with warnings" for rule warnings, lists notes and fills, and sends acceptWarnings', () => {
    open('release');
    flushPlan({
      ...PLAN,
      warningFindings: [
        {
          uuid: 'page-1',
          locale: 'en',
          issues: [{ path: 'content.title', code: 'rule', severity: 'WARNING', message: 'Long headline', kind: 'COMPLETENESS', rule: 'short' }],
        },
      ],
      infoFindings: [
        {
          uuid: 'page-1',
          locale: 'en',
          issues: [{ path: 'content.note', code: 'rule', severity: 'INFO', message: 'No note', kind: 'COMPLETENESS', rule: 'note' }],
        },
      ],
      fills: [{ uuid: 'page-1', locale: undefined, path: 'content.stamp', value: 'released' as never }],
    });
    // The plan reports its state through an output: one pass for the plan, one for the dialog.
    fixture.detectChanges();

    const text = page().textContent as string;
    expect(text).toContain('Long headline');
    expect(text).toContain('No note');
    expect(text).toContain('content.stamp');
    expect(text).toContain('released');
    expect(isDisabled(button('Release'))).toBe(true);

    // The warnings need an explicit confirmation (M33).
    (page().querySelector('.plan__ack input') as HTMLInputElement).click();
    fixture.detectChanges();
    fixture.detectChanges();
    const release = button('Release');
    expect(isDisabled(release)).toBe(false);
    release.click();
    const request = http.expectOne('/api/v1/projects/proj/releases');
    expect(request.request.body.acceptWarnings).toBe(true);
    request.flush({ revision: 1235, applied: [], skipped: [], sharedFieldsKept: [], warnings: [] } satisfies ReleaseResultView);
  });

  it('re-plans when another locale is ticked', () => {
    open('release');
    flushPlan();
    const boxes = Array.from(page().querySelectorAll('.rd__list input[type="checkbox"]')) as HTMLInputElement[];
    boxes[1].click();
    // The plan reports its state through an output: one pass for the plan, one for the dialog.
    fixture.detectChanges();
    fixture.detectChanges();
    expect(isDisabled(button('Release'))).toBe(true);
    vi.advanceTimersByTime(300);
    const request = http.expectOne(PLAN_URL);
    expect(request.request.body.items).toEqual([
      { assetUuid: 'page-1', locale: 'en' },
      { assetUuid: 'page-1', locale: 'fr' },
    ]);
    request.flush(PLAN);
  });

  it('shows the shared-fields note after a discard that kept them', () => {
    const choice: ReleaseChoice = { assetUuid: 'page-1', locale: 'en', label: 'English (EN) — Changed', status: 'CHANGED', checked: true };
    open('discard', [choice]);
    http
      .expectOne((req) => req.url === '/api/v1/projects/proj/changes/page-1/diff')
      .flush({ uuid: 'page-1', locale: 'en', status: 'CHANGED', changes: [{ path: 'content.title.values.en', before: 'Old', after: 'New' }] });
    fixture.detectChanges();
    expect(page().textContent).toContain('content.title (en)');

    button('Discard changes').click();
    http.expectOne('/api/v1/projects/proj/releases/discard').flush({
      revision: 1240,
      applied: [{ uuid: 'page-1', type: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en', status: 'PUBLISHED' }],
      skipped: [],
      sharedFieldsKept: [{ uuid: 'page-1', type: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en', status: 'PUBLISHED' }],
    } satisfies ReleaseResultView);
    fixture.detectChanges();

    expect(page().textContent).toContain('The shared fields (not per language) were kept');
    expect(page().textContent).toContain('Home (EN)');
  });

  it('pre-ticks every changed language and offers "All changed languages" as a plain checkbox', () => {
    open('release', [
      { ...CHOICES[0], checked: true },
      { ...CHOICES[1], checked: true },
    ]);
    vi.advanceTimersByTime(300);
    http.expectOne(PLAN_URL).flush(PLAN);
    fixture.detectChanges();

    const all = screen.getByRole('checkbox', { name: 'All changed languages' }) as HTMLInputElement;
    expect(all.checked).toBe(true);
    const languages = Array.from(page().querySelectorAll('.rd__list input[type="checkbox"]')) as HTMLInputElement[];
    expect(languages.map((box) => box.checked)).toEqual([true, true]);

    // Unticking the master unticks every language and disables Release with the reason.
    all.click();
    fixture.detectChanges();
    expect(languages.map((box) => box.checked)).toEqual([false, false]);
    expect(isDisabled(button('Release'))).toBe(true);
  });

  it('keeps one heading hierarchy: the dialog title is the h2 and every part an h3', () => {
    open('release');
    flushPlan();
    expect(Array.from(page().querySelectorAll('h2')).map((h) => h.textContent?.trim())).toEqual(['Release “Home”']);
    expect(page().querySelector('h1')).toBeNull();
    expect(page().querySelector('h4')).toBeNull();
    expect(Array.from(page().querySelectorAll('h3')).map((h) => h.textContent?.trim())).toEqual(['Languages', 'Also release (2)']);
  });

  it('puts its buttons in the dialog footer', () => {
    open('release');
    flushPlan();
    const footer = page().querySelector('.sf-dialog__footer') as HTMLElement;
    expect(Array.from(footer.querySelectorAll('button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Cancel',
      'publishRelease',
    ]);
  });
});
