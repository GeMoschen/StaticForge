import '@angular/compiler';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { RunDetailComponent } from './run-detail.component';
import { RunsListComponent } from './runs-list.component';
import { PublishingRunsComponent } from './runs.component';
import { RunsStore } from './runs.store';
import type { GenerationRunView } from './runs.util';

@Component({ selector: 'sf-runs-list', standalone: true, template: `<p>run list</p>` })
class ListStub {}

@Component({ selector: 'sf-run-detail', standalone: true, template: `<p>detail of run {{ run()?.id }} in {{ projectKey() }}</p>` })
class DetailStub {
  readonly projectKey = input<string>();
  readonly run = input<GenerationRunView>();
}

const RUN: GenerationRunView = { id: 47, status: 'SUCCESS' };

async function setup(inputs: { run?: string }, over: { runs?: GenerationRunView[]; missing?: number | null } = {}) {
  const store = {
    runs: signal(over.runs ?? [RUN]),
    loaded: signal(true),
    missing: signal(over.missing ?? null),
    open: vi.fn(),
    ensureRun: vi.fn(),
  };
  TestBed.overrideComponent(PublishingRunsComponent, {
    remove: { imports: [RunDetailComponent, RunsListComponent], providers: [RunsStore] },
    add: { imports: [DetailStub, ListStub], providers: [{ provide: RunsStore, useValue: store }] },
  });
  const view = await render(PublishingRunsComponent, {
    componentInputs: { projectKey: 'proj', ...inputs },
    providers: [provideRouter([])],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, store, navigate };
}

describe('PublishingRunsComponent', () => {
  it('opens the project in the store and shows the list without a run in the URL', async () => {
    const { store } = await setup({});

    expect(store.open).toHaveBeenCalledWith('proj');
    expect(screen.getByText('run list')).toBeInTheDocument();
    expect(store.ensureRun).not.toHaveBeenCalled();
  });

  it('shows the detail of the run named by ?run=', async () => {
    await setup({ run: '47' });

    expect(screen.getByText('detail of run 47 in proj')).toBeInTheDocument();
  });

  it('asks for a run the list does not hold, and waits for the answer', async () => {
    const { store } = await setup({ run: '99' });

    expect(store.ensureRun).toHaveBeenCalledWith(99);
    expect(screen.queryByText('run list')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('says so when the run does not exist, and goes back to the list', async () => {
    const { navigate } = await setup({ run: '99' }, { missing: 99 });

    expect(screen.getByRole('heading', { name: 'Run #99 was not found' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All runs' }));

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { run: null, rtab: null }, queryParamsHandling: 'merge' }));
  });

  it('treats a run that is not a number as no run', async () => {
    await setup({ run: 'abc' });

    expect(screen.getByText('run list')).toBeInTheDocument();
  });
});
