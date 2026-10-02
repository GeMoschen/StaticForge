import '@angular/compiler';
import { signal } from '@angular/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { HistoryActions } from '../history/history-actions.service';
import { HistoryRow } from '../history/history-rows';
import { HistoryService } from '../history/history.service';
import { TimeTravelBannerComponent } from './time-travel-banner.component';
import { TimeTravelStore } from './time-travel.store';

const NOTICE = 'Compacted history: you see the state at the end of that day';

function row(id: number, compacted: boolean): HistoryRow {
  return {
    id,
    at: Date.parse('2026-06-01T12:00:00Z'),
    byId: 1,
    byName: 'Jonas Weber',
    kind: 'edit',
    changeType: 'UPDATE',
    comment: null,
    assets: [],
    locales: [],
    compacted,
  };
}

async function setup(options: { revision: number | null; rows?: HistoryRow[]; compactedRead?: number; role?: string }) {
  const rows = options.rows ?? [];
  const actions = { rollBack: vi.fn().mockResolvedValue(true) };
  const view = await render(TimeTravelBannerComponent, {
    providers: [
      { provide: FrameContextStore, useValue: { projectKey: signal('acme') } },
      { provide: HistoryService, useValue: { revision: (_key: string, id: number) => of(rows.find((r) => r.id === id) ?? row(id, false)) } },
      { provide: HistoryActions, useValue: actions },
      provideProjectPermissions({ projectKey: 'acme', role: () => options.role ?? 'PROJECT_ADMIN', readOnly: () => false }),
    ],
  });
  const back = vi.fn();
  view.fixture.componentInstance.back.subscribe(back);
  const store = view.fixture.debugElement.injector.get(TimeTravelStore);
  if (options.revision !== null) {
    store.enter(options.revision);
  }
  if (options.compactedRead !== undefined) {
    store.noteCompactedRead(options.compactedRead);
  }
  view.fixture.detectChanges();
  return { back, actions, store, view };
}

describe('TimeTravelBannerComponent', () => {
  it('renders nothing outside time travel', async () => {
    await setup({ revision: null });

    expect(screen.queryByText(/Viewing revision/)).toBeNull();
  });

  it('names the revision, its time and its author, says it is read-only, and goes back to now', async () => {
    const { back } = await setup({ revision: 7, rows: [row(7, false)] });

    expect(screen.getByText('Viewing revision 7')).toBeTruthy();
    expect(await screen.findByText(/by Jonas Weber/)).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.queryByText(NOTICE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to now' }));
    expect(back).toHaveBeenCalled();
  });

  it('offers Restore this state to project admins only, as a roll-back to the viewed revision', async () => {
    const admin = await setup({ revision: 7, rows: [row(7, false)] });
    const restore = await screen.findByRole('button', { name: 'Restore this state' });
    fireEvent.click(restore);
    expect(admin.actions.rollBack).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    admin.view.fixture.destroy();
  });

  it('hides Restore this state from an editor', async () => {
    await setup({ revision: 7, rows: [row(7, false)], role: 'EDITOR' });
    await screen.findByText(/by Jonas Weber/);
    expect(screen.queryByRole('button', { name: 'Restore this state' })).toBeNull();
  });

  it('adds the compacted notice when the travelled-to revision is compacted', async () => {
    await setup({ revision: 4, rows: [row(4, true)] });

    await waitFor(() => expect(screen.getByText(NOTICE)).toBeTruthy());
  });

  it('adds the compacted notice when a read at the revision came back compacted', async () => {
    await setup({ revision: 5, rows: [row(5, false)], compactedRead: 5 });

    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it('a compacted read at another revision, or before leaving time travel, does not count', async () => {
    const { store, view } = await setup({ revision: 5, rows: [row(5, false)], compactedRead: 3 });
    await screen.findByText(/by Jonas Weber/);
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
