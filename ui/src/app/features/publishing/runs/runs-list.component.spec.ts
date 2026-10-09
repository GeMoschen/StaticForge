import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenuService } from '../../../shared/services/context-menu.service';
import { provideProjectPermissions } from '../../../core/project/testing/project-permissions.testing';
import { RunsListComponent } from './runs-list.component';
import { RunsStore } from './runs.store';
import type { GenerationRunView } from './runs.util';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// Runs as GET /generations sends them, newest first.
const QUEUED: GenerationRunView = { id: 49, status: 'QUEUED', mode: 'INCREMENTAL', targetId: 1, trigger: 'MANUAL', startedAt: ago(1), startedBy: { id: 2, displayName: 'Mira' }, planState: 'PENDING' };
const RUNNING: GenerationRunView = { id: 48, status: 'RUNNING', mode: 'FULL', targetId: 1, trigger: 'SCHEDULE', startedAt: ago(5), startedBy: { id: 1, displayName: 'Ana' }, planState: 'STORED', planSummary: { pageCount: 120, entryCount: 120 } };
const PARTIAL: GenerationRunView = {
  id: 47,
  status: 'PARTIAL',
  mode: 'INCREMENTAL',
  targetId: 2,
  trigger: 'RELEASE',
  startedAt: ago(60),
  finishedAt: new Date(Date.now() - 56 * 60_000 + 24_000).toISOString(),
  startedBy: { id: 1, displayName: 'Ana' },
  planState: 'STORED',
  planSummary: { pageCount: 14, entryCount: 20 },
  findingCounts: { errors: 1, warnings: 3 },
};
const FAILED: GenerationRunView = { id: 41, status: 'FAILED', mode: 'FULL', targetId: 1, trigger: 'MANUAL', startedAt: ago(500), finishedAt: ago(499), planState: 'NONE' };
const TARGETS = [
  { id: 1, name: 'Live site', isDefault: true },
  { id: 2, name: 'Staging', isDefault: false },
];

interface Setup {
  runs?: GenerationRunView[];
  role?: string;
  userId?: number;
  permissions?: string[];
  progress?: Map<number, { stage: string; files: number; last: number }>;
}

async function setup({ runs = [QUEUED, RUNNING, PARTIAL, FAILED], role = 'DEVELOPER', userId = 1, permissions = [], progress = new Map() }: Setup = {}) {
  const store = {
    runs: signal(runs),
    loaded: signal(true),
    failed: signal(false),
    targets: signal(TARGETS),
    progress: signal(progress),
    defaultTarget: signal(TARGETS[0]),
    targetName: (run: GenerationRunView) => TARGETS.find((t) => t.id === run.targetId)?.name ?? '',
    load: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined),
  };
  const view = await render(RunsListComponent, {
    providers: [
      provideRouter([]),
      { provide: RunsStore, useValue: store },
      provideProjectPermissions({ role: () => role, userId: () => userId, permissions: () => permissions }),
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { ...view, store, navigate };
}

const rows = () => screen.getAllByRole('row').slice(1);
const rowOf = (n: number) => rows().find((row) => within(row).queryByText(`#${n}`)) as HTMLElement;

async function openMenu(n: number): Promise<void> {
  fireEvent.click(within(rowOf(n)).getByRole('button', { name: `Actions for run #${n}` }));
  await screen.findByRole('menu');
}

/** The visible text of the open menu's entries (without the icon ligature). */
const items = () =>
  screen.getAllByRole('menuitem').map((item) => (item.textContent ?? '').replace(item.querySelector('sf-icon')?.textContent ?? '', '').trim());

describe('RunsListComponent', () => {
  it('lists the runs with status, mode, target, trigger, pages and findings', async () => {
    await setup();

    expect(rows()).toHaveLength(4);
    const partial = within(rowOf(47));
    expect(partial.getByText('Partial')).toBeInTheDocument();
    expect(partial.getByText('Incremental')).toBeInTheDocument();
    expect(partial.getByText('Staging')).toBeInTheDocument();
    expect(partial.getByText('After a release')).toBeInTheDocument();
    expect(partial.getByText('4 min 24 s')).toBeInTheDocument();
    expect(partial.getByText('14')).toBeInTheDocument();
    expect(partial.getByText('1 errors · 3 warnings')).toHaveClass('runs__errors');
    expect(within(rowOf(41)).getByText('Failed')).toBeInTheDocument();
    expect(within(rowOf(41)).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows a queued run as waiting and a running one with the stage it is in', async () => {
    await setup({ progress: new Map([[48, { stage: 'RENDER', files: 40, last: 9 }]]) });

    expect(within(rowOf(49)).getByText('Queued')).toBeInTheDocument();
    expect(within(rowOf(49)).getByText('Waiting')).toBeInTheDocument();
    expect(within(rowOf(48)).getByText('Rendering pages')).toBeInTheDocument();
    expect(within(rowOf(48)).getByText('In progress')).toBeInTheDocument();
  });

  it('filters by status and by search', async () => {
    await setup();

    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'failed' } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]).getByText('#41')).toBeInTheDocument();
  });

  it('offers Open, Live log and Cancel for a running run to a developer', async () => {
    const { store } = await setup();
    await openMenu(48);

    expect(items()).toEqual(['Open', 'Live log', 'Cancel run']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel run' }));
    expect(store.cancel).toHaveBeenCalledWith(RUNNING);
  });

  it('offers Promote for a finished run with output, to developers', async () => {
    const { store } = await setup();
    await openMenu(47);

    expect(items()).toEqual(['Open', 'Promote']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Promote' }));
    expect(store.promote).toHaveBeenCalledWith(PARTIAL);
  });

  it('offers a failed run only Open', async () => {
    await setup();
    await openMenu(41);

    expect(items()).toEqual(['Open']);
  });

  it('lets an editor cancel only the runs they started, and never promote', async () => {
    await setup({ role: 'EDITOR', userId: 2, permissions: ['INCREMENTAL_BUILD'] });

    await openMenu(49);
    expect(items()).toEqual(['Open', 'Live log', 'Cancel run']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await openMenu(48);
    expect(items()).toEqual(['Open', 'Live log']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await openMenu(47);
    expect(items()).toEqual(['Open']);
  });

  it('opens a run in the URL, and its log from Live log', async () => {
    const { navigate } = await setup();

    fireEvent.click(within(rowOf(47)).getByText('Staging'));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls[0][1]).toMatchObject({ queryParams: { run: 47, rtab: null }, queryParamsHandling: 'merge' });

    await openMenu(48);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Live log' }));
    expect(navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { run: 48, rtab: 'log' } });
  });

  it('opens the menu with a right click', async () => {
    await setup();

    fireEvent.contextMenu(rowOf(48));

    expect(TestBed.inject(ContextMenuService).state()?.items.map((item) => item.label)).toEqual(['Open', 'Live log', 'Cancel run']);
  });

  it('says so when there are no runs', async () => {
    await setup({ runs: [] });

    expect(screen.getByText('No builds yet')).toBeInTheDocument();
  });
});
