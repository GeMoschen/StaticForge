import '@angular/compiler';
import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen } from '@testing-library/angular';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { RunFindingsComponent } from './findings/run-findings.component';
import { RunDetailComponent } from './run-detail.component';
import { RunLogComponent } from './run-log/run-log.component';
import { RunRebuiltComponent } from './run-rebuilt.component';
import { RunSummaryComponent } from './run-summary.component';
import { RunsStore } from './runs.store';
import type { GenerationRunView } from './runs.util';

// The tabs have their own specs: here they are placeholders that show which one is open.
@Component({
  selector: 'sf-run-summary',
  standalone: true,
  template: `<p>summary tab</p><button type="button" (click)="showFindings.emit(true)">stub show errors</button>`,
})
class SummaryStub {
  readonly projectKey = input<string>();
  readonly run = input<GenerationRunView>();
  readonly showFindings = output<boolean>();
}

@Component({ selector: 'sf-run-rebuilt', standalone: true, template: `<p>rebuilt tab</p>` })
class RebuiltStub {
  readonly projectKey = input<string>();
  readonly run = input<GenerationRunView>();
}

@Component({ selector: 'sf-run-findings', standalone: true, template: `<p>findings tab</p>` })
class FindingsStub {
  readonly projectKey = input<string>();
  readonly run = input<GenerationRunView>();
}

@Component({ selector: 'sf-run-log', standalone: true, template: `<p>log tab</p><button type="button" (click)="finished.emit()">stub finished</button>` })
class LogStub {
  readonly projectKey = input<string>();
  readonly run = input<GenerationRunView>();
  readonly finished = output<void>();
}

const TARGETS = [{ id: 1, name: 'Live site', isDefault: true }];
const FINISHED: GenerationRunView = {
  id: 47,
  status: 'PARTIAL',
  mode: 'INCREMENTAL',
  targetId: 1,
  startedAt: '2026-10-09T10:00:00Z',
  finishedAt: '2026-10-09T10:03:24Z',
  startedBy: { id: 1, displayName: 'Ana' },
  planSummary: { pageCount: 14 },
  findingCounts: { errors: 2, warnings: 5 },
};
const RUNNING: GenerationRunView = { id: 48, status: 'RUNNING', mode: 'FULL', targetId: 1, startedAt: '2026-10-09T11:00:00Z', startedBy: { id: 2, displayName: 'Mira' } };
const QUEUED: GenerationRunView = { id: 49, status: 'QUEUED', mode: 'INCREMENTAL', targetId: 1, startedBy: { id: 2, displayName: 'Mira' } };

interface Setup {
  run?: GenerationRunView;
  query?: Record<string, string>;
  role?: string;
  userId?: number;
  permissions?: string[];
  stage?: string;
}

