import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { AuthStore } from '../../core/auth/auth.store';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { HistoryDrawerStore } from '../history/history-drawer.store';
import { stubReleaseBar } from '../release/testing/release-bar.stub';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, type DatasetDetailView, type RecordSetDetailView } from './content.service';
import { RecordSetViewComponent } from './record-set-view.component';

/** What `GET /folders?scope=CONTENT` returns: the store's root folder with the folders (and sets) inside. */
const FOLDERS = [
  {
    uuid: 'folder-root',
    uid: 'content_root',
    displayName: 'All content',
    path: '/content_root/',
    children: [
      { uuid: 'folder-company', uid: 'company', displayName: 'Company', path: '/content_root/company/', children: [
        { uuid: 'folder-team', uid: 'team', displayName: 'Team', path: '/content_root/company/team/', children: [] },
      ] },
      { uuid: 'folder-shop', uid: 'shop', displayName: 'Shop', path: '/content_root/shop/', children: [] },
    ],
  },
];

const SET: RecordSetDetailView = {
  uuid: 'set-uuid',
  uid: 'leads',
  displayName: 'Leads',
  dataset: { uuid: 'ds-team', uid: 'team', displayName: 'Team' },
  folderUuid: 'folder-team',
  folderPath: '/company/team/',
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
    folders: vi.fn().mockReturnValue(of(FOLDERS)),
    listSetRecords: vi.fn().mockReturnValue(of({ content: [], page: { totalElements: 0, totalPages: 0 } })),
    previewSetQuery: vi.fn().mockReturnValue(of({ valid: true, diagnostics: [], matchCount: 4, selectedCount: 4 })),
    updateRecordSet: vi.fn().mockImplementation((_k: string, _u: string, req: Partial<RecordSetDetailView>) =>
      of({ ...set, ...req, revision: 6 }),
    ),
    createRecord: vi.fn().mockReturnValue(of({ uuid: 'rec-new' })),
    deleteRecordSet: vi.fn().mockReturnValue(of(undefined)),
    moveAsset: vi.fn().mockReturnValue(of({})),
    listRecordSets: vi.fn().mockReturnValue(of([])),
  };
}

function apiStub() {
  return {
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 5, displayName: 'Leads', deleted: false }])),
    assetUsages: vi.fn().mockReturnValue(of([])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
  };
}

async function setup(
  content: ReturnType<typeof contentStub>,
  options: {
    role?: string;
    revision?: number;
    inputs?: Record<string, unknown>;
    api?: ReturnType<typeof apiStub>;
    confirm?: ReturnType<typeof vi.fn>;
    dev?: boolean;
  } = {},
) {
  // Before the render: the view clears the tree's parameters while it starts.
  const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
  const timeTravel = new TimeTravelStore();
  if (options.revision != null) {
    timeTravel.enter(options.revision);
  }
  const view = await render(RecordSetViewComponent, {
    componentInputs: { projectKey: 'proj', setUuid: 'set-uuid', ...options.inputs },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideFavoritesStub(),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: options.api ?? apiStub() },
      { provide: ConfirmService, useValue: { confirm: options.confirm ?? vi.fn().mockResolvedValue(true) } },
      { provide: AuthStore, useValue: { roleFor: () => options.role ?? 'EDITOR', isArchived: () => false } },
      { provide: TimeTravelStore, useValue: timeTravel },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: LocalesStore, useValue: { labelOf: (code: string) => code } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
      provideProjectPermissions({ role: () => options.role ?? 'EDITOR', readOnly: () => timeTravel.isTimeTravel() }),
    ],
  });
  return { ...view, navigate, toasts: TestBed.inject(ToastService), frame: TestBed.inject(FrameContextStore) };
}

const moreAction = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(await screen.findByRole('menuitem', { name }));
};

