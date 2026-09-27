import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import type { components } from '../../core/api/generated/schema.d.ts';
import { TimeTravelBannerComponent } from './time-travel-banner.component';
import { TimeTravelStore } from './time-travel.store';

type RevisionView = components['schemas']['RevisionView'];

const NOTICE = 'Compacted history: you see the state at the end of that day';

/** `GET /projects/{key}/revisions` entries as the API sends them after a compaction run. */
function revision(revisionId: number, compacted: boolean): RevisionView {
  return {
    projectId: 1,
    revisionId,
    createdAt: '2026-06-01T12:00:00Z',
    createdBy: 1,
    changeType: 'UPDATE',
    summary: { assets: [{ uuid: 'a-1', type: 'PAGE', action: 'UPDATE' }] } as never,
    compacted,
  };
}

async function setup(options: { revision: number | null; revisions?: RevisionView[]; compactedRead?: number }) {
  const back = vi.fn();
  const view = await render(TimeTravelBannerComponent, {
    componentInputs: { revisions: options.revisions ?? [] },
  });
  view.fixture.componentInstance.back.subscribe(back);
  const store = view.fixture.debugElement.injector.get(TimeTravelStore);
  if (options.revision !== null) {
    store.enter(options.revision);
  }
  if (options.compactedRead !== undefined) {
    store.noteCompactedRead(options.compactedRead);
  }
  view.fixture.detectChanges();
  return { back, store, view };
}

describe('TimeTravelBannerComponent', () => {
  it('renders nothing outside time travel', async () => {
    await setup({ revision: null });

    expect(screen.queryByText(/Viewing revision/)).toBeNull();
  });

  it('an exact revision shows the plain banner', async () => {
    const { back } = await setup({ revision: 7, revisions: [revision(7, false)] });

    expect(screen.getByText('Viewing revision 7')).toBeTruthy();
    expect(screen.queryByText(NOTICE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to now' }));
    expect(back).toHaveBeenCalled();
  });

  it('adds the compacted notice when the travelled-to revision is compacted', async () => {
    await setup({ revision: 4, revisions: [revision(4, true), revision(5, false)] });

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('adds the compacted notice when a read at the revision came back compacted', async () => {
    await setup({ revision: 5, revisions: [revision(4, true), revision(5, false)], compactedRead: 5 });

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('a compacted read at another revision, or before leaving time travel, does not count', async () => {
    const { store, view } = await setup({ revision: 5, revisions: [revision(5, false)], compactedRead: 3 });
    expect(screen.queryByText(NOTICE)).toBeNull();

    store.noteCompactedRead(5);
    view.fixture.detectChanges();
    expect(screen.getByText(NOTICE)).toBeTruthy();

    store.exit();
    store.enter(5);
    view.fixture.detectChanges();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
