import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
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

  function button(label: string): HTMLButtonElement {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const found = buttons.find((b) => b.textContent?.trim() === label);
    if (!found) {
      throw new Error(`No button "${label}"`);
    }
    return found;
  }

  it('releases the selection with the ticked dependencies, not the unticked ones', () => {
    open('release');
    flushPlan();

    const boxes = Array.from(fixture.nativeElement.querySelectorAll('.plan__dependency input')) as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true]);
    expect(fixture.nativeElement.textContent).toContain('via Home');

    boxes[1].click();
    fixture.detectChanges();

    const release = button('Release');
    expect(release.disabled).toBe(false);
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

    expect(fixture.nativeElement.textContent).toContain('Title is required.');
    expect(fixture.nativeElement.textContent).toContain('content.title');
    expect(button('Release').disabled).toBe(true);
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

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Long headline');
    expect(text).toContain('No note');
    expect(text).toContain('content.stamp');
    expect(text).toContain('released');
    expect(button('Release').disabled).toBe(true);

    (fixture.nativeElement.querySelector('.plan__accept input') as HTMLInputElement).click();
    fixture.detectChanges();
    fixture.detectChanges();
    const release = button('Release');
    expect(release.disabled).toBe(false);
    release.click();
    const request = http.expectOne('/api/v1/projects/proj/releases');
    expect(request.request.body.acceptWarnings).toBe(true);
    request.flush({ revision: 1235, applied: [], skipped: [], sharedFieldsKept: [], warnings: [] } satisfies ReleaseResultView);
  });

  it('re-plans when another locale is ticked', () => {
    open('release');
    flushPlan();
    const boxes = Array.from(fixture.nativeElement.querySelectorAll('.release__choice input')) as HTMLInputElement[];
    boxes[1].click();
    // The plan reports its state through an output: one pass for the plan, one for the dialog.
    fixture.detectChanges();
    fixture.detectChanges();
    expect(button('Release').disabled).toBe(true);
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
    expect(fixture.nativeElement.textContent).toContain('content.title (en)');

    button('Discard changes').click();
    http.expectOne('/api/v1/projects/proj/releases/discard').flush({
      revision: 1240,
      applied: [{ uuid: 'page-1', type: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en', status: 'PUBLISHED' }],
      skipped: [],
      sharedFieldsKept: [{ uuid: 'page-1', type: 'PAGE', uid: 'home', displayName: 'Home', locale: 'en', status: 'PUBLISHED' }],
    } satisfies ReleaseResultView);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('The shared fields (not per language) were kept');
    expect(fixture.nativeElement.textContent).toContain('Home (EN)');
  });
});
