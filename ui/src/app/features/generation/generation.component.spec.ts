import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ALL_PUBLISH_PERMISSIONS } from '../../core/project/testing/project-detail.fixture';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { GenerationComponent } from './generation.component';

type GenerationRunView = components['schemas']['GenerationRunView'];

// Runs as `GET /generations` sends them: a manual one with the note it was started with, a scheduled one, none.
const RUNS: GenerationRunView[] = [
  { id: 3, mode: 'FULL', status: 'SUCCESS', channels: ['html'], filesWritten: 4, comment: 'Scheduled generation #12: nightly' },
  { id: 2, mode: 'INCREMENTAL', status: 'SUCCESS', channels: ['html'], filesWritten: 1, comment: 'Hotfix for the footer' },
  { id: 1, mode: 'FULL', status: 'SUCCESS', channels: ['html'], filesWritten: 4 },
];

describe('GenerationComponent run comments', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GenerationComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the note each run was started with', () => {
    const fixture = TestBed.createComponent(GenerationComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.detectChanges();
    http.expectOne('/api/v1/projects/proj/generations').flush(RUNS);
    http.expectOne('/api/v1/projects/proj/targets').flush([]);
    fixture.detectChanges();

    const comments = Array.from(fixture.nativeElement.querySelectorAll('.run-comment') as NodeListOf<HTMLElement>).map(
      (el) => el.textContent?.trim(),
    );
    expect(comments).toEqual(['Scheduled generation #12: nightly', 'Hotfix for the footer']);
  });
});

// Runs as `GET /generations` sends them (M28): who started each, running and finished ones.
const OWNED_RUNS: GenerationRunView[] = [
  { id: 13, mode: 'INCREMENTAL', status: 'RUNNING', channels: ['html'], startedBy: { id: 1, displayName: 'Erin Editor' } },
  { id: 12, mode: 'INCREMENTAL', status: 'RUNNING', channels: ['html'], startedBy: { id: 2, displayName: 'Dev Dana' } },
  { id: 11, mode: 'FULL', status: 'SUCCESS', channels: ['html'], startedBy: { id: 2, displayName: 'Dev Dana' }, comment: 'Nightly' },
];

describe('GenerationComponent publish permissions (M28.3.3)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<GenerationComponent>;

  afterEach(() => http.verify());

  function render(role: string, permissions: string[], options: { readOnly?: boolean } = {}): void {
    TestBed.configureTestingModule({
      imports: [GenerationComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideProjectPermissions({
          role: () => role,
          permissions: () => permissions,
          userId: () => 1,
          readOnly: () => TestBed.inject(TimeTravelStore).isTimeTravel(),
        }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    if (options.readOnly) {
      TestBed.inject(TimeTravelStore).enter(12);
    }
    fixture = TestBed.createComponent(GenerationComponent);
    fixture.componentRef.setInput('projectKey', 'proj');
    fixture.detectChanges();
    http.expectOne('/api/v1/projects/proj/generations').flush(OWNED_RUNS);
    http.expectOne('/api/v1/projects/proj/targets').flush([]);
    fixture.detectChanges();
  }

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }

  /** The action buttons of the run with `id`. */
  function actions(id: number): string[] {
    const row = Array.from(fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>).find((tr) =>
      tr.querySelector('.num')?.textContent?.trim() === `#${id}`,
    )!;
    return Array.from(row.querySelectorAll('.cell-actions button') as NodeListOf<HTMLElement>).map((b) => b.textContent!.trim());
  }

  function hasNewGeneration(): boolean {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLElement>).some(
      (b) => b.textContent?.trim() === 'New generation',
    );
  }

  const NOTE = 'Builds are started by developers in this project.';

  it('shows an editor without build permission the note and no build controls', () => {
    render('EDITOR', []);
    expect(hasNewGeneration()).toBe(false);
    expect(text()).toContain(NOTE);
    expect(actions(13)).toEqual(['Details', 'Live log']);
    expect(actions(12)).toEqual(['Details', 'Live log']);
    expect(actions(11)).toEqual(['Details']);
  });

  it('lets an editor with INCREMENTAL_BUILD start builds and cancel only their own run', () => {
    render('EDITOR', ['INCREMENTAL_BUILD']);
    expect(hasNewGeneration()).toBe(true);
    expect(text()).not.toContain(NOTE);
    expect(actions(13)).toEqual(['Details', 'Live log', 'Cancel']);
    expect(actions(12)).toEqual(['Details', 'Live log']);
    expect(actions(11)).toEqual(['Details']);
  });

  it('gives a developer every control: cancel on every running run, promote on finished ones', () => {
    render('DEVELOPER', ALL_PUBLISH_PERMISSIONS);
    expect(hasNewGeneration()).toBe(true);
    expect(text()).not.toContain(NOTE);
    expect(actions(13)).toEqual(['Details', 'Live log', 'Cancel']);
    expect(actions(12)).toEqual(['Details', 'Live log', 'Cancel']);
    expect(actions(11)).toEqual(['Details', 'Promote']);
  });

  it('shows a viewer no build controls', () => {
    render('VIEWER', []);
    expect(hasNewGeneration()).toBe(false);
    expect(actions(13)).toEqual(['Details', 'Live log']);
    expect(actions(11)).toEqual(['Details']);
  });

  it('shows neither New generation nor the note while read-only', () => {
    render('DEVELOPER', ALL_PUBLISH_PERMISSIONS, { readOnly: true });
    expect(hasNewGeneration()).toBe(false);
    expect(text()).not.toContain(NOTE);
    expect(actions(11)).toEqual(['Details']);
  });

  it('names who started each run, on the row and in the details', () => {
    render('EDITOR', []);
    const starters = Array.from(fixture.nativeElement.querySelectorAll('.run-starter') as NodeListOf<HTMLElement>).map((el) =>
      el.textContent?.trim(),
    );
    expect(starters).toEqual(['Started by Erin Editor', 'Started by Dev Dana', 'Started by Dev Dana']);

    fixture.componentInstance.toggleDetails(OWNED_RUNS[2]);
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('.details') as HTMLElement;
    const pairs = Array.from(details.querySelectorAll('dt')).map((dt) => [dt.textContent?.trim(), dt.nextElementSibling?.textContent?.trim()]);
    expect(pairs).toContainEqual(['Started by', 'Dev Dana']);
    expect(pairs).toContainEqual(['Comment', 'Nightly']);
  });
});
