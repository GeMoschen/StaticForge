import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { ConfirmService } from '../../../shared/components/dialog/confirm.service';
import { GenerationService } from '../../generation/generation.service';
import { RUNS_POLL_MS, RunsStore } from './runs.store';
import type { GenerationRunView } from './runs.util';

const DONE: GenerationRunView = { id: 4, status: 'SUCCESS', targetId: 1 };
const RUNNING: GenerationRunView = { id: 5, status: 'RUNNING', targetId: 1 };
const TARGETS = [
  { id: 1, name: 'Live site', isDefault: true },
  { id: 2, name: 'Staging', isDefault: false },
];

function setup(history: GenerationRunView[] = [DONE]) {
  const api = {
    history: vi.fn().mockReturnValue(of(history)),
    listTargets: vi.fn().mockReturnValue(of(TARGETS)),
    runLog: vi.fn().mockReturnValue(of({ lines: [{ n: 7, stage: 'RENDER', files: 12 }], complete: false })),
    status: vi.fn(),
    cancel: vi.fn().mockReturnValue(of(undefined)),
    promote: vi.fn().mockReturnValue(of(undefined)),
  };
  const confirms = { confirm: vi.fn().mockResolvedValue(true) };
  TestBed.configureTestingModule({
    providers: [RunsStore, { provide: GenerationService, useValue: api }, { provide: ConfirmService, useValue: confirms }],
  });
  const store = TestBed.inject(RunsStore);
  const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
  return { store, api, confirms, toast };
}

describe('RunsStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads the runs and the targets of the project', () => {
    const { store, api } = setup();
    store.open('proj');

    expect(api.history).toHaveBeenCalledWith('proj');
    expect(store.runs()).toEqual([DONE]);
    expect(store.loaded()).toBe(true);
    expect(store.defaultTarget()?.name).toBe('Live site');
    expect(store.targetName(DONE)).toBe('Live site');
    expect(store.targetName({ id: 9, targetId: 7 })).toBe('Target #7 (deleted)');
  });

  it('keeps reading while a run is active, and shows the stage it is in', () => {
    const { store, api } = setup([RUNNING, DONE]);
    store.open('proj');

    expect(store.progress().get(5)).toEqual({ stage: 'RENDER', files: 12, last: 7 });
    vi.advanceTimersByTime(RUNS_POLL_MS);
    expect(api.history).toHaveBeenCalledTimes(2);
    expect(api.runLog).toHaveBeenLastCalledWith('proj', 5, 7);
  });

  it('stops reading when nothing is active', () => {
    const { store, api } = setup([DONE]);
    store.open('proj');
    vi.advanceTimersByTime(RUNS_POLL_MS * 3);

    expect(api.history).toHaveBeenCalledTimes(1);
  });

  it('reads once more after a read asked for meanwhile, never dropping it', () => {
    const { store, api } = setup();
    const first = new Subject<GenerationRunView[]>();
    api.history.mockReturnValueOnce(first);
    store.open('proj');
    store.load();
    store.load();
    expect(api.history).toHaveBeenCalledTimes(1);

    first.next([RUNNING]);
    first.complete();

    expect(api.history).toHaveBeenCalledTimes(2);
  });

  it('forgets the runs of another project when the project changes', () => {
    const { store, api } = setup();
    store.open('one');
    api.history.mockReturnValue(of([]));
    store.open('two');

    expect(store.runs()).toEqual([]);
    expect(api.history).toHaveBeenLastCalledWith('two');
  });

  it('asks the server for a run the list does not hold, and reports a missing one', () => {
    const { store, api } = setup();
    store.open('proj');
    api.status
      .mockReturnValueOnce(of({ id: 9, status: 'QUEUED' }))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));

    store.ensureRun(9);
    expect(api.status).toHaveBeenCalledWith('proj', 9, true);
    expect(store.run(9)?.status).toBe('QUEUED');
    expect(store.missing()).toBeNull();

    store.ensureRun(77);
    expect(store.missing()).toBe(77);
    store.ensureRun(77);
    expect(api.status).toHaveBeenCalledTimes(2);
  });

  it('cancels after asking, and tells the user', async () => {
    const { store, api, confirms, toast } = setup([RUNNING]);
    store.open('proj');

    await store.cancel(RUNNING);

    expect(confirms.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel run #5?', tone: 'danger' }));
    expect(api.cancel).toHaveBeenCalledWith('proj', 5);
    expect(toast).toHaveBeenCalledWith('Run #5 cancelled.', 'info');
  });

  it('does nothing when the confirmation is declined', async () => {
    const { store, api, confirms } = setup([RUNNING]);
    store.open('proj');
    confirms.confirm.mockResolvedValue(false);

    await store.cancel(RUNNING);
    await store.promote(DONE);

    expect(api.cancel).not.toHaveBeenCalled();
    expect(api.promote).not.toHaveBeenCalled();
  });

  it('promotes to the target of the run after asking', async () => {
    const { store, api, confirms, toast } = setup();
    store.open('proj');

    await store.promote(DONE);

    expect(confirms.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Promote run #4 to Live site?' }));
    expect(api.promote).toHaveBeenCalledWith('proj', 4);
    expect(toast).toHaveBeenCalledWith('Run #4 promoted to Live site.', 'success');
  });

  it('re-reads the runs when a cancel fails because the run had finished', async () => {
    const { store, api } = setup([RUNNING]);
    store.open('proj');
    api.cancel.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    api.history.mockClear();

    await store.cancel(RUNNING);

    expect(api.history).toHaveBeenCalledTimes(1);
  });
});
