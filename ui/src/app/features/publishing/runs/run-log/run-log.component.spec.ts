import '@angular/compiler';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../../../core/auth/auth.store';
import type { GenerationRunEvent } from '../../../generation/generation-sse';
import { GenerationService, type RunLogView } from '../../../generation/generation.service';
import type { GenerationRunView } from '../runs.util';
import { RunLogComponent } from './run-log.component';
import { LOG_POLL_MS, type LogLine } from './run-log.store';

const line = (n: number, over: Partial<LogLine> = {}): LogLine => ({
  n,
  time: '2026-10-09T10:00:00Z',
  stage: 'RENDER',
  level: 'info',
  text: `line ${n}`,
  files: n,
  errors: 0,
  warnings: 0,
  ...over,
});

const event = (n: number | undefined, over: Partial<GenerationRunEvent> = {}): GenerationRunEvent => ({
  ...(n === undefined ? {} : { n, time: '2026-10-09T10:00:00Z', level: 'info' }),
  stage: n === undefined ? 'STATUS' : 'RENDER',
  message: n === undefined ? 'RUNNING' : `line ${n}`,
  filesWritten: n ?? 0,
  errors: 0,
  warnings: 0,
  diagnostics: null,
  ...over,
});

const view = (lines: LogLine[], over: Partial<RunLogView> = {}): RunLogView => ({
  lines,
  complete: true,
  truncated: false,
  pruned: false,
  ...over,
});

async function setup(run: GenerationRunView, log: RunLogView | ((from: number) => unknown) = view([])) {
  const events = new Subject<GenerationRunEvent>();
  const unsubscribed = vi.fn();
  const api = {
    runLog: vi.fn((_key: string, _id: number, from: number) =>
      typeof log === 'function' ? (log(from) as ReturnType<typeof of>) : of(log),
    ),
    connectEvents: vi.fn(
      () =>
        new Observable<GenerationRunEvent>((subscriber) => {
          const inner = events.subscribe(subscriber);
          return () => {
            unsubscribed();
            inner.unsubscribe();
          };
        }),
    ),
  };
  const finished = vi.fn();
  const rendered = await render(RunLogComponent, {
    inputs: { projectKey: 'proj', run },
    on: { finished },
    providers: [
      { provide: GenerationService, useValue: api },
      { provide: AuthStore, useValue: { accessToken: signal('token') } },
    ],
  });
  return { ...rendered, api, events, finished, unsubscribed };
}

const RUNNING: GenerationRunView = { id: 7, status: 'RUNNING' };
const DONE: GenerationRunView = { id: 7, status: 'SUCCESS' };

afterEach(() => vi.useRealTimers());

