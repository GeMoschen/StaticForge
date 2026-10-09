import '@angular/compiler';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { GenerationService } from '../../generation/generation.service';
import { RunRebuiltComponent } from './run-rebuilt.component';
import { RunsStore } from './runs.store';
import type { GenerationRunView } from './runs.util';

// A stored plan as GET /generations/{id}/plan sends it.
const ENTRIES = {
  content: [
    {
      assetUuid: 'u1',
      assetType: 'PAGE',
      uid: 'spring-harvest',
      displayName: 'Spring harvest',
      channel: 'html',
      locale: 'de',
      outputPath: 'de/news/spring-harvest.html',
      reason: { rootKind: 'ASSET_CHANGED', rootAsset: { type: 'SECTION_TEMPLATE', uid: 'teaser' }, rootRevision: 1842 },
    },
    {
      assetUuid: 'u2',
      assetType: 'MEDIA',
      uid: 'hero',
      channel: 'files',
      outputPath: 'media/hero.jpg',
      reason: { rootKind: 'ASSET_CHANGED', rootAsset: { type: 'MEDIA', uid: 'hero' }, rootRevision: 1843 },
    },
  ],
  page: { totalElements: 12, totalPages: 1 },
};

const RUN: GenerationRunView = {
  id: 47,
  status: 'PARTIAL',
  mode: 'INCREMENTAL',
  targetId: 1,
  planState: 'STORED',
  planSummary: {
    mode: 'INCREMENTAL',
    incremental: true,
    pageCount: 11,
    entryCount: 12,
    changedAssetCount: 3,
    channels: ['html', 'files'],
    byRootKind: { ASSET_CHANGED: 10, ASSET_RELEASED: 2 },
    via: [
      { assetType: 'SECTION_TEMPLATE', uid: 'teaser', assetUuid: 'a1', count: 8 },
      { assetType: 'MEDIA', uid: 'hero', assetUuid: 'a2', count: 2 },
    ],
    planAvailable: true,
  },
};

async function setup(run: GenerationRunView = RUN, developer = false) {
  const api = { getRunPlan: vi.fn().mockReturnValue(of({ entries: ENTRIES })) };
  const view = await render(RunRebuiltComponent, {
    componentInputs: { projectKey: 'proj', run },
    providers: [
      { provide: GenerationService, useValue: api },
      { provide: RunsStore, useValue: { targetName: () => 'Live site' } },
      { provide: DeveloperModeService, useValue: { enabled: signal(developer) } },
    ],
  });
  return { ...view, api };
}

describe('RunRebuiltComponent', () => {
  it('shows the plan line, the changes behind the rebuild and the kinds of change', async () => {
    await setup();

    expect(screen.getByText('Plan: 11 pages rebuilt because of 3 changes (Incremental).')).toBeInTheDocument();
    const changes = screen.getByRole('region', { name: 'Changes behind the rebuild' });
    expect(within(changes).getByText('section_template:teaser')).toBeInTheDocument();
    expect(within(changes).getByText('8 files')).toBeInTheDocument();
    expect(within(changes).getByText('media:hero')).toBeInTheDocument();
    const kinds = screen.getByRole('region', { name: 'Kind of change' });
    expect(within(kinds).getByText('Changed')).toBeInTheDocument();
    expect(within(kinds).getByText('10 files')).toBeInTheDocument();
    expect(within(kinds).getByText('Released')).toBeInTheDocument();
  });

  it('counts the changes the server did not name', async () => {
    await setup({ ...RUN, planSummary: { ...RUN.planSummary, changedAssetCount: 9 } });

    expect(screen.getByText('+ 4 more changes')).toBeInTheDocument();
  });

  it('says why an incremental build rebuilt everything', async () => {
    await setup({ ...RUN, planSummary: { ...RUN.planSummary, fallbackCause: 'BASE_BUILD_MISSING' } });

    expect(screen.getByText(/Incremental fell back to a full build: the previous build of target Live site is no longer available\./)).toBeInTheDocument();
  });

  it('reads the rebuilt files from the stored plan and shows why and because of what', async () => {
    const { api } = await setup();

    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(3));
    expect(api.getRunPlan).toHaveBeenCalledWith('proj', 47, { page: 0, size: 50, q: undefined, rootKind: undefined, channel: undefined });
    const [page, file] = screen.getAllByRole('row').slice(1);
    expect(within(page).getByText('Spring harvest')).toBeInTheDocument();
    expect(within(page).getByText('DE')).toBeInTheDocument();
    expect(within(page).getByText('Changed')).toBeInTheDocument();
    expect(within(page).getByText('section_template:teaser · r1842')).toBeInTheDocument();
    expect(within(file).getByText('media:hero')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Output path' })).toBeNull();
  });

  it('shows the output path in developer mode', async () => {
    await setup(RUN, true);

    expect(await screen.findByText('de/news/spring-harvest.html')).toBeInTheDocument();
  });

  it('searches the plan on the server', async () => {
    vi.useFakeTimers();
    try {
      const { api } = await setup();
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'news' } });
      vi.advanceTimersByTime(400);

      expect(api.getRunPlan).toHaveBeenLastCalledWith('proj', 47, expect.objectContaining({ q: 'news', page: 0 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the plan cannot be read', async () => {
    const { api } = await setup();
    api.getRunPlan.mockReturnValue(throwError(() => new Error('down')));
    api.getRunPlan.mockClear();

    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByText('The rebuilt pages could not be loaded.')).toBeInTheDocument(), { timeout: 2000 });
  });

  it.each([
    [{ planState: 'PENDING' as const }, 'The plan is made when the run starts'],
    [{ planState: 'NONE' as const, planSummary: undefined }, 'No plan was stored for this run'],
    [{ planState: 'PRUNED' as const }, 'The plan was removed by retention'],
    [{ planState: 'STORED' as const, planSummary: { entryCount: 0, pageCount: 0 } }, 'Nothing was rebuilt'],
  ])('shows an empty state instead of the plan (%j)', async (over, title) => {
    const { api } = await setup({ ...RUN, ...over });

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(api.getRunPlan).not.toHaveBeenCalled();
  });
});
