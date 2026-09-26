import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
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
