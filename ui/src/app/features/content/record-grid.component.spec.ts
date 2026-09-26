import '@angular/compiler';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ContentService, type DatasetDetailView, type RecordSetGridQuery } from './content.service';
import { EXCLUDED_BY_QUERY, EXCLUDED_INVALID_QUERY, RecordGridComponent } from './record-grid.component';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

// `compiledDefinition` / `values` are `JsonNode` on the server (`Record<string, never>` in the generated types).
const DATASET = {
  uuid: 'ds-team',
  uid: 'team',
  displayName: 'Team',
  compiledDefinition: { editors: [{ name: 'role', type: 'TEXT', label: 'Role' }], bodies: [] },
} as unknown as DatasetDetailView;

/** The server marks what the stored set query selects on every row (`selectedBySet`). */
const ROWS = [
  { uuid: 'r1', uid: 'ada', displayName: 'Ada', values: { role: 'lead' }, selectedBySet: true },
  { uuid: 'r2', uid: 'bob', displayName: 'Bob', values: { role: 'staff' }, selectedBySet: false },
];

function page(rows: unknown[]) {
  return of({ content: rows, page: { size: 50, number: 0, totalElements: rows.length, totalPages: 1 } });
}

/** Every record for "All records"; only what the set shows (Ada) with the set query applied. */
function contentStub(rows: unknown[] = ROWS) {
  return {
    listSetRecords: vi
      .fn()
      .mockImplementation((_key: string, _uuid: string, query: RecordSetGridQuery) =>
        page(query.applySetQuery ? [rows[0]] : rows),
      ),
  };
}

async function setup(content: ReturnType<typeof contentStub>, inputs: Record<string, unknown> = {}) {
  const useAsSetQuery = vi.fn();
  const view = await render(RecordGridComponent, {
    componentInputs: { projectKey: 'proj', dataset: DATASET, recordSetUuid: 'set-uuid', canEditQuery: true, ...inputs },
    // The rows' release badges read the editing language (LocalesStore → ApiClient → HttpClient).
    providers: [{ provide: ContentService, useValue: content }, provideHttpClient(), provideHttpClientTesting()],
    on: { useAsSetQuery },
  });
  return { ...view, useAsSetQuery };
}

function rowOf(name: string): HTMLTableRowElement {
  return screen.getByText(name).closest('tr') as HTMLTableRowElement;
}

describe('RecordGridComponent (record set grid)', () => {
  it('lists every record by default and dims the ones the set query leaves out, in one request', async () => {
    const content = contentStub();
    await setup(content);

    await waitFor(() => expect(rowOf('Bob').classList).toContain('record-grid__row--excluded'));
    expect(content.listSetRecords).toHaveBeenCalledTimes(1);
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: false, page: 0, revision: null });
    expect(rowOf('Bob').getAttribute('title')).toBe(EXCLUDED_BY_QUERY);
    expect(rowOf('Ada').classList).not.toContain('record-grid__row--excluded');
    expect(rowOf('Ada').getAttribute('title')).toBeNull();
    expect(screen.getByRole('radio', { name: 'All records' }).getAttribute('aria-checked')).toBe('true');
  });

  it('"Show as rendered" applies the set query and hides what it leaves out, undimmed', async () => {
    const content = contentStub();
    await setup(content);
    await waitFor(() => expect(rowOf('Bob')).toBeTruthy());
    content.listSetRecords.mockClear();

    fireEvent.click(screen.getByRole('radio', { name: 'Show as rendered' }));

    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(content.listSetRecords).toHaveBeenCalledTimes(1);
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: true, page: 0 });
    expect(rowOf('Ada').classList).not.toContain('record-grid__row--excluded');
    expect(screen.getByRole('radio', { name: 'Show as rendered' }).getAttribute('aria-checked')).toBe('true');
  });

  it('dims every row the server reports unselected while the stored set query is invalid', async () => {
    const content = contentStub(ROWS.map((row) => ({ ...row, selectedBySet: false })));
    await setup(content, { queryValid: false });

    await waitFor(() => expect(rowOf('Ada').classList).toContain('record-grid__row--excluded'));
    expect(rowOf('Bob').getAttribute('title')).toBe(EXCLUDED_INVALID_QUERY);
    expect(content.listSetRecords).toHaveBeenCalledTimes(1);
  });

  it('lists the set as of the time-travel revision', async () => {
    const content = contentStub();
    const view = await setup(content, { revision: 7 });

    await waitFor(() => expect(rowOf('Bob').classList).toContain('record-grid__row--excluded'));
    expect(content.listSetRecords.mock.calls[0][2]).toMatchObject({ applySetQuery: false, revision: 7 });

    view.fixture.componentRef.setInput('revision', null);
    await waitFor(() => expect(content.listSetRecords).toHaveBeenCalledTimes(2));
    expect(content.listSetRecords.mock.calls[1][2]).toMatchObject({ revision: null });
  });

  /** The grid's own filter is ephemeral: it narrows the listing but only a click hands it to the query. */
  it('keeps its filter out of the set query until "Use as set query" hands it over', async () => {
    const content = contentStub();
    const { useAsSetQuery } = await setup(content);
    await waitFor(() => expect(rowOf('Ada')).toBeTruthy());
    const use = screen.getByRole('button', { name: 'Use as set query' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);

    fireEvent.input(screen.getByLabelText('Filter expression'), { target: { value: "role == 'lead'" } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: /^Role/ }));

    await waitFor(() => expect(use.disabled).toBe(false));
    expect(useAsSetQuery).not.toHaveBeenCalled();
    const lastListing = content.listSetRecords.mock.calls.at(-1);
    expect(lastListing?.[2]).toMatchObject({ where: "role == 'lead'", sort: [{ field: 'role', direction: 'asc' }] });

    fireEvent.click(use);

    expect(useAsSetQuery).toHaveBeenCalledWith({ where: "role == 'lead'", sort: [{ field: 'role', direction: 'asc' }] });
  });

  it('offers "Use as set query" only to someone who may edit the query', async () => {
    await setup(contentStub(), { canEditQuery: false });

    await waitFor(() => expect(rowOf('Ada')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Use as set query' })).toBeNull();
  });
});
