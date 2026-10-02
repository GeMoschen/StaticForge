import '@angular/compiler';
import { Component, input, signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import type { FrameItem } from '../../core/frame/breadcrumb.util';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ReleaseEventsStore } from '../release/release-events.store';
import { HistoryActions } from './history-actions.service';
import { HistoryDrawerComponent } from './history-drawer.component';
import { HistoryDrawerStore } from './history-drawer.store';
import { HistoryRow } from './history-rows';
import { HistoryService } from './history.service';
import { SfVisualDiffComponent } from '../revisions/visual-diff/visual-diff.component';

/** The visual diff loads templates through the API; its own spec covers it. */
@Component({ selector: 'sf-visual-diff', standalone: true, template: '<div data-testid="visual-diff"></div>' })
class VisualDiffStub {
  readonly asset = input<unknown>();
  readonly projectKey = input<string>();
  readonly revisionId = input<number>();
}

const UUID = '11111111-2222-3333-4444-555555555555';

function row(id: number, over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id,
    at: Date.now() - id * 60_000,
    byId: 4,
    byName: 'Anna Berger',
    kind: 'edit',
    changeType: 'UPDATE',
    comment: null,
    assets: [{ uuid: UUID, uid: 'spring_harvest', name: 'Spring harvest arrives', type: 'PAGE', action: 'update', locales: ['de'] }],
    locales: ['DE'],
    compacted: false,
    ...over,
  };
}

const ROWS = [row(90), row(89, { kind: 'release', changeType: 'RELEASE' }), row(88)];

async function setup({ item = null as FrameItem | null, canEdit = true } = {}) {
  const list = vi.fn().mockReturnValue(of({ rows: ROWS, total: ROWS.length }));
  const assetDiff = vi.fn().mockReturnValue(of({ uuid: UUID, uid: 'spring_harvest', type: 'PAGE', action: 'UPDATE', changes: [] }));
  const actions = { view: vi.fn(), restoreAsset: vi.fn().mockResolvedValue(true), rollBack: vi.fn() };
  TestBed.overrideComponent(HistoryDrawerComponent, { remove: { imports: [SfVisualDiffComponent] }, add: { imports: [VisualDiffStub] } });
  const view = await render(HistoryDrawerComponent, {
    providers: [
      provideRouter([]),
      { provide: FrameContextStore, useValue: { projectKey: signal('acme'), item: signal(item) } },
      { provide: HistoryService, useValue: { list, assetDiff } },
      { provide: HistoryActions, useValue: actions },
      { provide: ApiClient, useValue: { listMembers: () => of([{ userId: 4, displayName: 'Anna Berger' }]) } },
      { provide: AuthStore, useValue: { userId: () => 4, isArchived: () => false } },
      provideProjectPermissions({ projectKey: 'acme', role: () => (canEdit ? 'EDITOR' : 'VIEWER'), readOnly: () => false }),
    ],
  });
  await waitFor(() => expect(list).toHaveBeenCalled());
  return { ...view, list, assetDiff, actions };
}

describe('HistoryDrawerComponent in the project', () => {
  it('lists the project timeline with its filters, names the author, and asks for no single item', async () => {
    const { list } = await setup();
    expect(await screen.findByText('Project history')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter the history' })).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('acme', expect.objectContaining({ assetUuid: undefined, page: 0 }));
    expect(await screen.findAllByText('Changed Spring harvest arrives')).toHaveLength(2);
    expect(screen.getAllByText('Released Spring harvest arrives')).toHaveLength(1);
    // The author is you.
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    // There is no "current" version or Compare in the project timeline.
    expect(screen.queryByText('Current')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compare with current' })).toBeNull();
  });

  it('reads the list again after a restore, a roll-back or a release added revisions', async () => {
    const { list } = await setup();
    await screen.findByText('Project history');
    const calls = list.mock.calls.length;
    TestBed.inject(ReleaseEventsStore).changed();
    await waitFor(() => expect(list.mock.calls.length).toBe(calls + 1));
  });

  it('views a revision and opens the full history on it', async () => {
    const { actions } = await setup();
    fireEvent.click((await screen.findAllByRole('button', { name: 'View' }))[0]);
    expect(actions.view).toHaveBeenCalledWith(expect.objectContaining({ id: 90 }));

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(HistoryDrawerStore).open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[1]);
    expect(navigate).toHaveBeenCalledWith(['/p', 'acme', 'history'], { queryParams: { rev: 89 } });
    expect(TestBed.inject(HistoryDrawerStore).isOpen()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Open full history' }));
    expect(navigate).toHaveBeenLastCalledWith(['/p', 'acme', 'history'], { queryParams: {} });
  });

  it('filters by type through the API', async () => {
    const { list } = await setup();
    await screen.findByText('Project history');
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Release/ }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith('acme', expect.objectContaining({ filter: expect.objectContaining({ kind: 'release' }), page: 0 })),
    );
  });
});

describe('HistoryDrawerComponent in an editor', () => {
  const item: FrameItem = { label: 'Spring harvest arrives', asset: { uuid: UUID } };

  it("lists that item's versions, the newest as current", async () => {
    const { list } = await setup({ item });
    expect(await screen.findByText(/History of “Spring harvest arrives”/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('acme', expect.objectContaining({ assetUuid: UUID }));
    expect(await screen.findByText('Current')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter the history' })).toBeNull();
    // Compare and Restore are for the older versions only.
    expect(screen.getAllByRole('button', { name: 'Compare with current' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(2);
  });

  it('compares a version with the current state through the item diff', async () => {
    const { assetDiff } = await setup({ item });
    await screen.findByText('Current');
    fireEvent.click(screen.getAllByRole('button', { name: 'Compare with current' })[0]);
    await waitFor(() => expect(assetDiff).toHaveBeenCalledWith('acme', UUID, 89));
    expect(await screen.findByText(/against the current state/)).toBeInTheDocument();
    expect(await screen.findByTestId('visual-diff')).toBeInTheDocument();
  });

  it('restores through the shared action, passing the current revision for Undo', async () => {
    const { actions } = await setup({ item });
    await screen.findByText('Current');
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);
    expect(actions.restoreAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 89 }), expect.objectContaining({ uuid: UUID }), 90);
  });

  it('offers no Restore to someone who cannot edit', async () => {
    await setup({ item, canEdit: false });
    await screen.findByText('Current');
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(within(document.body).getAllByRole('button', { name: 'Compare with current' }).length).toBeGreaterThan(0);
  });
});
