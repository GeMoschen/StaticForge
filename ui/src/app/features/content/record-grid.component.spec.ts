import '@angular/compiler';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmService } from '../../shared/components/dialog/confirm.service';
import { ReleaseDialogComponent } from '../release/release-dialog.component';
import type { ReleaseChoice } from '../release/release-choice.util';
import { ContentService, type DatasetDetailView, type RecordSetGridQuery } from './content.service';
import { RecordGridComponent, type RecordGridMode } from './record-grid.component';

/** The release dialog has its own spec; here it only shows what the grid hands it. */
@Component({
  selector: 'sf-release-dialog',
  standalone: true,
  template: `<div role="dialog" aria-label="Release dialog">{{ choices().length }} choices</div>`,
})
class ReleaseDialogStub {
  readonly projectKey = input<string>('');
  readonly mode = input<string>('release');
  readonly choices = input<ReleaseChoice[]>([]);
  readonly done = output<unknown>();
  readonly closed = output<void>();
}

// `compiledDefinition` / `values` are `JsonNode` on the server (`Record<string, never>` in the generated types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  compiledDefinition: { editors: [{ name: 'role', type: 'TEXT', label: 'Role' }], bodies: [] },
} as unknown as DatasetDetailView;

/** The API's real row shape: `selectedBySet` is the server's flag, `release` a block per language key. */
const row = (uuid: string, name: string, extra: Record<string, unknown> = {}) => ({
  uuid,
  uid: name.toLowerCase(),
  displayName: name,
  folderPath: '/team/',
  changedAt: '2026-05-01T10:00:00Z',
  changedBy: 3,
  values: { role: name === 'Ada' ? 'lead' : 'staff' },
  selectedBySet: name !== 'Bob',
  release: { de: { status: 'CHANGED', releasedRevision: 2 } },
  ...extra,
});
const ADA = row('r1', 'Ada');
const BOB = row('r2', 'Bob');

/** `total` rows are claimed; the listing returns `rows` for any page. */
function pageOf(rows: unknown[], total = rows.length, size = 50) {
  return of({ content: rows, page: { size, number: 0, totalElements: total, totalPages: Math.max(1, Math.ceil(total / size)) } });
}

function contentStub(rows: unknown[] = [ADA, BOB], total = rows.length) {
  return {
    listSetRecords: vi.fn().mockImplementation((_k: string, _u: string, query: RecordSetGridQuery) =>
      // The set shows Ada only; "All records" lists both.
      query.applySetQuery ? pageOf([rows[0]], 1) : pageOf(rows, total),
    ),
    listRecordSets: vi.fn().mockReturnValue(
      of([
        { uuid: 'set-uuid', displayName: 'Leads', dataset: { uuid: 'ds-team' }, folderPath: '/team/' },
        { uuid: 'set-b', displayName: 'Alumni', dataset: { uuid: 'ds-team' }, folderPath: '/team/' },
        { uuid: 'set-other', displayName: 'Products', dataset: { uuid: 'ds-products' }, folderPath: '/' },
      ]),
    ),
    moveAsset: vi.fn().mockReturnValue(of({})),
  };
}

function apiStub() {
  return {
    deleteAsset: vi.fn().mockReturnValue(of(undefined)),
    assetHistory: vi.fn().mockReturnValue(of([{ revision: 4, deleted: false }])),
    restoreAsset: vi.fn().mockReturnValue(of({})),
  };
}

async function setup(
  content: ReturnType<typeof contentStub>,
  options: {
    inputs?: Record<string, unknown>;
    api?: ReturnType<typeof apiStub>;
    confirm?: ReturnType<typeof vi.fn>;
    dev?: boolean;
    role?: string;
    /** Whether the project's policy lets this editor release (default yes). */
    release?: boolean;
  } = {},
) {
  const useAsSetQuery = vi.fn();
  const changed = vi.fn();
  const open = vi.fn();
  const modeChange = vi.fn();
  const confirm = options.confirm ?? vi.fn().mockResolvedValue(true);
  const api = options.api ?? apiStub();
  const view = await render(RecordGridComponent, {
    componentInputs: { projectKey: 'proj', dataset: DATASET, recordSetUuid: 'set-uuid', canEditQuery: true, ...options.inputs },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideFavoritesStub(),
      provideProjectPermissions({ role: () => options.role ?? 'EDITOR', permissions: () => (options.release === false ? [] : ['RELEASE']) }),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: api },
      { provide: ConfirmService, useValue: { confirm } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: LocalesStore, useValue: { labelOf: (code: string) => code } },
      { provide: EditingLocaleStore, useValue: { locale: signal(null) } },
    ],
    on: { useAsSetQuery, changed, open, modeChange },
  });
  return { ...view, api, confirm, useAsSetQuery, changed, open, modeChange, toasts: TestBed.inject(ToastService) };
}

