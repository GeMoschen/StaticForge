import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { BuildNowService } from '../generation/build-now.service';
import { GenerationService } from '../generation/generation.service';
import type { GenerationRunView } from '../publishing/runs/runs.util';
import { ReleaseEventsStore } from '../release/release-events.store';
import { BuildStatusStore } from './build-status.store';
import { buildStateOf, stateOfRun, toneOf } from './build-status.util';

const run = (id: number, status: string): GenerationRunView => ({ id, status, finishedAt: '2026-10-01T10:00:00Z' });

describe('build status util', () => {
  it('maps a final status to its state and anything else to running', () => {
    expect(stateOfRun(run(1, 'SUCCESS'))).toBe('success');
    expect(stateOfRun(run(1, 'PARTIAL'))).toBe('partial');
    expect(stateOfRun(run(1, 'FAILED'))).toBe('failed');
    expect(stateOfRun(run(1, 'CANCELLED'))).toBe('cancelled');
    expect(stateOfRun(run(1, 'RUNNING'))).toBe('running');
    expect(stateOfRun({ id: 1 })).toBe('running');
  });

  it('takes the state from the newest run, none before the first build', () => {
    expect(buildStateOf([])).toBe('none');
    expect(buildStateOf([run(2, 'FAILED'), run(1, 'SUCCESS')])).toBe('failed');
  });

  it('keeps red for a failure', () => {
    expect(toneOf('failed')).toBe('danger');
    expect(toneOf('partial')).toBe('warning');
    expect(toneOf('cancelled')).toBe('neutral');
  });
});

describe('BuildStatusStore', () => {
  const projectKey = signal<string | null>('acme');
  const started = new Subject<GenerationRunView>();
  const history = vi.fn();

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FrameContextStore, useValue: { projectKey } },
        { provide: GenerationService, useValue: { history } },
        { provide: BuildNowService, useValue: { started } },
      ],
    });
    const store = TestBed.inject(BuildStatusStore);
    TestBed.flushEffects();
    return store;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    projectKey.set('acme');
    history.mockReset();
    history.mockReturnValue(of([run(2, 'SUCCESS'), run(1, 'FAILED')]));
  });

  afterEach(() => vi.useRealTimers());

  it('reads the builds of the open project and keeps the newest few', () => {
    history.mockReturnValue(of(Array.from({ length: 9 }, (_, i) => run(9 - i, 'SUCCESS'))));
    const store = create();
    expect(history).toHaveBeenCalledWith('acme');
    expect(store.runs()).toHaveLength(5);
    expect(store.state()).toBe('success');
  });

  it('forgets the builds when the user leaves the project', () => {
    const store = create();
    expect(store.runs()).toHaveLength(2);
    projectKey.set(null);
    TestBed.flushEffects();
    expect(store.runs()).toEqual([]);
    expect(store.state()).toBe('none');
  });

  it('polls while a build runs and stops once it has finished', () => {
    history.mockReturnValueOnce(of([run(3, 'RUNNING')])).mockReturnValue(of([run(3, 'SUCCESS')]));
    const store = create();
    expect(store.state()).toBe('running');
    expect(history).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2600);
    expect(history).toHaveBeenCalledTimes(2);
    expect(store.state()).toBe('success');

    vi.advanceTimersByTime(10_000);
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('does not drop a refresh asked for while one is in flight: it reads once more after it', () => {
    const first = new Subject<GenerationRunView[]>();
    history.mockReturnValueOnce(first).mockReturnValue(of([run(4, 'FAILED')]));
    const store = create();
    store.refresh('acme');
    store.refresh('acme');
    expect(history).toHaveBeenCalledTimes(1);

    first.next([run(3, 'SUCCESS')]);
    first.complete();
    expect(history).toHaveBeenCalledTimes(2);
    expect(store.state()).toBe('failed');
  });

  it('shows a build started from the top bar or a toast at once', () => {
    const store = create();
    history.mockReturnValue(of([run(5, 'RUNNING')]));
    started.next(run(5, 'RUNNING'));
    expect(store.state()).toBe('running');
  });

  it('keeps the last status when a read fails', () => {
    const store = create();
    history.mockReturnValue(new Subject<never>());
    const failing = new Subject<GenerationRunView[]>();
    history.mockReturnValue(failing);
    store.refresh('acme');
    failing.error(new Error('offline'));
    expect(store.runs()).toHaveLength(2);
  });

  it('refreshes after a release action', () => {
    create();
    expect(history).toHaveBeenCalledTimes(1);
    TestBed.inject(ReleaseEventsStore).changed();
    TestBed.flushEffects();
    expect(history).toHaveBeenCalledTimes(2);
  });
});