async function setup({ run = FINISHED, query = {}, role = 'DEVELOPER', userId = 1, permissions = [], stage }: Setup = {}) {
  const store = {
    targetName: () => 'Live site',
    progress: signal(new Map(stage ? [[run.id as number, { stage, files: 0, last: 1 }]] : [])),
    load: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined),
  };
  const queryParamMap = new BehaviorSubject(convertToParamMap(query));
  TestBed.overrideComponent(RunDetailComponent, {
    remove: { imports: [RunSummaryComponent, RunRebuiltComponent, RunFindingsComponent, RunLogComponent] },
    add: { imports: [SummaryStub, RebuiltStub, FindingsStub, LogStub] },
  });
  const view = await render(RunDetailComponent, {
    componentInputs: { projectKey: 'proj', run },
    providers: [
      provideRouter([]),
      { provide: RunsStore, useValue: store },
      { provide: ActivatedRoute, useValue: { queryParamMap, snapshot: { queryParamMap: queryParamMap.value } } },
      provideProjectPermissions({ role: () => role, userId: () => userId, permissions: () => permissions }),
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, store, navigate };
}

const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent?.trim();

describe('RunDetailComponent', () => {
  it('shows the run, its status and a strip of counts', async () => {
    await setup();

    expect(screen.getByRole('heading', { name: 'Run #47' })).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    const count = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling;
    expect(count('Mode')).toHaveTextContent('Incremental');
    expect(count('Target')).toHaveTextContent('Live site');
    expect(count('Pages')).toHaveTextContent('14');
    expect(count('Errors')).toHaveTextContent('2');
    expect(count('Warnings')).toHaveTextContent('5');
    expect(count('Duration')).toHaveTextContent('3 min 24 s');
  });

  it('opens a finished run on its Summary', async () => {
    await setup();

    expect(selectedTab()).toBe('Summary');
    expect(screen.getByText('summary tab')).toBeInTheDocument();
  });

  it('opens a running run on its Log, with the stage it is in', async () => {
    await setup({ run: RUNNING, stage: 'RENDER' });

    expect(selectedTab()).toBe('Log');
    expect(screen.getByText('log tab')).toBeInTheDocument();
    expect(screen.getByText('Rendering pages')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('shows a queued run as waiting', async () => {
    await setup({ run: QUEUED });

    expect(selectedTab()).toBe('Log');
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  it('opens the tab the URL names', async () => {
    await setup({ query: { rtab: 'rebuilt' } });

    expect(screen.getByText('rebuilt tab')).toBeInTheDocument();
  });

  it('opens the findings for an older link with tab=findings', async () => {
    await setup({ query: { tab: 'findings' } });

    expect(screen.getByText('findings tab')).toBeInTheDocument();
  });

  it('ignores a tab it does not know', async () => {
    await setup({ query: { rtab: 'bogus' } });

    expect(screen.getByText('summary tab')).toBeInTheDocument();
  });

  it('badges the Findings tab with the number of errors', async () => {
    await setup();

    expect(screen.getByRole('tab', { name: /Findings/ })).toHaveTextContent('2');
  });

  it('writes a chosen tab to the URL without a history entry', async () => {
    const { navigate } = await setup();

    fireEvent.click(screen.getByRole('tab', { name: /Rebuilt/ }));

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { rtab: 'rebuilt', tab: null }, queryParamsHandling: 'merge', replaceUrl: true }));
  });

  it('opens the findings on the errors from the Summary', async () => {
    const { navigate } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'stub show errors' }));

    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { rtab: 'findings', tab: null, fsev: 'error' } }));
  });

  it('goes back to the list and drops the tab and the findings filters', async () => {
    const { navigate } = await setup({ query: { rtab: 'findings', fsev: 'error' } });

    fireEvent.click(screen.getByRole('button', { name: 'All runs' }));

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { run: null, rtab: null, tab: null, fsev: null, fcat: null, frule: null, flang: null, fpath: null },
      }),
    );
  });

  it('re-reads the runs when the log ends', async () => {
    const { store } = await setup({ run: RUNNING });

    fireEvent.click(screen.getByRole('button', { name: 'stub finished' }));

    expect(store.load).toHaveBeenCalled();
  });

  it('lets a developer cancel a running run, after asking', async () => {
    const { store } = await setup({ run: RUNNING });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));

    expect(store.cancel).toHaveBeenCalledWith(RUNNING);
    expect(screen.queryByRole('button', { name: 'Promote' })).toBeNull();
  });

  it('lets a developer promote a finished run', async () => {
    const { store } = await setup();

    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));

    expect(store.promote).toHaveBeenCalledWith(FINISHED);
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });

  it('lets an editor cancel the run they started', async () => {
    await setup({ run: QUEUED, role: 'EDITOR', userId: 2, permissions: ['INCREMENTAL_BUILD'] });

    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
  });

  it('hides Cancel on someone else’s run from an editor', async () => {
    await setup({ run: RUNNING, role: 'EDITOR', userId: 1, permissions: ['INCREMENTAL_BUILD'] });

    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });

  it('hides Promote from an editor', async () => {
    await setup({ role: 'EDITOR', userId: 1, permissions: ['INCREMENTAL_BUILD'] });

    expect(screen.queryByRole('button', { name: 'Promote' })).toBeNull();
  });
});
