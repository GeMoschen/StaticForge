import '@angular/compiler';
import { provideRouter, Router } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, type DatasetDetailView, type RecordSetDetailView } from './content.service';
import { RecordSetViewComponent } from './record-set-view.component';

const SET: RecordSetDetailView = {
  uuid: 'set-uuid',
  uid: 'leads',
  displayName: 'Leads',
  dataset: { uuid: 'ds-team', uid: 'team', displayName: 'Team' },
  folderUuid: 'folder-team',
  folderPath: '/team/',
  query: { where: "role == 'lead'" },
  queryValid: true,
  queryDiagnostics: [],
  recordCount: 12,
  revision: 5,
};

// `compiledDefinition` is `JsonNode` on the server (`Record<string, never>` in the generated types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  compiledDefinition: { editors: [{ name: 'role', type: 'TEXT', label: 'Role' }], bodies: [] },
} as unknown as DatasetDetailView;

function contentStub(set: RecordSetDetailView = SET) {
  return {
    getRecordSet: vi.fn().mockReturnValue(of(set)),
    getDataset: vi.fn().mockReturnValue(of(DATASET)),
    listSetRecords: vi.fn().mockReturnValue(of({ content: [], page: { totalElements: 0, totalPages: 0 } })),
    previewSetQuery: vi.fn().mockReturnValue(of({ valid: true, diagnostics: [], matchCount: 4, selectedCount: 4 })),
    updateRecordSet: vi.fn(),
    createRecord: vi.fn().mockReturnValue(of({ uuid: 'rec-new' })),
    deleteRecordSet: vi.fn().mockReturnValue(of(undefined)),
  };
}

function apiStub() {
  return {
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 5, displayName: 'Leads', deleted: false }])),
    assetUsages: vi.fn().mockReturnValue(of([])),
    restoreAsset: vi.fn(),
  };
}

async function setup(content: ReturnType<typeof contentStub>, options: { role?: string; revision?: number; panel?: string } = {}) {
  const timeTravel = new TimeTravelStore();
  if (options.revision != null) {
    timeTravel.enter(options.revision);
  }
  const view = await render(RecordSetViewComponent, {
    componentInputs: { projectKey: 'proj', setUuid: 'set-uuid', panel: options.panel },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: apiStub() },
      { provide: AuthStore, useValue: { roleFor: () => options.role ?? 'EDITOR' } },
      { provide: TimeTravelStore, useValue: timeTravel },
    ],
  });
  const router = view.fixture.debugElement.injector.get(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { ...view, navigate };
}

describe('RecordSetViewComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the set with its dataset, folder, record count, query panel and grid', async () => {
    const content = contentStub();
    await setup(content);

    expect(await screen.findByRole('heading', { name: 'Leads' })).toBeTruthy();
    expect(screen.getByText('12 records')).toBeTruthy();
    expect(screen.getByText('/team/')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set query' })).toBeTruthy();
    await waitFor(() => expect(content.listSetRecords).toHaveBeenCalled());
    expect(content.getDataset).toHaveBeenCalledWith('proj', 'ds-team', null);
  });

  it('warns when the stored set query is invalid', async () => {
    await setup(contentStub({ ...SET, queryValid: false }));

    expect(await screen.findByText('Query invalid')).toBeTruthy();
  });

  /**
   * A record is created in this set at once — the set's dataset in the path, the set in the body. Nothing
   * is asked: the server derives its uid from its uuid and its name from its title field.
   */
  it('creates a record in this set and opens it, without asking for a name', async () => {
    const content = contentStub();
    const { navigate } = await setup(content);
    await screen.findByRole('heading', { name: 'Leads' });

    fireEvent.click(screen.getByRole('button', { name: 'New record' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(content.createRecord).toHaveBeenCalledWith('proj', 'ds-team', { recordSetUuid: 'set-uuid', content: {} });
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content', 'records', 'rec-new']);
  });

  it('deletes the set with its records after a confirmation naming them', async () => {
    const content = contentStub();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { navigate } = await setup(content);
    await screen.findByRole('heading', { name: 'Leads' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));

    expect(confirm.mock.calls[0][0]).toContain('and its 12 records');
    expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-uuid', true);
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content']);
  });

  it('reads the set and its records at the time-travel revision and offers no edits', async () => {
    const content = contentStub();
    await setup(content, { revision: 7 });

    expect(await screen.findByText(/the set and its query are read-only/)).toBeTruthy();
    expect(content.getRecordSet).toHaveBeenCalledWith('proj', 'set-uuid', 7);
    await waitFor(() => expect(content.listSetRecords).toHaveBeenCalled());
    expect(content.listSetRecords.mock.calls.every((call) => call[2].revision === 7)).toBe(true);
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete set' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save query' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use as set query' })).toBeNull();
    expect(content.previewSetQuery).not.toHaveBeenCalled();
  });

  it('opens the tab the tree asked for', async () => {
    await setup(contentStub(), { panel: 'history' });

    expect(await screen.findByText('rev 5')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
  });
});