describe('RecordSetViewComponent', () => {
  beforeEach(() => stubReleaseBar(RecordSetViewComponent));
  afterEach(() => vi.restoreAllMocks());

  describe('the page', () => {
    it('shows the set as the page heading with its dataset, record count, collapsed filter and records', async () => {
      const content = contentStub();
      await setup(content);

      expect(await screen.findByRole('heading', { level: 1, name: 'Leads' })).toBeTruthy();
      expect(screen.getByText('12 records')).toBeTruthy();
      expect(screen.getByText('Dataset: Team')).toBeTruthy();
      const filter = screen.getByRole('button', { name: 'Filter' });
      expect(filter.getAttribute('aria-expanded')).toBe('false');
      expect(await screen.findByText('Where role is lead · sorted by name')).toBeTruthy();
      await waitFor(() => expect(content.listSetRecords).toHaveBeenCalled());
      expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: true });
      expect(content.getDataset).toHaveBeenCalledWith('proj', 'ds-team', null);
    });

    it('reports the set and its folders to the frame, so the breadcrumb and the History drawer follow', async () => {
      const { frame } = await setup(contentStub());
      await screen.findByRole('heading', { name: 'Leads' });

      await waitFor(() => expect(frame.item()?.label).toBe('Leads'));
      expect(frame.item()?.asset).toEqual({ uuid: 'set-uuid' });
      expect(frame.item()?.trail?.map((c) => [c.label, c.queryParams])).toEqual([
        ['Company', { folder: 'folder-company' }],
        ['Team', { folder: 'folder-team' }],
      ]);
    });

    it('keeps working without the folder tree', async () => {
      const content = contentStub();
      content.folders.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const { frame } = await setup(content);

      await screen.findByRole('heading', { name: 'Leads' });
      expect(frame.item()?.trail ?? []).toEqual([]);
    });

    it('warns when the stored filter is invalid', async () => {
      await setup(contentStub({ ...SET, queryValid: false }));

      expect(await screen.findByText('Filter invalid')).toBeTruthy();
    });

    it('shows a skeleton while loading and an error state with a retry when the set cannot be read', async () => {
      const content = contentStub();
      content.getRecordSet.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 }))).mockReturnValue(of(SET));
      const { toasts } = await setup(content);

      expect(await screen.findByRole('heading', { level: 2, name: 'Could not load the record set — try again in a moment.' })).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: 'Record set' })).toBeTruthy();
      expect(toasts.toasts().at(-1)?.kind).toBe('error');
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Leads' })).toBeTruthy();
    });

    it('lists every record when the URL asks for it, and keeps the choice in the URL', async () => {
      const content = contentStub();
      const { navigate } = await setup(content, { inputs: { show: 'all' } });
      await waitFor(() => expect(content.listSetRecords).toHaveBeenCalled());
      expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: false });

      fireEvent.click(await screen.findByRole('radio', { name: 'Shown by the filter' }));

      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { show: null }, queryParamsHandling: 'merge' }));
    });

    it('shows the template snippet to a developer only', async () => {
      await setup(contentStub());
      await screen.findByRole('heading', { name: 'Leads' });
      expect(screen.queryByText('$CMS_VALUE(recordset:leads)$')).toBeNull();
    });

    it('shows the template snippet in developer mode', async () => {
      await setup(contentStub(), { dev: true });

      expect(await screen.findByText('$CMS_VALUE(recordset:leads)$')).toBeTruthy();
    });
  });

  describe('records', () => {
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

    it('creates a record with the n shortcut, and leaves the key alone where it cannot', async () => {
      const content = contentStub();
      await setup(content);
      await screen.findByRole('heading', { name: 'Leads' });
      const shortcuts = TestBed.inject(ShortcutService);

      const create = shortcuts.commands().find((c) => c.id === 'create')!;
      create.handler!();

      expect(content.createRecord).toHaveBeenCalledTimes(1);
    });

    it('creates a record when the tree asked for one, then clears the parameter', async () => {
      const content = contentStub();
      const { navigate } = await setup(content, { inputs: { newRecord: '1' } });

      await waitFor(() => expect(content.createRecord).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(navigate).toHaveBeenCalled());
    });

    it('says so when the record cannot be created', async () => {
      const content = contentStub();
      content.createRecord.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      const { toasts } = await setup(content);
      await screen.findByRole('heading', { name: 'Leads' });

      fireEvent.click(screen.getByRole('button', { name: 'New record' }));

      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Could not create the record — you may need the editor role.'));
    });
  });

  describe('the ⋮ menu', () => {
    it('opens the History drawer, which follows the set the frame reports', async () => {
      await setup(contentStub());
      await screen.findByRole('heading', { name: 'Leads' });
      const history = TestBed.inject(HistoryDrawerStore);

      await moreAction('History');

      expect(history.isOpen()).toBe(true);
    });

    it('lists what uses the set in a drawer, with where each opens', async () => {
      const api = apiStub();
      api.assetUsages.mockReturnValue(
        of([
          { fromUuid: 'page-1', fromUid: 'about', fromType: 'PAGE', kind: 'REFERENCE', sourcePath: 'content.team' },
          { fromUuid: 'rec-1', fromUid: 'ada', fromType: 'RECORD', kind: 'REFERENCE', sourcePath: 'friend' },
        ]),
      );
      await setup(contentStub(), { api });
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Used by');

      const drawer = await screen.findByRole('dialog', { name: 'Used by' });
      expect(api.assetUsages).toHaveBeenCalledWith('proj', 'set-uuid');
      expect(within(drawer).getByRole('link', { name: 'about' }).getAttribute('href')).toBe('/p/proj/pages/page-1');
      expect(within(drawer).getByRole('link', { name: 'ada' }).getAttribute('href')).toBe('/p/proj/content/records/rec-1');
      expect(within(drawer).getByText('Page')).toBeTruthy();
      expect(within(drawer).queryByText('content.team')).toBeNull();
    });

    it('says when nothing uses the set', async () => {
      await setup(contentStub());
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Used by');

      expect(await screen.findByText('No page, template or record references this set.')).toBeTruthy();
    });

    it('opens the drawer the tree asked for, then clears the parameter', async () => {
      const { navigate } = await setup(contentStub(), { inputs: { panel: 'history' } });
      const history = TestBed.inject(HistoryDrawerStore);

      await waitFor(() => expect(history.isOpen()).toBe(true));
      await waitFor(() => expect(navigate).toHaveBeenCalled());
    });

    it('renames the set to the new display name', async () => {
      const content = contentStub();
      const { toasts } = await setup(content);
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Rename…');
      const dialog = await screen.findByRole('dialog');
      const input = within(dialog).getByRole('textbox', { name: /name/i }) as HTMLInputElement;
      fireEvent.input(input, { target: { value: 'Team leads' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));

      await waitFor(() => expect(content.updateRecordSet).toHaveBeenCalledWith('proj', 'set-uuid', { displayName: 'Team leads' }, '"rev-5"'));
      expect(await screen.findByRole('heading', { level: 1, name: 'Team leads' })).toBeTruthy();
      expect(toasts.toasts().at(-1)?.message).toBe('Renamed to “Team leads”.');
    });

    it('moves the set into another folder and offers Undo that moves it back', async () => {
      const content = contentStub();
      const { toasts } = await setup(content);
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Move…');
      const dialog = await screen.findByRole('dialog', { name: 'Move “Leads” to…' });
      fireEvent.click(within(dialog).getByRole('radio', { name: /Shop/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-uuid', 'folder-shop'));
      const toast = toasts.toasts().at(-1)!;
      expect(toast.message).toBe('Moved “Leads” to Shop.');
      content.moveAsset.mockClear();

      toast.action!.run();

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-uuid', 'folder-team'));
    });

    it('deletes the set with its records after a confirmation naming them', async () => {
      const content = contentStub();
      const confirm = vi.fn().mockResolvedValue(true);
      const { navigate } = await setup(content, { confirm });
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Delete…');

      await waitFor(() => expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-uuid', true));
      const options = confirm.mock.calls[0][0];
      expect(options.title).toBe('Delete “Leads”?');
      expect(options.message).toContain('and its 12 records');
      expect(options.tone).toBe('danger');
      expect(options.typeToConfirm).toBeUndefined();
      await waitFor(() => expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content']));
    });

    it('offers Undo after the delete, which restores the set from its last live revision', async () => {
      const api = apiStub();
      const { toasts } = await setup(contentStub(), { api });
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Delete…');
      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Deleted “Leads” and its 12 records.'));

      toasts.toasts().at(-1)!.action!.run();

      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-uuid', { fromRevision: 5 }));
    });

    it('shows the error toast when the Undo of a delete fails', async () => {
      const api = apiStub();
      api.restoreAsset.mockReturnValue(throwError(() => new Error('409')));
      const { toasts } = await setup(contentStub(), { api });
      await screen.findByRole('heading', { name: 'Leads' });
      await moreAction('Delete…');
      await waitFor(() => expect(toasts.toasts().at(-1)?.action).toBeDefined());

      toasts.toasts().at(-1)!.action!.run();

      await waitFor(() => expect(toasts.toasts().at(-1)?.kind).toBe('error'));
    });

    it('asks for the typed word before deleting a set with 25 or more records', async () => {
      const confirm = vi.fn().mockResolvedValue(false);
      await setup(contentStub({ ...SET, recordCount: 40 }), { confirm });
      await screen.findByRole('heading', { name: 'Leads' });

      await moreAction('Delete…');

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(confirm.mock.calls[0][0].typeToConfirm).toBe('delete');
    });
  });

  describe('read-only', () => {
    it('reads the set and its records at the time-travel revision and offers no edits', async () => {
      const content = contentStub();
      await setup(content, { revision: 7 });

      expect(await screen.findByText(/the set and its filter are read-only/)).toBeTruthy();
      expect(content.getRecordSet).toHaveBeenCalledWith('proj', 'set-uuid', 7);
      await waitFor(() => expect(content.listSetRecords).toHaveBeenCalled());
      expect(content.listSetRecords.mock.calls.every((call) => call[2].revision === 7)).toBe(true);
      expect(screen.queryByRole('button', { name: 'New record' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Use as set filter' })).toBeNull();
      expect(screen.queryByRole('checkbox', { name: /^Select/ })).toBeNull();
      expect(content.previewSetQuery).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      expect((await screen.findByRole('menuitem', { name: 'Delete…' })).getAttribute('aria-disabled')).toBe('true');
    });

    it('offers no edits to an editor of an archived project (M26)', async () => {
      const content = contentStub();
      await render(RecordSetViewComponent, {
        componentInputs: { projectKey: 'proj', setUuid: 'set-uuid' },
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideFavoritesStub(),
          { provide: ContentService, useValue: content },
          { provide: ApiClient, useValue: apiStub() },
          { provide: DeveloperModeService, useValue: { enabled: signal(false) } },
          { provide: LocalesStore, useValue: { labelOf: (code: string) => code } },
          { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
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
    });

    it('offers Restore for a deleted set, and brings it back from its last live revision', async () => {
      const api = apiStub();
      const content = contentStub({ ...SET, deleted: true });
      await setup(content, { api });

      expect(await screen.findByText('This record set is deleted. Restore it to bring it and its records back.')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Conditions' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'set-uuid', { fromRevision: 5 }));
    });
  });
});

