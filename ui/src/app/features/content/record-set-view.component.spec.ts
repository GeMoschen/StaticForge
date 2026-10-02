import '@angular/compiler';
import { provideRouter, Router } from '@angular/router';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, type DatasetDetailView, type RecordSetDetailView } from './content.service';
import { RecordSetViewComponent } from './record-set-view.component';
import { stubReleaseBar } from '../release/testing/release-bar.stub';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';

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
    restoreAsset: vi.fn().mockReturnValue(of({})),
  };
}

async function setup(
  content: ReturnType<typeof contentStub>,
  options: { role?: string; revision?: number; panel?: string; api?: ReturnType<typeof apiStub>; confirm?: ReturnType<typeof vi.fn> } = {},
) {
  const timeTravel = new TimeTravelStore();
  if (options.revision != null) {
    timeTravel.enter(options.revision);
  }
  const view = await render(RecordSetViewComponent, {
    componentInputs: { projectKey: 'proj', setUuid: 'set-uuid', panel: options.panel },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: options.api ?? apiStub() },
      { provide: ConfirmService, useValue: { confirm: options.confirm ?? vi.fn().mockResolvedValue(true) } },
      { provide: AuthStore, useValue: { roleFor: () => options.role ?? 'EDITOR' } },
      { provide: TimeTravelStore, useValue: timeTravel },
      provideProjectPermissions({ role: () => options.role ?? 'EDITOR', readOnly: () => timeTravel.isTimeTravel() }),
    ],
  });
  const router = view.fixture.debugElement.injector.get(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { ...view, navigate };
}

describe('RecordSetViewComponent', () => {
  beforeEach(() => stubReleaseBar(RecordSetViewComponent));
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
    const confirm = vi.fn().mockResolvedValue(true);
    const { navigate } = await setup(content, { confirm });
    await screen.findByRole('heading', { name: 'Leads' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));

    await waitFor(() => expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-uuid', true));
    const options = confirm.mock.calls[0][0];
    expect(options.message).toContain('and its 12 records');
    expect(options.tone).toBe('danger');
    expect(options.typeToConfirm).toBeUndefined();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content']));
  });

  it('offers Undo after the delete, which restores the set from its last live revision', async () => {
    const content = contentStub();
    const api = apiStub();
    const view = await setup(content, { api });
    await screen.findByRole('heading', { name: 'Leads' });
    const toasts = view.fixture.debugElement.injector.get(ToastService);

    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));
    await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Deleted “Leads” and its 12 records.'));

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-uuid', { fromRevision: 5 }));
  });

  it('shows the error toast when the Undo of a delete fails', async () => {
    const api = apiStub();
    api.restoreAsset.mockReturnValue(throwError(() => new Error('409')));
    const view = await setup(contentStub(), { api });
    await screen.findByRole('heading', { name: 'Leads' });
    const toasts = view.fixture.debugElement.injector.get(ToastService);
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));
    await waitFor(() => expect(toasts.toasts().at(-1)?.action).toBeDefined());

    toasts.toasts().at(-1)!.action!.run();

    await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
  });

  it('asks for the typed word before deleting a set with 25 or more records', async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    await setup(contentStub({ ...SET, recordCount: 40 }), { confirm });
    await screen.findByRole('heading', { name: 'Leads' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
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

  it('offers no edits to an editor of an archived project (M26)', async () => {
    const content = contentStub();
    await render(RecordSetViewComponent, {
      componentInputs: { projectKey: 'proj', setUuid: 'set-uuid' },
      providers: [
        provideRouter([]),
        { provide: ContentService, useValue: content },
        { provide: ApiClient, useValue: apiStub() },
        // Role and read-only state from the real stores: the archived project lowers the editor to viewer.
        provideProjectPermissions(),
      ],
      configureTestBed: (tb) => {
        const auth = tb.inject(AuthStore);
        auth.setUser({ id: 2, username: 'ed', systemRole: 'USER', projectRoles: { proj: 'EDITOR' } });
        auth.setProjectArchived('proj', true);
      },
    });

    await screen.findByRole('heading', { name: 'Leads' });
    expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete set' })).toBeNull();
  });

  it('opens the tab the tree asked for', async () => {
    await setup(contentStub(), { panel: 'history' });

    expect(await screen.findByText('rev 5')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
  });
});