describe('RunLogComponent', () => {
  it('shows the stored log of a finished run with the counters of its last line', async () => {
    const { api, finished } = await setup(
      DONE,
      view([line(1), line(2, { level: 'warning', warnings: 1, files: 4 }), line(3, { level: 'error', errors: 2, files: 5, warnings: 1, stage: 'REPORT' })]),
    );
    expect(await screen.findByText('line 3')).toBeInTheDocument();
    expect(api.runLog).toHaveBeenCalledWith('proj', 7, 0);
    expect(api.connectEvents).not.toHaveBeenCalled();
    expect(screen.getByText('3 lines')).toBeInTheDocument();
    expect(screen.getByText('5 files')).toBeInTheDocument();
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(screen.getByText('1 warning')).toBeInTheDocument();
    expect(screen.getByText('[REPORT]')).toBeInTheDocument();
    expect(screen.getByText('Error:')).toBeInTheDocument();
    expect(screen.getByText('Warning:')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Build log of run #7' })).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('Jump to the end')).toBeNull();
    expect(finished).not.toHaveBeenCalled();
  });

  it('says so when retention removed the log', async () => {
    await setup(DONE, view([], { pruned: true }));
    expect(await screen.findByText('The log is no longer available')).toBeInTheDocument();
  });

  it('warns when the log was truncated', async () => {
    await setup(DONE, view([line(1)], { truncated: true }));
    expect(await screen.findByText(/reached its line limit/)).toBeInTheDocument();
  });

  it('offers a retry when the log cannot be read', async () => {
    const calls = [throwError(() => new Error('x')), of(view([line(1)]))];
    const { api } = await setup(DONE, () => calls.shift());
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('line 1')).toBeInTheDocument();
    expect(api.runLog).toHaveBeenCalledTimes(2);
  });

  it('awaits events for a queued run', async () => {
    await setup({ id: 7, status: 'QUEUED' });
    expect(await screen.findByText('Awaiting events…')).toBeInTheDocument();
  });

  it('de-duplicates replayed and live lines by n and ignores STATUS events', async () => {
    const { events } = await setup(RUNNING);
    events.next(event(1));
    events.next(event(2));
    events.next(event(undefined));
    events.next(event(2));
    events.next(event(3));
    expect(await screen.findByText('line 3')).toBeInTheDocument();
    expect(screen.getAllByText('line 2')).toHaveLength(1);
    expect(screen.getByText('3 lines')).toBeInTheDocument();
    expect(screen.getByText('Following the newest lines')).toBeInTheDocument();
  });

  it('fetches the closing lines once when the stream ends, then reports finished', async () => {
    const { events, api, finished, unsubscribed } = await setup(RUNNING, (from) => of(view(from === 0 ? [] : [line(3, { stage: 'REPORT' })])));
    events.next(event(1));
    events.next(event(2));
    events.complete();
    expect(await screen.findByText('line 3')).toBeInTheDocument();
    expect(api.runLog).toHaveBeenLastCalledWith('proj', 7, 2);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(unsubscribed).toHaveBeenCalled();
    expect(screen.queryByText('Following the newest lines')).toBeNull();
  });

  it('settles when the parent passes a finished run while the log is live', async () => {
    const { fixture, api, finished, events } = await setup(RUNNING, view([line(9, { stage: 'REPORT' })]));
    events.next(event(1));
    fixture.componentRef.setInput('run', DONE);
    fixture.detectChanges();
    expect(await screen.findByText('line 9')).toBeInTheDocument();
    expect(api.runLog).toHaveBeenLastCalledWith('proj', 7, 1);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('polls the log while the stream is unavailable', async () => {
    vi.useFakeTimers();
    const batches = [view([line(1)], { complete: false }), view([line(2)], { complete: true })];
    const { api, events, finished, fixture } = await setup(RUNNING, () => of(batches.shift()));
    events.error(new Error('down'));
    fixture.detectChanges();
    expect(api.runLog).toHaveBeenLastCalledWith('proj', 7, 0);
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS);
    expect(api.runLog).toHaveBeenLastCalledWith('proj', 7, 1);
    expect(finished).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LOG_POLL_MS * 2);
    expect(api.runLog).toHaveBeenCalledTimes(2);
  });

  it('pauses when scrolled up and follows again after Jump to the end', async () => {
    const { events, fixture } = await setup(RUNNING);
    const region = screen.getByRole('region', { name: 'Build log of run #7' });
    Object.defineProperty(region, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(region, 'scrollHeight', { configurable: true, value: 1000 });
    for (let n = 1; n <= 5; n++) {
      events.next(event(n));
    }
    await screen.findByText('line 5');
    // The browser reports the view's own jump to the end as a scroll; the user's scroll comes after it.
    fireEvent.scroll(region);
    region.scrollTop = 0;
    fireEvent.scroll(region);
    expect(await screen.findByText('Paused – scrolled up')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to the end' }));
    expect(await screen.findByText('Following the newest lines')).toBeInTheDocument();
    expect(region.scrollTop).toBe(900);
    fixture.destroy();
  });

  it('closes the stream when destroyed', async () => {
    const { fixture, unsubscribed } = await setup(RUNNING);
    fixture.destroy();
    await waitFor(() => expect(unsubscribed).toHaveBeenCalled());
  });
});
