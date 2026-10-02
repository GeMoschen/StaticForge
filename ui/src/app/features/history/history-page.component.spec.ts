import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { SfVisualDiffComponent } from '../revisions/visual-diff/visual-diff.component';
import { ReleaseEventsStore } from '../release/release-events.store';
import { HistoryActions } from './history-actions.service';
import { HistoryPageComponent } from './history-page.component';
import { HistoryRevisionComponent } from './history-revision.component';
import { HistoryRow } from './history-rows';
import { HistoryService } from './history.service';

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
    assets: [{ uuid: UUID, uid: 'spring_harvest', name: 'Spring harvest arrives', type: 'PAGE', action: 'update', locales: ['de', 'en'] }],
    locales: ['DE', 'EN'],
    compacted: false,
    ...over,
  };
}

const ROWS = [row(90), row(89, { kind: 'release', changeType: 'RELEASE' }), row(88)];

@Component({ selector: 'sf-visual-diff', standalone: true, template: '<div data-testid="visual-diff"></div>' })
class VisualDiffStub {
  readonly asset = input<unknown>();
  readonly projectKey = input<string>();
  readonly revisionId = input<number>();
}

async function setup({ revisionId, role = 'PROJECT_ADMIN' }: { revisionId?: string; role?: string } = {}) {
  const list = vi.fn().mockReturnValue(of({ rows: ROWS, total: 137 }));
  const revision = vi.fn().mockImplementation((_key: string, id: number) => of(ROWS.find((r) => r.id === id) ?? row(id)));
  const revisionDiff = vi.fn().mockReturnValue(of({ revisionId: 89, assets: [{ uuid: UUID, uid: 'spring_harvest', type: 'PAGE', action: 'UPDATE', changes: [] }] }));
  const actions = { view: vi.fn(), restoreAsset: vi.fn(), rollBack: vi.fn() };
  TestBed.overrideComponent(HistoryRevisionComponent, { remove: { imports: [SfVisualDiffComponent] }, add: { imports: [VisualDiffStub] } });
  const view = await render(HistoryPageComponent, {
    componentInputs: { projectKey: 'acme', revisionId },
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: HistoryService, useValue: { list, revision, revisionDiff } },
      { provide: HistoryActions, useValue: actions },
      { provide: ApiClient, useValue: { listMembers: () => of([{ userId: 4, displayName: 'Anna Berger' }]) } },
      provideProjectPermissions({ projectKey: 'acme', role: () => role, readOnly: () => false }),
    ],
  });
  await waitFor(() => expect(list).toHaveBeenCalled());
  return { ...view, list, revision, revisionDiff, actions };
}

describe('HistoryPageComponent', () => {
  it('shows the timeline: the total, a human summary per revision, its type, the items by name and the author', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    expect(await screen.findByText('137 revisions')).toBeInTheDocument();
    const table = await screen.findByRole('grid', { name: 'Project revisions' });
    expect(within(table).getAllByText('Changed Spring harvest arrives')).toHaveLength(2);
    expect(within(table).getByText('Released Spring harvest arrives')).toBeInTheDocument();
    expect(within(table).getAllByText('Release').length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/Anna Berger/).length).toBe(3);
    // No raw ids anywhere in the table.
    expect(table.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('loads the first page of 50 and filters through the API', async () => {
    const { list } = await setup();
    expect(list).toHaveBeenCalledWith('acme', expect.objectContaining({ page: 0, size: 50 }));
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Release/ }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith('acme', expect.objectContaining({ filter: expect.objectContaining({ kind: 'release' }), page: 0 })),
    );
    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('reads the timeline again after a restore, a roll-back or a release added revisions', async () => {
    const { list } = await setup();
    const calls = list.mock.calls.length;
    TestBed.inject(ReleaseEventsStore).changed();
    await waitFor(() => expect(list.mock.calls.length).toBe(calls + 1));
    expect(list).toHaveBeenLastCalledWith('acme', expect.objectContaining({ page: 0 }));
  });

  it('opens a revision in the detail pane: its items by name, with the diff, and highlights its row', async () => {
    await setup({ revisionId: '89' });
    const pane = await screen.findByRole('region', { name: 'Revision 89' });
    expect(within(pane).getByRole('heading', { level: 2, name: 'Revision 89' })).toBeInTheDocument();
    expect(await within(pane).findByText('1 item changed')).toBeInTheDocument();
    expect(within(pane).getByText('Spring harvest arrives')).toBeInTheDocument();
    expect(within(pane).getByTestId('visual-diff')).toBeInTheDocument();
    expect(pane.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(document.querySelector('tr[aria-current="true"]')?.textContent).toContain('89');
  });

  it('goes to /history/:revisionId when a row is opened, and back to the list when the pane is closed', async () => {
    await setup({ revisionId: '89' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Close the revision' }));
    expect(navigate).toHaveBeenCalledWith(['/p', 'acme', 'history'], { queryParamsHandling: 'preserve' });

    const rows = await screen.findAllByRole('row');
    fireEvent.click(rows.find((r) => r.textContent?.includes('88'))!);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'acme', 'history', 88], { queryParamsHandling: 'preserve' }));
  });

  it('views the state and rolls back through the shared actions', async () => {
    const { actions } = await setup({ revisionId: '89' });
    fireEvent.click(await screen.findByRole('button', { name: 'View this state' }));
    expect(actions.view).toHaveBeenCalledWith(expect.objectContaining({ id: 89 }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll back project…' }));
    expect(actions.rollBack).toHaveBeenCalledWith(expect.objectContaining({ id: 89 }));
  });

  it('offers roll-back only to project admins, and Restore this item only to people who may edit', async () => {
    await setup({ revisionId: '89', role: 'EDITOR' });
    await screen.findByRole('region', { name: 'Revision 89' });
    expect(screen.queryByRole('button', { name: 'Roll back project…' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Restore this item' })).toBeInTheDocument();
  });

  it('shows no restore at all to a viewer', async () => {
    await setup({ revisionId: '89', role: 'VIEWER' });
    await screen.findByRole('region', { name: 'Revision 89' });
    expect(screen.queryByRole('button', { name: 'Roll back project…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore this item' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View this state' })).toBeInTheDocument();
  });
});