const lastListing = (content: ReturnType<typeof contentStub>) => content.listSetRecords.mock.calls.at(-1)![2] as RecordSetGridQuery;
const selectRow = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
const bulk = (name: string) => screen.getByRole('button', { name });

describe('RecordGridComponent (record set table)', () => {
  beforeEach(() => {
    TestBed.overrideComponent(RecordGridComponent, {
      remove: { imports: [ReleaseDialogComponent] },
      add: { imports: [ReleaseDialogStub] },
    });
  });

  it('lists what the set shows by default, in one request, with the dataset columns and a status per language', async () => {
    const content = contentStub();
    await setup(content);

    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.queryByText('Bob')).toBeNull();
    expect(content.listSetRecords).toHaveBeenCalledTimes(1);
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: true, page: 0, size: 50, sort: [], q: '', revision: null });
    expect(screen.getByRole('columnheader', { name: /Role/ })).toBeTruthy();
    expect(screen.getByText('lead')).toBeTruthy();
    expect(screen.getByText('DE')).toBeTruthy();
  });

  it('lists every record with "All records" and marks the ones the set query leaves out', async () => {
    const content = contentStub();
    await setup(content, { inputs: { mode: 'all' as RecordGridMode } });

    expect(await screen.findByText('Bob')).toBeTruthy();
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: false });
    const bobRow = screen.getByText('Bob').closest('tr') as HTMLElement;
    expect(within(bobRow).getByText('Not shown on the site: the filter leaves this record out.')).toBeTruthy();
    const adaRow = screen.getByText('Ada').closest('tr') as HTMLElement;
    expect(within(adaRow).queryByText('Not shown on the site: the filter leaves this record out.')).toBeNull();
  });

  it('says why every record is marked while the stored set query is invalid', async () => {
    const content = contentStub([{ ...ADA, selectedBySet: false }, { ...BOB, selectedBySet: false }]);
    await setup(content, { inputs: { mode: 'all' as RecordGridMode, queryValid: false } });

    const adaRow = ((await screen.findByText('Ada')).closest('tr')) as HTMLElement;
    expect(within(adaRow).getByText('Not shown on the site: the filter is invalid, so the set shows no records.')).toBeTruthy();
  });

  it('asks the parent to switch the view and leaves the choice to it', async () => {
    const { modeChange } = await setup(contentStub());
    await screen.findByText('Ada');

    fireEvent.click(screen.getByRole('radio', { name: 'All records' }));

    expect(modeChange).toHaveBeenCalledWith('all');
  });

  it('says the filter is invalid instead of "no records match" when it leaves nothing', async () => {
    const content = { ...contentStub(), listSetRecords: vi.fn().mockReturnValue(pageOf([])) };
    await setup(content, { inputs: { queryValid: false } });

    expect(await screen.findByText('The filter is invalid, so the set shows no records.')).toBeTruthy();
  });

  it('lists the set as of the time-travel revision', async () => {
    const content = contentStub();
    const view = await setup(content, { inputs: { revision: 7, mode: 'all' as RecordGridMode } });
    await screen.findByText('Bob');
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ revision: 7 });

    view.fixture.componentRef.setInput('revision', null);
    await waitFor(() => expect(content.listSetRecords).toHaveBeenCalledTimes(2));
    expect(content.listSetRecords.mock.calls[1][2]).toMatchObject({ revision: null });
  });

  describe('server paging, sorting and search', () => {
    it('reads the next page from the server', async () => {
      const content = contentStub([ADA], 120);
      await setup(content, { inputs: { mode: 'all' as RecordGridMode } });
      await screen.findByText('Ada');

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

      await waitFor(() => expect(lastListing(content)).toMatchObject({ page: 1, size: 50 }));
    });

    it('sorts on the server by a header and adds a key with Shift', async () => {
      const content = contentStub();
      await setup(content);
      await screen.findByText('Ada');

      fireEvent.click(screen.getByRole('button', { name: /^Role/ }));
      await waitFor(() => expect(lastListing(content).sort).toEqual([{ field: 'role', direction: 'asc' }]));

      fireEvent.click(screen.getByRole('button', { name: /^Name/ }), { shiftKey: true });
      await waitFor(() =>
        expect(lastListing(content).sort).toEqual([
          { field: 'role', direction: 'asc' },
          { field: '_displayName', direction: 'asc' },
        ]),
      );
    });

    it('searches by name on the server and starts again at the first page', async () => {
      const content = contentStub([ADA], 120);
      await setup(content, { inputs: { mode: 'all' as RecordGridMode } });
      await screen.findByText('Ada');
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(lastListing(content).page).toBe(1));

      fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'ad' } });

      await waitFor(() => expect(lastListing(content)).toMatchObject({ q: 'ad', page: 0 }));
    });

    it('reads the last page that exists when the records of the current one are gone', async () => {
      const content = contentStub([ADA], 120);
      content.listSetRecords.mockImplementation((_k: string, _u: string, q: RecordSetGridQuery) =>
        // 70 records, 50 to a page: the table asks for page 3, which has nothing now.
        q.page <= 1 ? pageOf([ADA], 70) : pageOf([], 70),
      );
      const view = await setup(content, { inputs: { mode: 'all' as RecordGridMode } });
      await screen.findByText('Ada');
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(lastListing(content).page).toBe(1));
      content.listSetRecords.mockClear();
      content.listSetRecords.mockImplementation((_k: string, _u: string, q: RecordSetGridQuery) =>
        q.page === 0 ? pageOf([ADA], 20) : pageOf([], 20),
      );

      view.fixture.componentRef.setInput('refreshKey', 1);

      // Page index 1 is empty (20 records fit on page 0): it falls back to page 0 instead of showing nothing.
      await waitFor(() => expect(content.listSetRecords.mock.calls.map((c) => c[2].page)).toEqual([1, 0]));
    });
  });

  describe('the expression filter (developer mode)', () => {
    /** The grid's own filter is ephemeral: it narrows the listing but only a click hands it to the filter. */
    it('keeps its filter out of the set query until "Use as set filter" hands it over', async () => {
      const content = contentStub();
      const { useAsSetQuery } = await setup(content, { dev: true });
      await screen.findByText('Ada');
      const use = screen.getByRole('button', { name: 'Use as set filter' }) as HTMLButtonElement;
      await waitFor(() => expect(use.disabled).toBe(true));

      fireEvent.input(await screen.findByLabelText('Expression filter'), { target: { value: "role == 'lead'" } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      fireEvent.click(screen.getByRole('button', { name: /^Role/ }));

      await waitFor(() => expect(use.disabled).toBe(false));
      expect(useAsSetQuery).not.toHaveBeenCalled();
      expect(lastListing(content)).toMatchObject({ where: "role == 'lead'", sort: [{ field: 'role', direction: 'asc' }] });

      fireEvent.click(use);

      expect(useAsSetQuery).toHaveBeenCalledWith({ where: "role == 'lead'", sort: [{ field: 'role', direction: 'asc' }] });
    });

    it('is not offered to an editor, who builds the filter in the panel', async () => {
      await setup(contentStub());
      await screen.findByText('Ada');

      expect(screen.queryByLabelText('Expression filter')).toBeNull();
    });

    it('shows where the server says the expression goes wrong', async () => {
      const content = {
        ...contentStub(),
        listSetRecords: vi
          .fn()
          .mockReturnValueOnce(pageOf([ADA]))
          .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { detail: 'Unknown field: rank', column: 1 } }))),
      };
      await setup(content, { dev: true });
      await screen.findByText('Ada');

      fireEvent.input(await screen.findByLabelText('Expression filter'), { target: { value: 'rank > 2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(await screen.findByText('Unknown field: rank')).toBeTruthy();
    });

    it('offers "Use as set filter" only to someone who may edit the filter', async () => {
      await setup(contentStub(), { inputs: { canEditQuery: false } });
      await screen.findByText('Ada');

      expect(screen.queryByRole('button', { name: 'Use as set filter' })).toBeNull();
    });
  });

  it('shows an error state with a retry when the records cannot be read', async () => {
    const content = {
      ...contentStub(),
      listSetRecords: vi
        .fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockReturnValue(pageOf([ADA])),
    };
    await setup(content);

    expect(await screen.findByText('Could not load the records.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Ada')).toBeTruthy();
  });

  it('opens a record from its row', async () => {
    const { open } = await setup(contentStub());
    fireEvent.click((await screen.findByText('Ada')).closest('tr')!);

    expect(open).toHaveBeenCalledWith('r1');
  });

  describe('selection and bulk actions', () => {
    const all = { inputs: { mode: 'all' as RecordGridMode } };

    it('offers Release, Move and Delete once rows are selected, and says how many', async () => {
      await setup(contentStub(), all);
      await screen.findByText('Bob');
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

      selectRow('Ada');
      selectRow('Bob');

      expect((await screen.findAllByText('2 selected')).length).toBeGreaterThan(0);
      expect(bulk('Release…')).toBeTruthy();
      expect(bulk('Move…')).toBeTruthy();
      expect(bulk('Delete')).toBeTruthy();
    });

    it('has no selection and no bulk actions where the records are read-only', async () => {
      await setup(contentStub(), { inputs: { mode: 'all' as RecordGridMode, readOnly: true } });
      await screen.findByText('Bob');

      expect(screen.queryByRole('checkbox', { name: 'Select Ada' })).toBeNull();
    });

    it('hides Release from someone who may not release', async () => {
      await setup(contentStub(), { ...all, release: false });
      await screen.findByText('Bob');
      selectRow('Ada');

      expect((await screen.findAllByText('1 selected')).length).toBeGreaterThan(0);
      expect(bulk('Delete')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull();
    });

    it('deletes the selected records after a confirmation that names them, then offers one Undo', async () => {
      const content = contentStub();
      const { api, confirm, changed, toasts } = await setup(content, all);
      await screen.findByText('Bob');
      selectRow('Ada');
      selectRow('Bob');
      content.listSetRecords.mockClear();

      fireEvent.click(bulk('Delete'));

      await waitFor(() => expect(api.deleteAsset).toHaveBeenCalledTimes(2));
      expect(api.deleteAsset).toHaveBeenNthCalledWith(1, 'proj', 'r1');
      expect(api.deleteAsset).toHaveBeenNthCalledWith(2, 'proj', 'r2');
      const options = confirm.mock.calls[0][0];
      expect(options.title).toBe('Delete 2 records?');
      expect(options.details).toEqual(['Ada', 'Bob']);
      expect(options.tone).toBe('danger');
      expect(options.typeToConfirm).toBeUndefined();
      await waitFor(() => expect(changed).toHaveBeenCalled());
      expect(content.listSetRecords).toHaveBeenCalled();
      const toast = toasts.toasts().at(-1)!;
      expect(toast.message).toBe('Deleted 2 records.');

      toast.action!.run();

      await waitFor(() => expect(api.restoreAsset).toHaveBeenCalledTimes(2));
      expect(api.restoreAsset).toHaveBeenCalledWith('proj', 'r2', { fromRevision: 4 });
      expect(api.restoreAsset).toHaveBeenLastCalledWith('proj', 'r1', { fromRevision: 4 });
    });

    it('deletes one record with its name in the question', async () => {
      const { confirm, toasts } = await setup(contentStub(), all);
      await screen.findByText('Bob');
      selectRow('Bob');

      fireEvent.click(bulk('Delete'));

      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Deleted “Bob”.'));
      expect(confirm.mock.calls[0][0].title).toBe('Delete “Bob”?');
    });

    it('does nothing when the confirmation is cancelled', async () => {
      const confirm = vi.fn().mockResolvedValue(false);
      const { api } = await setup(contentStub(), { ...all, confirm });
      await screen.findByText('Bob');
      selectRow('Ada');

      fireEvent.click(bulk('Delete'));

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(api.deleteAsset).not.toHaveBeenCalled();
    });

    it('asks for the typed word from 25 records on, reading every record of the query', async () => {
      const many = Array.from({ length: 30 }, (_, i) => row(`m${i}`, `Member ${i}`));
      const content = contentStub(many.slice(0, 5), 30);
      content.listSetRecords.mockImplementation((_k: string, _u: string, q: RecordSetGridQuery) =>
        of({ content: many.slice(q.page * q.size, (q.page + 1) * q.size), page: { size: q.size, number: q.page, totalElements: 30, totalPages: Math.ceil(30 / q.size) } }),
      );
      const confirm = vi.fn().mockResolvedValue(false);
      await setup(content, { ...all, confirm, inputs: { mode: 'all' as RecordGridMode, pageSize: 5 } });
      await screen.findByText('Member 0');

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Select all 30 matching' }));
      fireEvent.click(bulk('Delete'));

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      const options = confirm.mock.calls[0][0];
      expect(options.typeToConfirm).toBe('delete');
      expect(options.title).toBe('Delete 30 records?');
      expect(options.details).toHaveLength(12);
      // The whole selection is read from the server in pages of 500, not just the 5 on screen.
      expect(content.listSetRecords.mock.calls.some((call) => call[2].size === 500)).toBe(true);
    });

    it('reports what could not be deleted and keeps Undo for the rest', async () => {
      const api = apiStub();
      api.deleteAsset.mockImplementation((_k: string, uuid: string) =>
        uuid === 'r2' ? throwError(() => new HttpErrorResponse({ status: 409 })) : of(undefined),
      );
      const { toasts } = await setup(contentStub(), { ...all, api });
      await screen.findByText('Bob');
      selectRow('Ada');
      selectRow('Bob');

      fireEvent.click(bulk('Delete'));

      await waitFor(() => expect(toasts.toasts().some((t) => t.message?.includes('1 record could not be deleted'))).toBe(true));
      expect(toasts.toasts().some((t) => t.message === 'Deleted “Ada”.' && !!t.action)).toBe(true);
    });

    it('moves the selection into another record set of the same dataset, with one Undo', async () => {
      const content = contentStub();
      const { toasts, changed } = await setup(content, all);
      await screen.findByText('Bob');
      selectRow('Ada');
      selectRow('Bob');

      fireEvent.click(bulk('Move…'));

      const dialog = await screen.findByRole('dialog', { name: 'Move 2 records to…' });
      // Only the dataset's other sets: the set the records are in is listed but cannot be chosen, other datasets are absent.
      expect(within(dialog).getByRole('radio', { name: /Alumni/ })).toBeTruthy();
      expect(within(dialog).queryByText('Products')).toBeNull();
      expect((within(dialog).getByRole('radio', { name: /Leads/ }) as HTMLInputElement).disabled).toBe(true);
      fireEvent.click(within(dialog).getByRole('radio', { name: /Alumni/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledTimes(2));
      expect(content.moveAsset).toHaveBeenCalledWith('proj', 'r1', 'set-b');
      expect(content.moveAsset).toHaveBeenCalledWith('proj', 'r2', 'set-b');
      await waitFor(() => expect(changed).toHaveBeenCalled());
      const toast = toasts.toasts().at(-1)!;
      expect(toast.message).toBe('Moved 2 records to Alumni.');

      content.moveAsset.mockClear();
      toast.action!.run();

      await waitFor(() => expect(content.moveAsset).toHaveBeenCalledTimes(2));
      expect(content.moveAsset).toHaveBeenCalledWith('proj', 'r1', 'set-uuid');
      expect(content.moveAsset).toHaveBeenCalledWith('proj', 'r2', 'set-uuid');
    });

    it('opens the release dialog with every language of the selection that has something to release', async () => {
      await setup(contentStub(), all);
      await screen.findByText('Bob');
      selectRow('Ada');
      selectRow('Bob');

      fireEvent.click(bulk('Release…'));

      expect(await screen.findByRole('dialog', { name: 'Release dialog' })).toBeTruthy();
      expect(screen.getByText('2 choices')).toBeTruthy();
    });

    it('says so when nothing in the selection is waiting to be released', async () => {
      const content = contentStub([row('r1', 'Ada', { release: { de: { status: 'PUBLISHED', releasedRevision: 2 } } })]);
      const { toasts } = await setup(content, all);
      await screen.findByText('Ada');
      selectRow('Ada');

      fireEvent.click(bulk('Release…'));

      await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Nothing in the selection is waiting to be released.'));
      expect(screen.queryByRole('dialog', { name: 'Release dialog' })).toBeNull();
    });
  });
});
