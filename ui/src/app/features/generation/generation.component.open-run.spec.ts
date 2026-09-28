import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { AuthStore } from '../../core/auth/auth.store';
import { GenerationComponent } from './generation.component';
import { GenerationService } from './generation.service';
import type { GenerationRunEvent } from './generation-sse';

type GenerationRunView = components['schemas']['GenerationRunView'];

/** The Generation settings screen as far as the runs are concerned: `?run=` bound to the input. */
@Component({
  standalone: true,
  imports: [GenerationComponent],
  template: `<sf-generation projectKey="proj" [openRun]="run() ? +run()! : null" />`,
})
class GenerationScreenComponent {
  readonly run = input<string | undefined>();
}

const DONE: GenerationRunView = { id: 1, mode: 'FULL', status: 'SUCCESS', channels: [], filesWritten: 3 };
const RUNNING: GenerationRunView = { id: 2, mode: 'INCREMENTAL', status: 'RUNNING', channels: [], comment: 'Build after release' };

/**
 * "Show progress" after "Build now" opens `?run=<id>`. The run was usually still running when the history was read, and
 * nothing followed it: the row said RUNNING until the page was reloaded (found by the M30 journey).
 */
describe('GenerationComponent opened on a run (?run=)', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let events: Subject<GenerationRunEvent>;
  let connect: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'generation', component: GenerationScreenComponent }], withComponentInputBinding()),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).accessToken.set('token');
    events = new Subject<GenerationRunEvent>();
    connect = vi.fn().mockReturnValue(events);
    vi.spyOn(TestBed.inject(GenerationService), 'connectEvents').mockImplementation(connect);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  async function open(url: string): Promise<void> {
    await harness.navigateByUrl(url);
    http.expectOne('/api/v1/projects/proj/generations').flush([RUNNING, DONE]);
    http.expectOne('/api/v1/projects/proj/targets').flush([]);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  const badge = (id: number) =>
    Array.from((harness.routeNativeElement as HTMLElement).querySelectorAll('tbody tr'))
      .find((row) => row.querySelector('td.num')?.textContent?.trim() === `#${id}`)
      ?.querySelector('.badge')
      ?.textContent?.trim();

  it('follows a run that is still going in the live log, and settles its row when the stream ends', async () => {
    await open('/generation?run=2');

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('proj', 2, 'token');
    expect((harness.routeNativeElement as HTMLElement).querySelector('.live__header')?.textContent).toContain('run #2');
    expect(badge(2)).toBe('RUNNING');

    events.complete();
    http.expectOne('/api/v1/projects/proj/generations/2').flush({ ...RUNNING, status: 'SUCCESS' });
    harness.detectChanges();

    expect(badge(2)).toBe('SUCCESS');
  });

  it('only opens the details of a finished run', async () => {
    await open('/generation?run=1');

    expect(connect).not.toHaveBeenCalled();
    expect((harness.routeNativeElement as HTMLElement).querySelector('.live__header')).toBeNull();
    expect(badge(1)).toBe('SUCCESS');
  });
});
